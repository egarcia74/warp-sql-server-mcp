/**
 * CSV serialisation, in one place.
 *
 * There were two CSV writers in this codebase - `StreamingHandler.batchToCsv` for the
 * streaming export path and `DatabaseTools.recordsetToCsv` for the non-streaming one - and
 * they drifted: the streaming one terminated rows with `'\\n'`, a TWO-CHARACTER string in
 * JavaScript (backslash, n) rather than a newline, so every streamed export was a single
 * unparseable line, while the non-streaming one was correct the whole time. Same output
 * format, two implementations, one of them wrong for a year. Both now call these helpers.
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
