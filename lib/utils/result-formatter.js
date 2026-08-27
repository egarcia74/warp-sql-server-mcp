/**
 * Plain-text result formatting for execute_query output.
 *
 * These helpers render a recordset as a monospaced, pipe-delimited text table.
 * They were extracted verbatim from SqlServerMCP so the formatting can be
 * tested in isolation; the richer, configurable formatting used elsewhere lives
 * in `response-formatter.js` (the ResponseFormatter class) and is unrelated.
 */

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
  const rows = data.map(row => headers.map(header => String(row[header] || '')));

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
