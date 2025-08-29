import sql from 'mssql';

/**
 * Streaming Data Handler for Large Query Results
 * Provides streaming capabilities to handle large datasets without memory issues
 */
export class StreamingHandler {
  constructor(config = {}) {
    this.config = {
      // Maximum rows to process in memory at once
      batchSize: config.batchSize || 1000,
      // Maximum memory usage before switching to streaming (in MB)
      maxMemoryMB: config.maxMemoryMB || 50,
      // Maximum response size before chunking (in characters)
      maxResponseSize: config.maxResponseSize || 1000000, // 1MB
      // Whether to enable streaming by default
      enableStreaming: config.enableStreaming ?? true,
      ...config
    };
  }

  /**
   * Executes a query with automatic streaming based on size
   * @param {object} request - SQL request object
   * @param {string} query - SQL query to execute
   * @param {object} context - Execution context
   * @returns {Promise<object>} Query result with streaming metadata
   */
  async executeQueryWithStreaming(request, query, context = {}) {
    const startTime = Date.now();

    // First, check if we should stream based on query complexity
    const shouldStream = await this.shouldStreamQuery(request, query, context);

    if (shouldStream) {
      return await this.executeStreamingQuery(request, query, context, startTime);
    } else {
      return await this.executeRegularQuery(request, query, context, startTime);
    }
  }

  /**
   * Determines if a query should be streamed
   * @param {object} request - SQL request object
   * @param {string} query - SQL query
   * @param {object} context - Execution context
   * @returns {Promise<boolean>} Whether to use streaming
   */
  async shouldStreamQuery(request, query, context) {
    if (!this.config.enableStreaming) {
      return false;
    }

    // Force streaming for specific operations
    if (context.forceStreaming) {
      return true;
    }

    // Check if query indicates large result set
    const largResultIndicators = [
      /SELECT\s+\*\s+FROM\s+\w+\s*$/i, // SELECT * without WHERE/LIMIT
      /BULK\s+/i,
      /EXPORT\s+/i,
      /BACKUP\s+/i
    ];

    if (largResultIndicators.some(pattern => pattern.test(query))) {
      return true;
    }

    // For table data operations, check table size if possible
    if (context.tableName && context.schema) {
      try {
        const sizeQuery = `
          SELECT 
            SUM(p.rows) as estimated_rows,
            SUM(a.total_pages) * 8 / 1024 as estimated_size_mb
          FROM sys.tables t
          INNER JOIN sys.partitions p ON t.object_id = p.object_id
          INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
          INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
          WHERE t.name = '${context.tableName}' 
            AND s.name = '${context.schema}'
            AND p.index_id <= 1
        `;

        const sizeResult = await request.query(sizeQuery);
        const stats = sizeResult.recordset[0];

        // Stream if table has > 10k rows or > 10MB
        if (stats.estimated_rows > 10000 || stats.estimated_size_mb > 10) {
          return true;
        }
      } catch (error) {
        console.warn('Could not determine table size for streaming decision:', error.message);
      }
    }

    return false;
  }

  /**
   * Executes a regular (non-streaming) query
   * @param {object} request - SQL request object
   * @param {string} query - SQL query
   * @param {object} context - Execution context
   * @param {number} startTime - Execution start time
   * @returns {Promise<object>} Query result
   */
  async executeRegularQuery(request, query, context, startTime) {
    const result = await request.query(query);

    return {
      success: true,
      recordset: result.recordset,
      recordsets: result.recordsets,
      rowsAffected: result.rowsAffected,
      streaming: false,
      performance: {
        duration: Date.now() - startTime,
        rowCount: result.recordset ? result.recordset.length : 0,
        memoryUsed: this.estimateMemoryUsage(result.recordset)
      }
    };
  }

  /**
   * Executes a query with streaming processing
   * @param {object} request - SQL request object
   * @param {string} query - SQL query
   * @param {object} context - Execution context
   * @param {number} startTime - Execution start time
   * @returns {Promise<object>} Streaming query result
   */
  async executeStreamingQuery(request, query, context, startTime) {
    const chunks = [];
    let totalRows = 0;
    let currentBatch = [];
    let chunkCount = 0;

    return new Promise((resolve, reject) => {
      const streamRequest = new sql.Request(request.parent);
      streamRequest.stream = true;

      streamRequest.on('recordset', columns => {
        // Record the column metadata
        context.columns = columns;
      });

      streamRequest.on('row', row => {
        totalRows++;
        currentBatch.push(row);

        // Process batch when it reaches the configured size
        if (currentBatch.length >= this.config.batchSize) {
          this.processBatch(currentBatch, chunks, ++chunkCount, context);
          currentBatch = [];
        }
      });

      streamRequest.on('done', result => {
        // Process final batch if any rows remain
        if (currentBatch.length > 0) {
          this.processBatch(currentBatch, chunks, ++chunkCount, context);
        }

        resolve({
          success: true,
          streaming: true,
          chunks: chunks,
          chunkCount: chunkCount,
          totalRows: totalRows,
          rowsAffected: result.rowsAffected,
          performance: {
            duration: Date.now() - startTime,
            rowCount: totalRows,
            avgBatchSize: totalRows / chunkCount || 0,
            memoryEfficient: true
          }
        });
      });

      streamRequest.on('error', error => {
        reject(error);
      });

      // Execute the streaming query
      streamRequest.query(query);
    });
  }

  /**
   * Processes a batch of rows for streaming
   * @param {array} batch - Batch of rows
   * @param {array} chunks - Array to store chunks
   * @param {number} chunkNumber - Current chunk number
   * @param {object} context - Processing context
   */
  processBatch(batch, chunks, chunkNumber, context) {
    let processedData;

    // Process based on output format
    switch (context.outputFormat) {
      case 'csv':
        processedData = this.batchToCsv(batch, context);
        break;
      case 'json':
        processedData = this.batchToJson(batch, context);
        break;
      default:
        processedData = batch;
    }

    chunks.push({
      chunkNumber,
      data: processedData,
      rowCount: batch.length,
      size: JSON.stringify(processedData).length
    });
  }

  /**
   * Converts a batch to CSV format
   * @param {array} batch - Batch of rows
   * @param {object} context - Processing context
   * @returns {string} CSV data
   */
  batchToCsv(batch, context) {
    if (batch.length === 0) return '';

    let csvContent = '';

    // Add header only for first chunk
    if (!context.csvHeaderAdded) {
      const headers = Object.keys(batch[0]);
      csvContent += headers.join(',') + '\\n';
      context.csvHeaderAdded = true;
    }

    // Add data rows
    for (const row of batch) {
      const values = Object.values(row).map(value => {
        if (value === null || value === undefined) return '';

        const stringValue = String(value);
        // Escape commas, quotes, and newlines
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });

      csvContent += values.join(',') + '\\n';
    }

    return csvContent;
  }

  /**
   * Converts a batch to JSON format
   * @param {array} batch - Batch of rows
   * @param {object} context - Processing context
   * @returns {string} JSON data
   */
  batchToJson(batch, context) {
    return JSON.stringify(batch, null, context.prettyPrint ? 2 : undefined);
  }

  /**
   * Executes a table export with streaming
   * @param {object} request - SQL request object
   * @param {string} tableName - Table to export
   * @param {object} options - Export options
   * @returns {Promise<object>} Export result
   */
  async streamTableExport(request, tableName, options = {}) {
    const {
      schema = 'dbo',
      database = null,
      limit = null,
      whereClause = null,
      outputFormat = 'csv'
    } = options;

    // Build the streaming query
    let query = `SELECT${limit ? ` TOP ${limit}` : ''} * FROM [${schema}].[${tableName}]`;

    if (whereClause) {
      query += ` WHERE ${whereClause}`;
    }

    const context = {
      tableName,
      schema,
      database,
      outputFormat,
      forceStreaming: true,
      csvHeaderAdded: false
    };

    // Switch to target database if specified
    if (database) {
      await request.query(`USE [${database}]`);
    }

    return await this.executeQueryWithStreaming(request, query, context);
  }

  /**
   * Estimates memory usage of a recordset
   * @param {array} recordset - Query recordset
   * @returns {number} Estimated memory usage in MB
   */
  estimateMemoryUsage(recordset) {
    if (!recordset || recordset.length === 0) return 0;

    // Rough estimation based on JSON serialization size
    const sampleSize = Math.min(recordset.length, 100);
    const sampleData = recordset.slice(0, sampleSize);
    const avgRowSize = JSON.stringify(sampleData).length / sampleSize;

    return (avgRowSize * recordset.length) / (1024 * 1024); // Convert to MB
  }

  /**
   * Reconstructs full data from streaming chunks
   * @param {array} chunks - Array of data chunks
   * @param {string} outputFormat - Output format ('json', 'csv', 'raw')
   * @returns {*} Reconstructed data
   */
  reconstructFromChunks(chunks, outputFormat = 'json') {
    if (!chunks || chunks.length === 0) {
      return outputFormat === 'csv' ? '' : [];
    }

    switch (outputFormat) {
      case 'csv':
        return chunks.map(chunk => chunk.data).join('');

      case 'json': {
        const allRows = [];
        chunks.forEach(chunk => {
          if (typeof chunk.data === 'string') {
            allRows.push(...JSON.parse(chunk.data));
          } else {
            allRows.push(...chunk.data);
          }
        });
        return allRows;
      }

      default:
        return chunks.flatMap(chunk => chunk.data);
    }
  }

  /**
   * Updates streaming configuration
   * @param {object} newConfig - New configuration options
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Gets current streaming configuration
   * @returns {object} Current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Gets streaming statistics
   * @param {object} streamingResult - Result from streaming operation
   * @returns {object} Statistics object
   */
  getStreamingStats(streamingResult) {
    if (!streamingResult.streaming) {
      return {
        streaming: false,
        memoryEfficient: false,
        totalRows: streamingResult.rowCount || 0
      };
    }

    return {
      streaming: true,
      memoryEfficient: true,
      totalRows: streamingResult.totalRows,
      chunkCount: streamingResult.chunkCount,
      avgChunkSize: streamingResult.totalRows / streamingResult.chunkCount,
      performance: streamingResult.performance
    };
  }
}
