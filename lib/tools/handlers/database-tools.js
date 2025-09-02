/**
 * Database Tools Handler
 *
 * Handles database-related operations like listing databases, tables, etc.
 */

import { BaseToolHandler } from './base-handler.js';
import { StreamingHandler } from '../../utils/streaming-handler.js';

export class DatabaseToolsHandler extends BaseToolHandler {
  constructor(connectionManager, performanceMonitor) {
    super(connectionManager, performanceMonitor);

    // Initialize streaming handler for large data operations
    this.streamingHandler = new StreamingHandler({
      batchSize: 1000,
      maxMemoryMB: 50,
      maxResponseSize: 1000000, // 1MB
      enableStreaming: true
    });
  }
  /**
   * List all databases on the SQL Server instance
   */
  async listDatabases() {
    const query = `
      SELECT 
        name as database_name,
        database_id,
        create_date,
        collation_name,
        state_desc as state
      FROM sys.databases 
      WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
      ORDER BY name
    `;

    const result = await this.executeQuery(query, 'list_databases');
    return this.formatResults(result);
  }

  /**
   * List all tables in a specific database
   */
  async listTables(database = null, schema = 'dbo') {
    let query;

    if (database) {
      query = `
        SELECT 
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM [${database}].INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema}'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
      `;
    } else {
      query = `
        SELECT 
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema}'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
      `;
    }

    const result = await this.executeQuery(query, 'list_tables');
    return this.formatResults(result);
  }

  /**
   * Get detailed schema information for a specific table
   */
  async describeTable(tableName, database = null, schema = 'dbo') {
    let query;

    if (database) {
      query = `
        SELECT 
          c.COLUMN_NAME as column_name,
          c.DATA_TYPE as data_type,
          c.IS_NULLABLE as is_nullable,
          c.COLUMN_DEFAULT as column_default,
          c.CHARACTER_MAXIMUM_LENGTH as max_length,
          c.NUMERIC_PRECISION as precision,
          c.NUMERIC_SCALE as scale,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'YES' ELSE 'NO' END as is_primary_key
        FROM [${database}].INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN [${database}].INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
          ON c.TABLE_NAME = tc.TABLE_NAME 
          AND c.TABLE_SCHEMA = tc.TABLE_SCHEMA 
          AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        LEFT JOIN [${database}].INFORMATION_SCHEMA.KEY_COLUMN_USAGE pk 
          ON c.COLUMN_NAME = pk.COLUMN_NAME 
          AND c.TABLE_NAME = pk.TABLE_NAME 
          AND c.TABLE_SCHEMA = pk.TABLE_SCHEMA 
          AND tc.CONSTRAINT_NAME = pk.CONSTRAINT_NAME
        WHERE c.TABLE_NAME = '${tableName}' 
          AND c.TABLE_SCHEMA = '${schema}'
        ORDER BY c.ORDINAL_POSITION
      `;
    } else {
      query = `
        SELECT 
          c.COLUMN_NAME as column_name,
          c.DATA_TYPE as data_type,
          c.IS_NULLABLE as is_nullable,
          c.COLUMN_DEFAULT as column_default,
          c.CHARACTER_MAXIMUM_LENGTH as max_length,
          c.NUMERIC_PRECISION as precision,
          c.NUMERIC_SCALE as scale,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'YES' ELSE 'NO' END as is_primary_key
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
          ON c.TABLE_NAME = tc.TABLE_NAME 
          AND c.TABLE_SCHEMA = tc.TABLE_SCHEMA 
          AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE pk 
          ON c.COLUMN_NAME = pk.COLUMN_NAME 
          AND c.TABLE_NAME = pk.TABLE_NAME 
          AND c.TABLE_SCHEMA = pk.TABLE_SCHEMA 
          AND tc.CONSTRAINT_NAME = pk.CONSTRAINT_NAME
        WHERE c.TABLE_NAME = '${tableName}' 
          AND c.TABLE_SCHEMA = '${schema}'
        ORDER BY c.ORDINAL_POSITION
      `;
    }

    const result = await this.executeQuery(query, 'describe_table');
    return this.formatResults(result);
  }

  /**
   * List foreign key relationships in a schema
   */
  async listForeignKeys(database = null, schema = 'dbo') {
    let query;

    if (database) {
      query = `
        SELECT 
          fk.name as foreign_key_name,
          tp.name as parent_table,
          cp.name as parent_column,
          tr.name as referenced_table,
          cr.name as referenced_column
        FROM [${database}].sys.foreign_keys fk
        INNER JOIN [${database}].sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN [${database}].sys.tables tp ON fkc.parent_object_id = tp.object_id
        INNER JOIN [${database}].sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
        INNER JOIN [${database}].sys.tables tr ON fkc.referenced_object_id = tr.object_id
        INNER JOIN [${database}].sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
        INNER JOIN [${database}].sys.schemas s ON tp.schema_id = s.schema_id
        WHERE s.name = '${schema}'
        ORDER BY tp.name, fk.name
      `;
    } else {
      query = `
        SELECT 
          fk.name as foreign_key_name,
          tp.name as parent_table,
          cp.name as parent_column,
          tr.name as referenced_table,
          cr.name as referenced_column
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
        INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
        INNER JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
        INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
        INNER JOIN sys.schemas s ON tp.schema_id = s.schema_id
        WHERE s.name = '${schema}'
        ORDER BY tp.name, fk.name
      `;
    }

    const result = await this.executeQuery(query, 'list_foreign_keys');
    return this.formatResults(result);
  }

  /**
   * Get table data with pagination support
   */
  async getTableData(tableName, database = null, schema = 'dbo', limit = 100, offset = 0) {
    let query;

    if (database) {
      query = `
        SELECT * 
        FROM [${database}].[${schema}].[${tableName}]
        ORDER BY (SELECT NULL)
        OFFSET ${offset} ROWS 
        FETCH NEXT ${limit} ROWS ONLY
      `;
    } else {
      query = `
        SELECT * 
        FROM [${schema}].[${tableName}]
        ORDER BY (SELECT NULL)
        OFFSET ${offset} ROWS 
        FETCH NEXT ${limit} ROWS ONLY
      `;
    }

    const result = await this.executeQuery(query, 'get_table_data');
    return this.formatResults(result);
  }

  /**
   * Export table data as CSV format with streaming for large tables
   */
  async exportTableCsv(tableName, database = null, schema = 'dbo', limit = null) {
    try {
      const pool = await this.getConnection();
      const request = pool.request();

      // Switch database if specified
      if (database) {
        await request.query(`USE [${database}]`);
      }

      // Use streaming handler for CSV export
      const streamingResult = await this.streamingHandler.streamTableExport(request, tableName, {
        schema,
        database,
        limit,
        outputFormat: 'csv'
      });

      // Track performance
      if (this.performanceMonitor) {
        const stats = this.streamingHandler.getStreamingStats(streamingResult);
        this.performanceMonitor.recordQuery({
          tool: 'export_table_csv',
          query: `SELECT${limit ? ` TOP ${limit}` : ''} * FROM [${schema}].[${tableName}]`,
          executionTime: streamingResult.performance?.duration || 0,
          success: true,
          database,
          streaming: stats.streaming,
          totalRows: stats.totalRows,
          memoryEfficient: stats.memoryEfficient,
          timestamp: new Date()
        });
      }

      // Handle empty results
      if (streamingResult.totalRows === 0) {
        return [
          {
            type: 'text',
            text: 'No data found in table'
          }
        ];
      }

      // For streaming results, reconstruct CSV from chunks
      if (streamingResult.streaming && streamingResult.chunks) {
        const csvContent = this.streamingHandler.reconstructFromChunks(
          streamingResult.chunks,
          'csv'
        );

        return [
          {
            type: 'text',
            text: csvContent
          }
        ];
      }

      // For non-streaming results, convert recordset to CSV
      if (streamingResult.recordset && streamingResult.recordset.length > 0) {
        const headers = Object.keys(streamingResult.recordset[0]);
        const csvHeaders = headers.join(',');
        const csvRows = streamingResult.recordset.map(row =>
          headers
            .map(header => {
              const value = row[header];
              if (value === null || value === undefined) return '';
              const stringValue = String(value);
              // Escape quotes and wrap in quotes if contains comma or quotes
              if (
                stringValue.includes(',') ||
                stringValue.includes('"') ||
                stringValue.includes('\n')
              ) {
                return `"${stringValue.replace(/"/g, '""')}"`;
              }
              return stringValue;
            })
            .join(',')
        );

        const csvContent = [csvHeaders, ...csvRows].join('\n');

        return [
          {
            type: 'text',
            text: csvContent
          }
        ];
      }

      return [
        {
          type: 'text',
          text: 'No data found in table'
        }
      ];
    } catch (error) {
      // Track failed query
      if (this.performanceMonitor) {
        this.performanceMonitor.recordQuery({
          tool: 'export_table_csv',
          query: `SELECT${limit ? ` TOP ${limit}` : ''} * FROM [${schema}].[${tableName}]`,
          executionTime: 0,
          success: false,
          error: error.message,
          database,
          timestamp: new Date()
        });
      }

      throw error;
    }
  }

  /**
   * Explain query execution plan
   */
  async explainQuery(query, database = null) {
    try {
      const pool = await this.getConnection();
      const request = pool.request();

      // Switch database if specified
      if (database) {
        await request.query(`USE [${database}]`);
      }

      // Execute the SET SHOWPLAN_ALL ON in a separate batch
      await request.query('SET SHOWPLAN_ALL ON');

      // Execute the query to get the execution plan
      const result = await request.query(query);

      // Turn off SHOWPLAN_ALL
      await request.query('SET SHOWPLAN_ALL OFF');

      // Track performance
      if (this.performanceMonitor) {
        this.performanceMonitor.recordQuery({
          tool: 'explain_query',
          query,
          executionTime: 0, // SHOWPLAN doesn't actually execute
          success: true,
          database,
          timestamp: new Date()
        });
      }

      return this.formatResults(result);
    } catch {
      // If SHOWPLAN_ALL doesn't work, try with estimated execution plan
      try {
        const pool = await this.getConnection();
        const request = pool.request();

        // Switch database if specified
        if (database) {
          await request.query(`USE [${database}]`);
        }

        // Try SET SHOWPLAN_TEXT instead
        await request.query('SET SHOWPLAN_TEXT ON');
        const result = await request.query(query);
        await request.query('SET SHOWPLAN_TEXT OFF');

        // Track performance
        if (this.performanceMonitor) {
          this.performanceMonitor.recordQuery({
            tool: 'explain_query',
            query,
            executionTime: 0, // SHOWPLAN doesn't actually execute
            success: true,
            database,
            timestamp: new Date()
          });
        }

        return this.formatResults(result);
      } catch (innerError) {
        // Track failed query
        if (this.performanceMonitor) {
          this.performanceMonitor.recordQuery({
            tool: 'explain_query',
            query,
            executionTime: 0,
            success: false,
            error: innerError.message,
            database,
            timestamp: new Date()
          });
        }

        return [
          {
            type: 'text',
            text: `Unable to generate execution plan: ${innerError.message}`
          }
        ];
      }
    }
  }
}
