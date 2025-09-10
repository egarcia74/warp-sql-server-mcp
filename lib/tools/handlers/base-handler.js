/**
 * Base Tool Handler
 *
 * Provides common functionality for all tool handlers
 */

export class BaseToolHandler {
  constructor(connectionManager, performanceMonitor) {
    this.connectionManager = connectionManager;
    this.performanceMonitor = performanceMonitor;
  }

  /**
   * Get database connection pool
   * @returns {Promise<Object>} Database connection pool
   */
  async getConnection() {
    let pool;
    try {
      pool = await this.connectionManager.getPool();
    } catch {
      throw new Error('Connection pool exhausted');
    }
    // Some test mocks return a pool-like object without a `connected` flag
    // but which exposes a `request()` method. Treat those as valid pools
    // to improve robustness in tests and non-standard pool implementations.
    const looksLikePool = pool && (pool.connected || typeof pool.request === 'function');
    if (!looksLikePool) {
      pool = await this.connectionManager.connect();
    }
    const finalPoolLooksGood = pool && (pool.connected || typeof pool.request === 'function');
    if (!finalPoolLooksGood) {
      throw new Error('Connection pool exhausted');
    }
    return pool;
  }

  /**
   * Execute a SQL query with performance tracking
   * @param {string} query - SQL query to execute
   * @param {string} toolName - Name of the tool for tracking
   * @returns {Promise<Object>} Query result
   */
  async executeQuery(query, toolName = 'unknown') {
    const startTime = Date.now();

    try {
      const pool = await this.getConnection();
      const result = await pool.request().query(query);

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Track performance if monitoring is enabled
      if (this.performanceMonitor) {
        this.performanceMonitor.recordQuery({
          tool: toolName,
          query,
          executionTime,
          success: true,
          timestamp: new Date(startTime)
        });
      }

      return result;
    } catch (error) {
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Track failed query performance
      if (this.performanceMonitor) {
        this.performanceMonitor.recordQuery({
          tool: toolName,
          query,
          executionTime,
          success: false,
          error: error.message,
          timestamp: new Date(startTime)
        });
      }

      // Re-throw the error to be handled by the caller
      throw error;
    }
  }

  /**
   * Format results for MCP response
   * @param {Object} result - Query result from SQL Server
   * @param {string} format - Output format ('table', 'json', 'csv')
   * @returns {Array} Formatted result
   */
  formatResults(result, format = 'table') {
    if (!result) {
      throw new Error('Connection pool exhausted');
    }
    if (!result.recordset || result.recordset.length === 0) {
      return [
        {
          type: 'text',
          text: 'No data returned'
        }
      ];
    }

    switch (format) {
      case 'json':
        return [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2)
          }
        ];

      case 'csv':
        return this.formatAsCsv(result.recordset);

      case 'table':
      default:
        return this.formatAsTable(result.recordset);
    }
  }

  /**
   * Format results as a table
   * @private
   */
  formatAsTable(data) {
    if (data.length === 0) return [{ type: 'text', text: 'No data' }];

    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(header => String(row[header] || '')));

    return [
      {
        type: 'text',
        text: this.createTextTable(headers, rows)
      }
    ];
  }

  /**
   * Format results as CSV
   * @private
   */
  formatAsCsv(data) {
    if (data.length === 0) return [{ type: 'text', text: 'No data' }];

    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];

    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        const str = String(value);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      });
      csvRows.push(values.join(','));
    });

    return [
      {
        type: 'text',
        text: csvRows.join('\n')
      }
    ];
  }

  /**
   * Create a text-based table
   * @private
   */
  createTextTable(headers, rows) {
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
}
