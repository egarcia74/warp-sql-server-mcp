/**
 * CSV serialisation, in one place.
 *
 * There were THREE independent CSV writers in this codebase for one format:
 * `StreamingHandler.batchToCsv` (streaming export), `DatabaseTools.recordsetToCsv`
 * (non-streaming export) and `BaseToolHandler.formatAsCsv` (the `formatResults(result, 'csv')`
 * path). Only the middle one was correct. The streaming writer terminated rows with `'\\n'` - a
 * TWO-CHARACTER string in JavaScript, backslash and n, not a newline - so every streamed export
 * was one unparseable line, and `formatAsCsv` quoted on comma and double quote only, leaving a
 * value containing CR or LF to break the record and header names unescaped entirely. A
 * one-character defect survived a year because the path most exercised by tests and small
 * exports was the correct one. All three now call these helpers.
 *
 * Records are terminated with LF, not the CRLF of RFC 4180's grammar. That is deliberate: it
 * matches the writer here that was already correct, keeps stray `\r` out of MCP text responses,
 * and is accepted by every mainstream reader including Excel. The RFC's FIELD rules - when to
 * quote, and doubling embedded quotes - are followed exactly, and those are what decide whether
 * a file parses at all.
 */

/** Row terminator. A real newline; readers accept LF, CRLF and CR. */
export const CSV_ROW_TERMINATOR = '\n';

/**
 * RFC 4180: a field must be quoted if it contains the delimiter, a double quote, or a line
 * break. CR is included as well as LF - a lone CR inside an unquoted field breaks the row
 * for any reader that treats CR as a terminator.
 */
const MUST_QUOTE = /[",\r\n]/;

/**
 * One CSV cell: null and undefined become empty, and a value needing quotes gets them with
 * its own double quotes doubled.
 * @param {*} value - Cell value
 * @returns {string} The serialised cell
 */
export function csvEscapeCell(value) {
  if (value === null || value === undefined) return '';

  const stringValue = String(value);
  if (MUST_QUOTE.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/**
 * One CSV record, terminator included.
 * @param {Array<*>} cells - Cell values in column order
 * @returns {string} The serialised row
 */
export function csvRow(cells) {
  return cells.map(csvEscapeCell).join(',') + CSV_ROW_TERMINATOR;
}
