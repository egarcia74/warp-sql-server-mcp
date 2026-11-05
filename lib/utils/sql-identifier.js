/**
 * Shared helpers for safely embedding SQL identifiers in queries.
 */

/**
 * Validate a database name for safe inline use in DB_ID(N'...').
 * Rejects names containing square brackets and doubles single quotes so the
 * value cannot break out of the N'...' literal.
 * @param {string|null|undefined} database - Database name (or null/undefined)
 * @returns {string|null} sanitized name (single quotes doubled), or null
 * @throws {Error} if the name is not a string or contains square brackets
 */
export function sanitizeDbName(database) {
  if (database === null || database === undefined) {
    return null;
  }
  if (typeof database !== 'string' || /[[\]]/.test(database)) {
    throw new TypeError(`Invalid database name: ${database}`);
  }
  return database.replaceAll("'", "''");
}

/**
 * Escape an identifier for safe inline use inside bracket quoting, e.g.
 * `USE [${escapeBracketIdentifier(name)}]`. Doubling `]` prevents the value
 * from breaking out of the [...] quoting, which is the only escape character
 * in a delimited (bracketed) SQL Server identifier.
 * @param {string} identifier - SQL identifier (database/schema/table name)
 * @returns {string} identifier with `]` doubled
 * @throws {Error} if the identifier is not a string
 */
export function escapeBracketIdentifier(identifier) {
  if (typeof identifier !== 'string') {
    throw new TypeError(`Invalid SQL identifier: ${identifier}`);
  }
  return identifier.replaceAll(']', ']]');
}

/**
 * Escape a value for safe inline use inside a single-quoted string literal, e.g.
 * `WHERE name = '${escapeSqlStringLiteral(value)}'`. Doubling `'` prevents the
 * value from breaking out of the '...' literal, which is the only escape
 * character in a SQL Server string literal. Brackets are ordinary characters
 * inside a string literal and are intentionally left untouched.
 *
 * CAUTION: use this ONLY for values placed inside a single-quoted `'...'` string
 * literal. A value used as a bracketed identifier (`[ ... ]`) must instead be
 * escaped with `escapeBracketIdentifier` — this function does not neutralize the
 * `]` that would break out of bracket quoting.
 * @param {string} value - value to embed inside a single-quoted literal
 * @returns {string} value with `'` doubled
 * @throws {TypeError} if the value is not a string
 */
export function escapeSqlStringLiteral(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid SQL string literal: ${value}`);
  }
  return value.replaceAll("'", "''");
}

/**
 * Coerce a caller-supplied pagination value (limit/offset) to a safe integer for
 * inline use in `OFFSET ... ROWS` / `FETCH NEXT ... ROWS` / `TOP ...` clauses.
 * Returns the fallback when the value is null/undefined; otherwise any value
 * coercible by `Number()` (e.g. a numeric string like `"25"`) is accepted and the
 * resulting integer is returned, provided it is an integer >= min. Only a LOWER
 * bound (`min`) is enforced — there is no upper cap, so large values still pass.
 * @param {*} value - caller-supplied value (number or Number()-coercible string)
 * @param {object} opts
 * @param {string} opts.name - parameter name used in the error message
 * @param {number} opts.min - minimum allowed integer value (lower bound only)
 * @param {*} opts.fallback - value returned when input is null/undefined
 * @returns {number|*} the resulting integer, or the fallback
 * @throws {TypeError} if the value is non-null and is not an integer >= min
 *   (e.g. a non-numeric string, a fraction, or a value below `min`)
 */
export function parseRowCount(value, { name, min, fallback }) {
  if (value == null) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new TypeError(`Invalid ${name}: expected an integer >= ${min}`);
  }
  return n;
}

/** Find a closing delimiter, respecting doubled SQL escapes; -1 if incomplete. */
export function findSqlDelimiterEnd(text, start, delimiter) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] !== delimiter) continue;
    if (text[i + 1] === delimiter) i++;
    else return i;
  }
  return -1;
}

function skipCatalogWhitespace(text, start) {
  while (start < text.length && /\s/.test(text[start])) start++;
  return start;
}

/** Decode the bracket-quoted column list returned by missing-index DMVs. */
export function parseCatalogColumns(text) {
  if (text == null || text === '') return [];
  if (typeof text !== 'string') throw new TypeError('Invalid catalog column list');
  const columns = [];
  let i = 0;
  while (i < text.length) {
    i = skipCatalogWhitespace(text, i);
    if (text[i] !== '[') throw new TypeError('Invalid catalog column list');
    const end = findSqlDelimiterEnd(text, i, ']');
    if (end < 0 || end === i + 1) throw new TypeError('Invalid catalog column list');
    columns.push(text.slice(i + 1, end).replaceAll(']]', ']'));
    i = end + 1;
    i = skipCatalogWhitespace(text, i);
    if (i === text.length) break;
    if (text[i++] !== ',' || !text.slice(i).trim()) {
      throw new TypeError('Invalid catalog column list');
    }
  }
  return columns;
}
