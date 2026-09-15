/**
 * Plain-text result formatting for execute_query output.
 *
 * These helpers render a recordset as a monospaced, pipe-delimited text table.
 * They were extracted verbatim from SqlServerMCP so the formatting can be
 * tested in isolation.
 *
 * This module's header used to claim it was "the only result formatter". That was
 * wrong: `BaseToolHandler` carried a byte-identical `createTextTable` and its own
 * `formatAsTable`, and the pair drifted in the way duplicated formatters always do -
 * both wrote `String(row[header] || '')`, so a cell holding `0`, `false` or `0.0`
 * rendered as an empty string, indistinguishable from NULL, in the default output of
 * every tool. `BaseToolHandler` now delegates here, as `index.js` already did.
 */

/**
 * One table cell.
 *
 * `??`, never `||`: a cell holding `0`, `false` or `0.0` is a VALUE, and `||` collapsed
 * every one of them to an empty string - identical to how NULL renders, so a count of zero
 * or a false flag silently read as "no data". Only null and undefined become empty.
 *
 * @param {*} value - Raw cell value from the recordset
 * @returns {string} The rendered cell
 */
export function formatCell(value) {
  return String(value ?? '');
}

/**
 * Format query results as an MCP text-table response.
 *
 * @param {Array<object>} data - recordset rows
 * @returns {{content: Array<{type: string, text: string}>}}
 */
export function formatQueryResults(data) {
  // Explicit assignment form: PMD's ECMAScript parser misreads a returned
  // object literal here as an unnecessary block.
  if (data.length === 0) {
    const empty = { content: [{ type: 'text', text: 'No data returned' }] };
    return empty;
  }

  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(header => formatCell(row[header])));

  const response = {
    content: [
      {
        type: 'text',
        text: createTextTable(headers, rows)
      }
    ]
  };
  return response;
}

/**
 * Create a text-based table from headers and pre-stringified rows.
 *
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {string}
 */
export function createTextTable(headers, rows) {
  const colWidths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map(row => String(row[i]).length))
  );

  const separator = colWidths.map(width => '-'.repeat(width)).join(' | ');
  const headerRow = headers.map((header, i) => header.padEnd(colWidths[i])).join(' | ');
  const dataRows = rows.map(row =>
    row.map((cell, i) => String(cell).padEnd(colWidths[i])).join(' | ')
  );

  return [headerRow, separator, ...dataRows].join('\n');
}
