/**
 * Response Formatter for MCP Tool Responses
 * Provides configurable output formats for better integration
 */
export class ResponseFormatter {
  constructor(config = {}) {
    this.config = {
      // Response format: 'structured', 'json', 'pretty-json'
      format: config.format || process.env.SQL_SERVER_RESPONSE_FORMAT || 'structured',
      // Whether to include metadata in responses
      includeMetadata: config.includeMetadata ?? true,
      // Whether to include performance metrics
      includePerformance: config.includePerformance ?? false,
      // Maximum response size (in characters) before truncation
      maxResponseSize: config.maxResponseSize || 1000000, // 1MB
      ...config
    };
  }

  /**
   * Formats a query execution result
   * @param {object} result - Raw query result from mssql
   * @param {object} context - Execution context
   * @returns {object} Formatted MCP response
   */
  formatQueryResult(result, context = {}) {
    const startTime = context.startTime || Date.now();
    const endTime = Date.now();
    const duration = endTime - startTime;

    const baseData = {
      success: true,
      rowsAffected: result.rowsAffected || [],
      recordset: result.recordset || [],
      recordsets: result.recordsets || []
    };

    // Add metadata if enabled
    if (this.config.includeMetadata) {
      baseData.metadata = {
        query: context.query ? this.truncateQuery(context.query) : undefined,
        database: context.database,
        tool: context.toolName,
        timestamp: new Date().toISOString()
      };
    }

    // Add performance metrics if enabled
    if (this.config.includePerformance) {
      baseData.performance = {
        duration,
        queryExecutionTime: duration,
        resultSize: this.calculateResultSize(baseData.recordset),
        recordCount: baseData.recordset ? baseData.recordset.length : 0
      };
    }

    // Include safety info
    if (context.securityConfig) {
      baseData.security = {
        readOnlyMode: context.securityConfig.readOnlyMode,
        destructiveOperationsAllowed: context.securityConfig.allowDestructiveOperations,
        schemaChangesAllowed: context.securityConfig.allowSchemaChanges
      };
    }

    return this.formatResponse(baseData);
  }

  /**
   * Formats a table data result
   * @param {object} result - Raw query result
   * @param {object} context - Execution context
   * @returns {object} Formatted MCP response
   */
  formatTableData(result, context = {}) {
    const baseData = {
      success: true,
      table: `${context.schema || 'dbo'}.${context.tableName}`,
      rowCount: result.recordset ? result.recordset.length : 0,
      data: result.recordset || [],
      columns: this.extractColumnInfo(result.recordset)
    };

    if (this.config.includeMetadata) {
      baseData.metadata = {
        database: context.database,
        schema: context.schema || 'dbo',
        table: context.tableName,
        limit: context.limit,
        whereClause: context.whereClause,
        timestamp: new Date().toISOString()
      };
    }

    return this.formatResponse(baseData);
  }

  /**
   * Formats a CSV export result
   * @param {string} csvData - CSV content
   * @param {object} context - Export context
   * @returns {object} Formatted MCP response
   */
  formatCsvExport(csvData, context = {}) {
    const baseData = {
      success: true,
      table: `${context.schema || 'dbo'}.${context.tableName}`,
      format: 'csv',
      csvData: csvData,
      rowCount: context.rowCount || 0,
      columnCount: context.columnCount || 0
    };

    if (this.config.includeMetadata) {
      baseData.metadata = {
        database: context.database,
        schema: context.schema || 'dbo',
        table: context.tableName,
        exportSize: csvData.length,
        timestamp: new Date().toISOString()
      };
    }

    return this.formatResponse(baseData);
  }

  /**
   * Formats a list result (databases, tables, etc.)
   * @param {array} items - Array of items
   * @param {object} context - List context
   * @returns {object} Formatted MCP response
   */
  formatListResult(items, context = {}) {
    const baseData = {
      success: true,
      items: items || [],
      count: items ? items.length : 0
    };

    if (this.config.includeMetadata) {
      baseData.metadata = {
        listType: context.listType || 'unknown',
        database: context.database,
        schema: context.schema,
        timestamp: new Date().toISOString()
      };
    }

    return this.formatResponse(baseData);
  }

  /**
   * Formats an error response
   * @param {Error} error - Error object
   * @param {object} context - Error context
   * @returns {object} Formatted MCP error response
   */
  formatError(error, context = {}) {
    const errorData = {
      success: false,
      error: {
        name: error.name,
        message: error.message,
        code: error.code || 'UNKNOWN_ERROR'
      }
    };

    if (this.config.includeMetadata) {
      errorData.metadata = {
        tool: context.toolName,
        query: context.query ? this.truncateQuery(context.query) : undefined,
        database: context.database,
        timestamp: new Date().toISOString()
      };
    }

    // Include stack trace in development
    if (process.env.NODE_ENV !== 'production' && error.stack) {
      errorData.error.stack = error.stack;
    }

    return this.formatResponse(errorData);
  }

  /**
   * Formats the final response based on configured format
   * @param {object} data - Data to format
   * @returns {object} MCP-compatible response
   */
  formatResponse(data) {
    // Check response size and truncate if necessary
    const responseSize = JSON.stringify(data).length;
    if (responseSize > this.config.maxResponseSize) {
      data = this.truncateResponse(data, responseSize);
    }

    const content = [];

    switch (this.config.format) {
      case 'structured':
        // Return structured data for programmatic consumption
        content.push({
          type: 'text',
          text: JSON.stringify(data)
        });
        break;

      case 'json':
        // Return compact JSON
        content.push({
          type: 'text',
          text: JSON.stringify(data)
        });
        break;

      case 'pretty-json':
        // Return pretty-printed JSON (original behavior)
        content.push({
          type: 'text',
          text: JSON.stringify(data, null, 2)
        });
        break;

      default:
        // Default to structured format
        content.push({
          type: 'text',
          text: JSON.stringify(data)
        });
    }

    return { content };
  }

  /**
   * Extracts column information from recordset
   * @param {array} recordset - Query recordset
   * @returns {array} Column metadata
   */
  extractColumnInfo(recordset) {
    if (!recordset || recordset.length === 0) {
      return [];
    }

    const firstRow = recordset[0];
    return Object.keys(firstRow).map(columnName => ({
      name: columnName,
      type: this.inferColumnType(firstRow[columnName])
    }));
  }

  /**
   * Infers column type from sample data
   * @param {*} value - Sample value
   * @returns {string} Inferred type
   */
  inferColumnType(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'decimal';
    }
    if (typeof value === 'boolean') return 'boolean';
    if (value instanceof Date) return 'datetime';
    if (typeof value === 'string') {
      // Try to infer more specific string types
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
      if (value.length === 36 && /^[0-9a-f-]+$/i.test(value)) return 'guid';
      return 'string';
    }
    return 'unknown';
  }

  /**
   * Calculates approximate size of result data
   * @param {*} data - Data to measure
   * @returns {number} Size in bytes (approximate)
   */
  calculateResultSize(data) {
    return JSON.stringify(data || {}).length;
  }

  /**
   * Truncates a query for logging/metadata
   * @param {string} query - SQL query
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated query
   */
  truncateQuery(query, maxLength = 200) {
    if (!query || query.length <= maxLength) {
      return query;
    }
    return `${query.substring(0, maxLength)}...`;
  }

  /**
   * Truncates response data when it exceeds size limits
   * @param {object} data - Response data
   * @param {number} currentSize - Current response size
   * @returns {object} Truncated response data
   */
  truncateResponse(data, currentSize) {
    const truncatedData = { ...data };

    // Add truncation warning
    truncatedData.truncated = true;
    truncatedData.originalSize = currentSize;
    truncatedData.maxSize = this.config.maxResponseSize;

    // Truncate recordset data if present
    if (data.recordset && Array.isArray(data.recordset)) {
      const estimatedRowSize = JSON.stringify(data.recordset[0] || {}).length;
      const maxRows = Math.floor(this.config.maxResponseSize / 2 / estimatedRowSize);

      if (maxRows < data.recordset.length) {
        truncatedData.recordset = data.recordset.slice(0, maxRows);
        truncatedData.truncatedRows = data.recordset.length - maxRows;
      }
    }

    // Truncate CSV data if present
    if (data.csvData && data.csvData.length > this.config.maxResponseSize / 2) {
      const lines = data.csvData.split('\n');
      const headerLine = lines[0];
      const maxLines = Math.floor(this.config.maxResponseSize / 2 / (headerLine.length + 10));

      truncatedData.csvData = [headerLine, ...lines.slice(1, maxLines)].join('\n');
      truncatedData.truncatedLines = lines.length - maxLines - 1;
    }

    return truncatedData;
  }

  /**
   * Updates formatter configuration
   * @param {object} newConfig - New configuration options
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Gets current configuration
   * @returns {object} Current configuration
   */
  getConfig() {
    return { ...this.config };
  }
}
