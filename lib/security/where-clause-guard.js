/**
 * Lexical guard for caller-supplied WHERE clauses (get_table_data, export_table_csv).
 *
 * The clause is concatenated into `SELECT * FROM [schema].[table] WHERE <clause>`,
 * so it must be a single predicate on the requested table. This module rejects
 * anything that would turn it into something else before the SQL is assembled.
 *
 * It deliberately does NOT rely on the SQL parser: T-SQL does not require ';'
 * between statements, and QueryValidator falls back to a permissive regex on
 * anything node-sql-parser cannot parse (GETDATE(), DATEADD, EXISTS, ...).
 * Everything here is a linear single-pass scan — no regex backtracking on
 * untrusted input.
 */

// Statement-starting keywords that can never legitimately appear in a WHERE
// predicate at any depth. Any of these following a predicate would start a
// second statement (or invoke a dangerous rowset/procedure).
export const WHERE_CLAUSE_FORBIDDEN_KEYWORDS = new Set([
  'exec',
  'execute',
  'delete',
  'insert',
  'update',
  'merge',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'deny',
  'waitfor',
  'declare',
  'backup',
  'restore',
  'shutdown',
  'kill',
  'dbcc',
  'bulk',
  'openrowset',
  'openquery',
  'opendatasource',
  'use',
  'go',
  'set',
  'print',
  'raiserror',
  'throw',
  'while',
  'if',
  'goto',
  'return',
  'begin',
  'commit',
  'rollback',
  'into'
]);

// Keywords that are legitimate inside a parenthesised subquery (IN (...),
// EXISTS (...)) but at paren depth 0 would turn the filter into a different
// query — a set operator pulling rows from another table, a second statement,
// or a trailing clause that changes the result shape.
export const WHERE_CLAUSE_TOP_LEVEL_FORBIDDEN_KEYWORDS = new Set([
  'select',
  'union',
  'except',
  'intersect',
  'order',
  'group',
  'having',
  'option',
  'for'
]);

const WHERE_CLAUSE_FORBIDDEN_TOKENS = [';', '--', '/*', '*/'];

const UNBALANCED_REASON = 'unbalanced parentheses in WHERE clause.';

/**
 * Given the index of an opening single quote, returns the index of the closing
 * quote, treating '' as an escaped quote. An unterminated literal runs to the
 * end of the clause.
 */
function indexOfLiteralEnd(clause, openIndex) {
  let i = openIndex + 1;
  while (i < clause.length) {
    if (clause.charAt(i) !== "'") {
      i++;
    } else if (clause.charAt(i + 1) === "'") {
      i += 2; // escaped quote inside literal
    } else {
      return i;
    }
  }
  return clause.length - 1;
}

/**
 * Removes string literals ('...', with '' escapes) and bracketed identifiers
 * ([...]) so that values like 'a;b' or columns like [Set] are not mistaken for
 * SQL syntax.
 */
export function stripWhereClauseLiterals(clause) {
  let out = '';
  let i = 0;
  while (i < clause.length) {
    const ch = clause.charAt(i);
    if (ch === "'") {
      i = indexOfLiteralEnd(clause, i);
      out += "''";
    } else if (ch === '[') {
      const close = clause.indexOf(']', i + 1);
      i = close === -1 ? clause.length - 1 : close;
      out += '[]';
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}

function isWordChar(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_';
}

function nextDepth(ch, depth) {
  if (ch === '(') return depth + 1;
  if (ch === ')') return depth - 1;
  return depth;
}

/**
 * Splits a literal-stripped, lower-cased clause into words tagged with the
 * parenthesis depth at which they occur.
 *
 * @returns {{ words: Array<{word: string, depth: number}>, balanced: boolean }}
 */
export function tokenizeWhereClause(lexical) {
  const words = [];
  let depth = 0;
  let minDepth = 0;
  let word = '';

  for (const ch of `${lexical.toLowerCase()} `) {
    if (isWordChar(ch)) {
      word += ch;
      continue;
    }
    if (word) {
      words.push({ word, depth });
      word = '';
    }
    depth = nextDepth(ch, depth);
    minDepth = Math.min(minDepth, depth);
  }

  return { words, balanced: depth === 0 && minDepth === 0 };
}

/**
 * Reason a single word is not allowed at the given parenthesis depth, or null.
 */
function forbiddenWordReason({ word, depth }) {
  if (
    WHERE_CLAUSE_FORBIDDEN_KEYWORDS.has(word) ||
    word.startsWith('xp_') ||
    word.startsWith('sp_')
  ) {
    return `statement keyword '${word.toUpperCase()}' is not allowed in a WHERE clause; it must be a single predicate. Bracket identifiers that collide with keywords, or use execute_query for full statements.`;
  }
  if (depth === 0 && WHERE_CLAUSE_TOP_LEVEL_FORBIDDEN_KEYWORDS.has(word)) {
    return `'${word.toUpperCase()}' is only allowed inside a parenthesised subquery; the WHERE clause must be a single predicate on the requested table. Use execute_query for full statements.`;
  }
  return null;
}

/**
 * Returns a human-readable reason if the clause contains a batch separator,
 * comment, statement keyword, top-level set operator/SELECT, or unbalanced
 * parentheses; null when it looks like a plain predicate.
 *
 * @param {string} clause - Raw WHERE clause conditions (without the WHERE keyword)
 * @returns {string|null}
 */
export function findForbiddenWhereClauseSyntax(clause) {
  const lexical = stripWhereClauseLiterals(clause);

  const token = WHERE_CLAUSE_FORBIDDEN_TOKENS.find(t => lexical.includes(t));
  if (token) {
    return `batch separators and comments are not allowed in a WHERE clause (found '${token}'). Use execute_query for full statements.`;
  }

  const { words, balanced } = tokenizeWhereClause(lexical);
  const keywordReason = words.map(forbiddenWordReason).find(Boolean);
  if (keywordReason) {
    return keywordReason;
  }

  return balanced ? null : UNBALANCED_REASON;
}
