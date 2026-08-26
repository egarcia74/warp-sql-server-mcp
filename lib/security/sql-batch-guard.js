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
 * safety tier forbids, wherever they appear. The keywords checked here are
 * T-SQL reserved words (plus the xp_ extended-procedure prefix), so an
 * unbracketed column or table with the same name would already be a syntax
 * error; false positives are limited to identifiers that can be bracketed,
 * and the error message says so.
 *
 * Everything is a linear single-pass scan — no regex backtracking on untrusted
 * input.
 */

// Statements that modify data. EXEC is included because a procedure can do
// anything. Compared with the `destructive` regex patterns in server-config
// this adds MERGE and omits CALL (ODBC escape syntax, not executable T-SQL).
// BULK INSERT is caught by INSERT; OPENROWSET(BULK ...) is only a file read.
const DESTRUCTIVE_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'exec',
  'execute'
]);

// Statements that change schema or permissions. SELECT ... INTO creates a
// table and is detected from the governing verb (see classifyWord).
const SCHEMA_KEYWORDS = new Set(['create', 'drop', 'alter', 'grant', 'revoke', 'deny']);

// Statements and rowset functions that are never read-only but fit neither
// category above. Only read-only mode forbids them, matching the pre-existing
// policy (the DML/DDL tiers do not classify them). OPENROWSET/OPENQUERY/
// OPENDATASOURCE are included because they can run arbitrary SQL against a
// linked server or read server-side files from inside a SELECT.
const NON_READ_ONLY_KEYWORDS = new Set([
  'waitfor',
  'backup',
  'restore',
  'shutdown',
  'kill',
  'dbcc',
  'reconfigure',
  'openrowset',
  'openquery',
  'opendatasource'
]);

// Word characters: identifiers plus the @variable, #temp and $ prefixes, so
// that e.g. "@delete" is not mistaken for the DELETE keyword.
const WORD_SPLIT = /[^a-z0-9_@#$]+/;

const READ_ONLY_MESSAGE =
  'Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.';
const DESTRUCTIVE_MESSAGE =
  'Destructive operations (INSERT/UPDATE/DELETE) are disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.';
const SCHEMA_MESSAGE =
  'Schema changes (CREATE/DROP/ALTER) are disabled. Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=true to enable.';

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

// Verbs that can govern an INTO clause. INTO is only SELECT ... INTO (which
// creates a table) when the most recent governing verb is SELECT; after
// INSERT or MERGE — possibly with TOP (n) in between — it is part of the
// DML statement.
const INTO_VERBS = new Set(['select', 'insert', 'merge']);

/**
 * Category of a statement keyword, or null for an ordinary word.
 *
 * @param {string} word - lower-cased word
 * @param {string|null} verb - most recent INTO-governing verb seen (see INTO_VERBS)
 * @returns {'destructive'|'schema'|'non-read-only'|null}
 */
function classifyWord(word, verb) {
  if (DESTRUCTIVE_KEYWORDS.has(word)) {
    return 'destructive';
  }
  if (SCHEMA_KEYWORDS.has(word)) {
    return 'schema';
  }
  if (word === 'into' && verb === 'select') {
    return 'schema';
  }
  if (NON_READ_ONLY_KEYWORDS.has(word) || word.startsWith('xp_')) {
    return 'non-read-only';
  }
  return null;
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
  if (category === 'destructive' && !modes.allowDestructiveOperations) {
    return { queryType: 'destructive', message: DESTRUCTIVE_MESSAGE };
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

function violationResult(word, found) {
  const keyword = word.toUpperCase();
  const result = {
    queryType: found.queryType,
    keyword: keyword,
    reason: `${found.message} The batch contains the statement keyword '${keyword}'. T-SQL does not require ';' between statements, so every statement in the batch is checked; if this is an identifier, wrap it in [brackets].`
  };
  return result;
}

/**
 * Scans a whole batch for statement keywords the active safety tier forbids.
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

  let verb = null;
  for (const word of lexical.toLowerCase().split(WORD_SPLIT).filter(Boolean)) {
    const category = classifyWord(word, verb);
    const found = category === null ? null : tierViolation(category, modes);
    if (found) {
      return violationResult(word, found);
    }
    if (INTO_VERBS.has(word)) {
      verb = word;
    }
  }

  return null;
}
