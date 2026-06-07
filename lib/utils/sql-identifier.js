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
