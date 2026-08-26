/**
 * Batch-level statement guard for execute_query / explain_query.
 *
 * SqlServerMCP.validateQuery classifies a query with anchored regexes
 * (`^\s*SELECT`, `^\s*DELETE`, ...) and only splits multi-statement batches on
 * ';'. T-SQL does not require ';' between statements, so a batch such as
 * `SELECT 1 DELETE FROM Users` was classified by its SELECT prefix alone and
 * ran in read-only mode (GHSA-qhf4-jmhq-73c8).
 *
 * This module scans the *whole* batch — with string literals, quoted/bracketed
 * identifiers and comments removed — for statement keywords that the active
 * safety tier forbids, wherever they appear, and then requires the batch to
 * open with a recognised T-SQL statement keyword (T-SQL lets the first
 * statement of a batch be a bare procedure call without EXEC).
 *
 * Every keyword matched on its own is a T-SQL reserved word (plus the xp_ /
 * sp_ procedure prefixes), so an unbracketed column or table with the same
 * name is a syntax error in SQL Server itself and cannot collide. Words that
 * are legal identifiers — RECEIVE, ENABLE, DISABLE — are never matched on
 * their own: ENABLE/DISABLE TRIGGER is caught through the reserved word
 * TRIGGER, and RECEIVE only in statement position (see classifyReceive).
 *
 * Everything is a linear single-pass scan — no regex backtracking on untrusted
 * input.
 */

// Statements that modify data. EXEC is included because a procedure can do
// anything. Compared with the `destructive` regex patterns in server-config
// this adds MERGE/WRITETEXT/UPDATETEXT and omits CALL (ODBC escape syntax,
// not executable T-SQL). BULK INSERT is caught by INSERT; the Service Broker
// RECEIVE statement is contextual (see classifyReceive).
const DESTRUCTIVE_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'exec',
  'execute',
  'writetext',
  'updatetext'
];

// Statements that change schema or permissions. SELECT ... INTO creates a
// table and is detected from the governing verb (see classifyWord). TRIGGER
// is reserved and only occurs in CREATE/ALTER/DROP/ENABLE/DISABLE TRIGGER, so
// it catches ENABLE/DISABLE TRIGGER without matching the non-reserved words
// ENABLE and DISABLE, which are legal column names.
const SCHEMA_KEYWORDS = ['create', 'drop', 'alter', 'grant', 'revoke', 'deny', 'trigger'];

// Server-administration statements and rowset functions that can run
// arbitrary SQL against a linked server. A procedure or admin statement can do
// anything, so — like EXEC — they are gated by the destructive-operations
// tier. OPENROWSET(BULK ...) is a file read and is handled in classifyWord.
const ADMINISTRATIVE_KEYWORDS = [
  'shutdown',
  'kill',
  'backup',
  'restore',
  'dbcc',
  'reconfigure',
  'checkpoint',
  'setuser',
  'openquery',
  'opendatasource'
];

// Never read-only, but not a state change either: only read-only mode
// forbids these.
const NON_READ_ONLY_KEYWORDS = ['waitfor'];

const CATEGORY_BY_WORD = new Map([
  ...DESTRUCTIVE_KEYWORDS.map(w => [w, 'destructive']),
  ...SCHEMA_KEYWORDS.map(w => [w, 'schema']),
  ...ADMINISTRATIVE_KEYWORDS.map(w => [w, 'administrative']),
  ...NON_READ_ONLY_KEYWORDS.map(w => [w, 'non-read-only'])
]);

// Verbs that can govern an INTO clause. INTO is only SELECT ... INTO (which
// creates a table) when the most recent governing verb is SELECT; after
// INSERT or MERGE — possibly with TOP (n) in between — it is part of the
// DML statement.
const INTO_VERBS = new Set(['select', 'insert', 'merge']);

// Words a T-SQL batch may legitimately open with. Anything else in first
// position is, in practice, a bare procedure call (T-SQL allows omitting EXEC
// for the first statement of a batch) and is treated as destructive.
// SHOW/DESCRIBE/DESC/EXPLAIN are not T-SQL statements (SQL Server rejects
// them) but are listed so this guard agrees with server-config's read-only
// patterns rather than reporting them as procedure calls.
const LEADING_STATEMENT_KEYWORDS = new Set([
  'select',
  'show',
  'describe',
  'desc',
  'explain',
  'with',
  'declare',
  'set',
  'if',
  'else',
  'begin',
  'end',
  'print',
  'use',
  'while',
  'return',
  'goto',
  'break',
  'continue',
  'raiserror',
  'throw',
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'bulk',
  'writetext',
  'updatetext',
  'readtext',
  'receive',
  'exec',
  'execute',
  'create',
  'drop',
  'alter',
  'grant',
  'revoke',
  'deny',
  'enable',
  'disable',
  'backup',
  'restore',
  'dbcc',
  'kill',
  'shutdown',
  'reconfigure',
  'checkpoint',
  'waitfor',
  'open',
  'close',
  'fetch',
  'deallocate',
  'commit',
  'rollback',
  'save',
  'revert',
  'setuser'
]);

// Word characters: identifiers plus the @variable, #temp and $ prefixes, so
// that e.g. "@delete" is not mistaken for the DELETE keyword. '*' is kept as
// a word of its own so that RECEIVE * can be recognised (see classifyReceive).
const WORD_SPLIT = /[^a-z0-9_@#$*]+/;

// After stripping, a batch whose first token is a quoted identifier or string
// literal placeholder ([] "" '') opened with e.g. `[dbo].[Proc] 'arg'` — a bare
// procedure call that leaves no word for the leading-statement check to see.
const LEADS_WITH_QUOTED_TOKEN = /^[\s;(]*(\[\]|''|"")/;

const READ_ONLY_MESSAGE =
  'Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.';
const DESTRUCTIVE_MESSAGE =
  'Destructive operations (INSERT/UPDATE/DELETE) are disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.';
const ADMINISTRATIVE_MESSAGE =
  'Administrative operations (SHUTDOWN/KILL/BACKUP/RESTORE/DBCC/RECONFIGURE/CHECKPOINT/SETUSER/xp_*/sp_*/linked-server rowset functions) are disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.';
const SCHEMA_MESSAGE =
  'Schema changes (CREATE/DROP/ALTER) are disabled. Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=true to enable.';

const BATCH_HINT =
  "T-SQL does not require ';' between statements, so every statement in the batch is checked; if this is an identifier, wrap it in [brackets].";

/**
 * Index of the closing quote for the literal/identifier opened at openIndex,
 * treating a doubled quote as an escape; -1 if unterminated.
 */
function indexOfQuoteEnd(sql, openIndex, quote) {
  let i = openIndex + 1;
  while (i < sql.length) {
    if (sql.charAt(i) !== quote) {
      i++;
    } else if (sql.charAt(i + 1) === quote) {
      i += 2;
    } else {
      return i;
    }
  }
  return -1;
}

/** Index of the last character of the line comment starting at openIndex. */
function indexOfLineEnd(sql, openIndex) {
  const newline = sql.indexOf('\n', openIndex);
  return newline === -1 ? sql.length - 1 : newline;
}

/**
 * Index of the final '/' closing the block comment opened at openIndex,
 * honouring T-SQL's nested block comments; -1 if unterminated.
 */
function indexOfBlockCommentEnd(sql, openIndex) {
  let depth = 0;
  let i = openIndex;
  while (i < sql.length - 1) {
    const pair = sql.substring(i, i + 2);
    if (pair === '/*') {
      depth++;
      i += 2;
    } else if (pair === '*/') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
      i += 2;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Describes the span starting at index i: for a literal, identifier or comment
 * the index of its last character and the placeholder to emit; for any other
 * character the character itself. `end` is -1 when the span is unterminated.
 *
 * @returns {{ end: number, replacement: string }}
 */
function spanAt(sql, i) {
  const ch = sql.charAt(i);
  const pair = sql.substring(i, i + 2);
  if (ch === "'" || ch === '"') {
    return { end: indexOfQuoteEnd(sql, i, ch), replacement: ch + ch };
  }
  if (ch === '[') {
    return { end: sql.indexOf(']', i + 1), replacement: '[]' };
  }
  if (pair === '--') {
    return { end: indexOfLineEnd(sql, i), replacement: ' ' };
  }
  if (pair === '/*') {
    return { end: indexOfBlockCommentEnd(sql, i), replacement: ' ' };
  }
  return { end: i, replacement: ch };
}

/**
 * Removes the parts of a T-SQL batch that may legitimately contain keyword
 * text: string literals ('...' with '' escapes), bracketed identifiers
 * ([...]), double-quoted identifiers ("..."), line comments (-- to end of
 * line) and block comments (slash-star ... star-slash, which nest in T-SQL).
 *
 * Returns null if a literal, identifier or block comment is unterminated —
 * the batch is malformed and must fail closed rather than have its tail
 * hidden from the keyword scan.
 *
 * @param {string} sql
 * @returns {string|null}
 */
export function stripSqlLiteralsAndComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const span = spanAt(sql, i);
    if (span.end === -1) {
      return null;
    }
    out += span.replacement;
    i = span.end + 1;
  }
  return out;
}

/** OPENROWSET(BULK ...) is a file read; every other form queries a provider. */
function classifyOpenrowset(words, i) {
  return words.at(i + 1) === 'bulk' ? 'non-read-only' : 'administrative';
}

/** INTO is SELECT ... INTO (creates a table) only under a SELECT verb. */
function classifyInto(_words, _i, verb) {
  return verb === 'select' ? 'schema' : null;
}

/**
 * RECEIVE is not a reserved word, so `SELECT Receive FROM Payments` is valid
 * T-SQL and must not be blocked. The Service Broker statement is recognised
 * only in the positions a statement can occupy: opening the batch, inside
 * WAITFOR (...), or followed by TOP / * (RECEIVE TOP (n) ..., RECEIVE * ...).
 * A mid-batch RECEIVE with an explicit column list is lexically identical to
 * a SELECT column named Receive and is deliberately left alone.
 */
function classifyReceive(words, i) {
  const next = words.at(i + 1);
  const statement = i === 0 || words.at(i - 1) === 'waitfor' || next === 'top' || next === '*';
  return statement ? 'destructive' : null;
}

// Words whose category depends on their neighbours.
const CONTEXTUAL_CLASSIFIERS = new Map([
  ['openrowset', classifyOpenrowset],
  ['into', classifyInto],
  ['receive', classifyReceive]
]);

/**
 * Category of the statement keyword at words[i], or null for an ordinary word.
 *
 * @param {string[]} words - lower-cased words of the whole batch
 * @param {number} i - index of the word to classify
 * @param {string|null} verb - most recent INTO-governing verb seen (see INTO_VERBS)
 * @returns {'destructive'|'schema'|'administrative'|'non-read-only'|null}
 */
function classifyWord(words, i, verb) {
  const word = words.at(i);
  const contextual = CONTEXTUAL_CLASSIFIERS.get(word);
  if (contextual) {
    return contextual(words, i, verb);
  }
  return isProcedureName(word) ? 'administrative' : (CATEGORY_BY_WORD.get(word) ?? null);
}

/** xp_* extended procedures and sp_* system procedures. */
function isProcedureName(word) {
  return word.startsWith('xp_') || word.startsWith('sp_');
}

/**
 * Whether the active safety tier forbids a keyword of the given category, and
 * how to report it. Returns null when the category is permitted.
 *
 * @returns {{ queryType: string, message: string } | null}
 */
function tierViolation(category, modes) {
  if (modes.readOnlyMode) {
    return { queryType: 'non-select', message: READ_ONLY_MESSAGE };
  }
  const gatedByDml = category === 'destructive' || category === 'administrative';
  if (gatedByDml && !modes.allowDestructiveOperations) {
    const message = category === 'administrative' ? ADMINISTRATIVE_MESSAGE : DESTRUCTIVE_MESSAGE;
    return { queryType: 'destructive', message: message };
  }
  if (category === 'schema' && !modes.allowSchemaChanges) {
    return { queryType: 'schema', message: SCHEMA_MESSAGE };
  }
  return null;
}

function isUnrestricted(modes) {
  return !modes.readOnlyMode && modes.allowDestructiveOperations && modes.allowSchemaChanges;
}

function unterminatedResult(modes) {
  const prefix = modes.readOnlyMode ? 'Read-only mode is enabled. ' : '';
  const result = {
    queryType: modes.readOnlyMode ? 'non-select' : 'invalid',
    reason: `${prefix}Unterminated string literal, identifier or block comment; the batch cannot be safely classified.`
  };
  return result;
}

function keywordResult(word, found) {
  const keyword = word.toUpperCase();
  const result = {
    queryType: found.queryType,
    keyword: keyword,
    reason: `${found.message} The batch contains the statement keyword '${keyword}'. ${BATCH_HINT}`
  };
  return result;
}

function leadingStatementResult(word, found) {
  const keyword = (word || '').toUpperCase();
  const result = {
    queryType: found.queryType,
    keyword: keyword,
    reason: `${found.message} Unrecognised leading statement '${keyword}' (bare procedure call?). A batch must begin with a T-SQL statement keyword; use EXEC for procedures.`
  };
  return result;
}

/**
 * First forbidden keyword in the batch, as a result object, or null.
 */
function findForbiddenKeyword(words, modes) {
  let verb = null;
  for (let i = 0; i < words.length; i++) {
    const word = words.at(i);
    const category = classifyWord(words, i, verb);
    const found = category === null ? null : tierViolation(category, modes);
    if (found) {
      return keywordResult(word, found);
    }
    if (INTO_VERBS.has(word)) {
      verb = word;
    }
  }
  return null;
}

/**
 * A batch must open with a recognised statement keyword; anything else (or an
 * empty batch after stripping) is treated as a bare procedure call, i.e. as
 * destructive as EXEC.
 */
function findUnrecognisedLeadingStatement(lexical, words, modes) {
  const first = words.at(0);
  const recognised = first !== undefined && LEADING_STATEMENT_KEYWORDS.has(first);
  if (recognised && !LEADS_WITH_QUOTED_TOKEN.test(lexical)) {
    return null;
  }
  const found = tierViolation('destructive', modes);
  return found ? leadingStatementResult(first, found) : null;
}

/**
 * Scans a whole batch for statement keywords the active safety tier forbids,
 * then checks that the batch opens with a recognised statement.
 *
 * @param {string} sql - The full batch as submitted
 * @param {{readOnlyMode: boolean, allowDestructiveOperations: boolean, allowSchemaChanges: boolean}} modes
 * @returns {{queryType: string, keyword?: string, reason: string} | null} null when the batch is acceptable
 */
export function findForbiddenBatchStatement(sql, modes) {
  if (isUnrestricted(modes)) {
    return null;
  }

  const lexical = stripSqlLiteralsAndComments(sql);
  if (lexical === null) {
    return unterminatedResult(modes);
  }

  const words = lexical.toLowerCase().split(WORD_SPLIT).filter(Boolean);
  return (
    findForbiddenKeyword(words, modes) ?? findUnrecognisedLeadingStatement(lexical, words, modes)
  );
}
