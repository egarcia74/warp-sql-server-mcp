#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import sql from 'mssql';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class SqlServerMCP {
  constructor() {
    this.server = new Server(
      {
        name: 'warp-sql-server-mcp',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.pool = null;

    // Configurable timeouts and retry strategy
    this.connectionTimeout = parseInt(process.env.SQL_SERVER_CONNECT_TIMEOUT_MS || '10000'); // 10s
    this.requestTimeout = parseInt(process.env.SQL_SERVER_REQUEST_TIMEOUT_MS || '30000'); // 30s
    this.maxRetries = parseInt(process.env.SQL_SERVER_MAX_RETRIES || '3');
    this.retryDelay = parseInt(process.env.SQL_SERVER_RETRY_DELAY_MS || '1000'); // 1s

    this.setupToolHandlers();
  }

  async connectToDatabase() {
    if (this.pool && this.pool.connected) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Using existing database connection pool');
      }
      return this.pool;
    }

    if (process.env.NODE_ENV !== 'test') {
      console.error('Establishing new database connection...');
    }

    const baseConfig = {
      server: process.env.SQL_SERVER_HOST || 'localhost',
      port: parseInt(process.env.SQL_SERVER_PORT) || 1433,
      database: process.env.SQL_SERVER_DATABASE || 'master',
      user: process.env.SQL_SERVER_USER,
      password: process.env.SQL_SERVER_PASSWORD,
      options: {
        encrypt: process.env.SQL_SERVER_ENCRYPT === 'true' || false,
        trustServerCertificate: process.env.SQL_SERVER_TRUST_CERT === 'true' || true,
        enableArithAbort: true,
        requestTimeout: this.requestTimeout
      },
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.requestTimeout,
      pool: {
        max: parseInt(process.env.SQL_SERVER_POOL_MAX || '10'),
        min: parseInt(process.env.SQL_SERVER_POOL_MIN || '0'),
        idleTimeoutMillis: parseInt(process.env.SQL_SERVER_POOL_IDLE_TIMEOUT_MS || '30000')
      }
    };

    // Handle Windows Authentication if no user/password provided
    if (!baseConfig.user && !baseConfig.password) {
      baseConfig.authentication = {
        type: 'ntlm',
        options: {
          domain: process.env.SQL_SERVER_DOMAIN || ''
        }
      };
      // Remove user/password for Windows auth
      delete baseConfig.user;
      delete baseConfig.password;
    } else {
      // Ensure we don't mix SQL Server auth with NTLM
      delete baseConfig.authentication;
    }

    // Retry logic with exponential backoff
    let attempt = 0;
    let lastError = null;
    while (attempt < this.maxRetries) {
      try {
        attempt += 1;
        const config = { ...baseConfig };
        this.pool = await sql.connect(config);
        if (process.env.NODE_ENV !== 'test') {
          console.error(`Connected to SQL Server successfully (attempt ${attempt})`);
        }
        return this.pool;
      } catch (error) {
        lastError = error;
        if (process.env.NODE_ENV !== 'test') {
          console.error(`Connection attempt ${attempt} failed: ${error.message}`);
        }
        if (attempt >= this.maxRetries) break;
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(res => setTimeout(res, delay));
      }
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to connect to SQL Server after ${this.maxRetries} attempts: ${lastError ? lastError.message : 'Unknown error'}`
    );
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'execute_query',
          description: 'Execute a SQL query on the connected SQL Server database',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The SQL query to execute'
              },
              database: {
                type: 'string',
                description: 'Optional: Database name to use for this query'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'list_databases',
          description: 'List all databases on the SQL Server instance',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'list_tables',
          description: 'List all tables in a specific database',
          inputSchema: {
            type: 'object',
            properties: {
              database: {
                type: 'string',
                description: 'Database name (optional, uses current database if not specified)'
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)'
              }
            }
          }
        },
        {
          name: 'describe_table',
          description: 'Get the schema information for a specific table',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: {
                type: 'string',
                description: 'Name of the table to describe'
              },
              database: {
                type: 'string',
                description: 'Database name (optional)'
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)'
              }
            },
            required: ['table_name']
          }
        },
        {
          name: 'get_table_data',
          description: 'Get sample data from a table with optional filtering and limiting',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: {
                type: 'string',
                description: 'Name of the table'
              },
              database: {
                type: 'string',
                description: 'Database name (optional)'
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of rows to return (optional, defaults to 100)'
              },
              where: {
                type: 'string',
                description: 'WHERE clause conditions (optional)'
              }
            },
            required: ['table_name']
          }
        },
        {
          name: 'explain_query',
          description: 'Get the execution plan for a SQL query to analyze performance',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The SQL query to analyze'
              },
              database: {
                type: 'string',
                description: 'Optional: Database name to use for this query'
              },
              include_actual_plan: {
                type: 'boolean',
                description: 'Include actual execution statistics (optional, defaults to false)'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'list_foreign_keys',
          description: 'List all foreign key relationships in a schema',
          inputSchema: {
            type: 'object',
            properties: {
              database: {
                type: 'string',
                description: 'Database name (optional)'
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)'
              }
            }
          }
        },
        {
          name: 'export_table_csv',
          description: 'Export table data in CSV format',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: {
                type: 'string',
                description: 'Name of the table to export'
              },
              database: {
                type: 'string',
                description: 'Database name (optional)'
              },
              schema: {
                type: 'string',
                description: 'Schema name (optional, defaults to dbo)'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of rows to export (optional)'
              },
              where: {
                type: 'string',
                description: 'WHERE clause conditions (optional)'
              }
            },
            required: ['table_name']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;

      try {
        await this.connectToDatabase();

        switch (name) {
          case 'execute_query':
            return await this.executeQuery(args.query, args.database);

          case 'list_databases':
            return await this.listDatabases();

          case 'list_tables':
            return await this.listTables(args.database, args.schema);

          case 'describe_table':
            return await this.describeTable(args.table_name, args.database, args.schema);

          case 'get_table_data':
            return await this.getTableData(
              args.table_name,
              args.database,
              args.schema,
              args.limit,
              args.where
            );

          case 'explain_query':
            return await this.explainQuery(args.query, args.database, args.include_actual_plan);

          case 'list_foreign_keys':
            return await this.listForeignKeys(args.database, args.schema);

          case 'export_table_csv':
            return await this.exportTableCsv(
              args.table_name,
              args.database,
              args.schema,
              args.limit,
              args.where
            );

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error.message}`
        );
      }
    });
  }

  async executeQuery(query, database = null) {
    try {
      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                rowsAffected: result.rowsAffected,
                recordset: result.recordset,
                recordsets: result.recordsets
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Query execution failed: ${error.message}`);
    }
  }

  async listDatabases() {
    try {
      const req = this.pool.request();
      req.timeout = this.requestTimeout;
      const result = await req.query(`
        SELECT 
          name as database_name,
          database_id,
          create_date,
          collation_name,
          state_desc as status
        FROM sys.databases 
        WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
        ORDER BY name
      `);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to list databases: ${error.message}`);
    }
  }

  async listTables(database = null, schema = 'dbo') {
    try {
      const query = `
        SELECT 
          t.TABLE_CATALOG as database_name,
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema}'
        ORDER BY t.TABLE_NAME
      `;

      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to list tables: ${error.message}`);
    }
  }

  async describeTable(tableName, database = null, schema = 'dbo') {
    try {
      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(`
        SELECT 
          c.COLUMN_NAME as column_name,
          c.DATA_TYPE as data_type,
          c.CHARACTER_MAXIMUM_LENGTH as max_length,
          c.NUMERIC_PRECISION as precision,
          c.NUMERIC_SCALE as scale,
          c.IS_NULLABLE as is_nullable,
          c.COLUMN_DEFAULT as default_value,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'YES' ELSE 'NO' END as is_primary_key
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku 
            ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.TABLE_NAME = '${tableName}'
            AND tc.TABLE_SCHEMA = '${schema}'
            AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
        WHERE c.TABLE_NAME = '${tableName}' 
          AND c.TABLE_SCHEMA = '${schema}'
        ORDER BY c.ORDINAL_POSITION
      `);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2)
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to describe table: ${error.message}`);
    }
  }

  async getTableData(tableName, database = null, schema = 'dbo', limit = 100, whereClause = null) {
    try {
      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      let query = `SELECT TOP ${limit} * FROM [${schema}].[${tableName}]`;

      if (whereClause) {
        query += ` WHERE ${whereClause}`;
      }

      const result = await request.query(query);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                table: `${schema}.${tableName}`,
                rowCount: result.recordset.length,
                data: result.recordset
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get table data: ${error.message}`);
    }
  }

  async explainQuery(query, database = null, includeActualPlan = false) {
    try {
      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      // Enable showplan and optionally include actual execution statistics
      const setupQueries = [];

      if (includeActualPlan) {
        setupQueries.push('SET STATISTICS IO ON');
        setupQueries.push('SET STATISTICS TIME ON');
        setupQueries.push('SET SHOWPLAN_ALL ON');
      } else {
        setupQueries.push('SET SHOWPLAN_ALL ON');
      }

      // Execute setup queries
      for (const setupQuery of setupQueries) {
        await request.query(setupQuery);
      }

      // Get execution plan
      const planResult = await request.query(query);

      // Turn off showplan (do not fail overall if cleanup steps fail)
      try {
        await request.query('SET SHOWPLAN_ALL OFF');
      } catch {
        /* ignore cleanup errors */
      }
      if (includeActualPlan) {
        try {
          await request.query('SET STATISTICS IO OFF');
        } catch {
          /* ignore cleanup errors */
        }
        try {
          await request.query('SET STATISTICS TIME OFF');
        } catch {
          /* ignore cleanup errors */
        }
      }

      // Also get query cost information
      const costQuery = `
        SELECT TOP 1
          qs.query_id,
          qs.sql_handle,
          qs.total_worker_time / qs.execution_count as avg_cpu_time,
          qs.total_logical_reads / qs.execution_count as avg_logical_reads,
          qs.total_elapsed_time / qs.execution_count as avg_duration,
          qs.execution_count
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
        WHERE st.text LIKE '%' + REPLACE('${query.replace(/'/g, "''").substring(0, 50)}', '''', '''''') + '%'
        ORDER BY qs.total_worker_time DESC
      `;

      let costInfo = null;
      try {
        const costResult = await request.query(costQuery);
        costInfo = costResult.recordset[0] || null;
      } catch (costError) {
        // Cost info is optional, continue if it fails
        console.error('Could not retrieve cost information:', costError.message);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query: query,
                execution_plan: planResult.recordset,
                cost_information: costInfo,
                plan_type: includeActualPlan ? 'actual' : 'estimated',
                recordsets_count: planResult.recordsets.length
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to explain query: ${error.message}`);
    }
  }

  async listForeignKeys(database = null, schema = 'dbo') {
    try {
      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(`
        SELECT 
          fk.name as constraint_name,
          tp.name as parent_table,
          cp.name as parent_column,
          tr.name as referenced_table,
          cr.name as referenced_column,
          fk.delete_referential_action_desc as on_delete,
          fk.update_referential_action_desc as on_update,
          fk.is_disabled
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
        INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
        INNER JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
        INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
        INNER JOIN sys.schemas s ON tp.schema_id = s.schema_id
        WHERE s.name = '${schema}'
        ORDER BY tp.name, fk.name
      `);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                schema: schema,
                foreign_keys: result.recordset,
                count: result.recordset.length
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to list foreign keys: ${error.message}`);
    }
  }

  async exportTableCsv(
    tableName,
    database = null,
    schema = 'dbo',
    limit = null,
    whereClause = null
  ) {
    try {
      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      // Build the query
      let query = `SELECT${limit ? ` TOP ${limit}` : ''} * FROM [${schema}].[${tableName}]`;

      if (whereClause) {
        query += ` WHERE ${whereClause}`;
      }

      const result = await request.query(query);

      // Convert to CSV format
      if (result.recordset.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  table: `${schema}.${tableName}`,
                  csv_data: '',
                  row_count: 0,
                  format: 'csv'
                },
                null,
                2
              )
            }
          ]
        };
      }

      // Get column headers
      const headers = Object.keys(result.recordset[0]);
      let csvContent = headers.join(',') + '\n';

      // Add data rows
      for (const row of result.recordset) {
        const values = headers.map(header => {
          const value = row[header];
          if (value === null || value === undefined) {
            return '';
          }
          // Escape commas and quotes in CSV
          const stringValue = String(value);
          if (
            stringValue.includes(',') ||
            stringValue.includes('"') ||
            stringValue.includes('\n')
          ) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        });
        csvContent += values.join(',') + '\n';
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                table: `${schema}.${tableName}`,
                csv_data: csvContent,
                row_count: result.recordset.length,
                column_count: headers.length,
                format: 'csv'
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to export table as CSV: ${error.message}`
      );
    }
  }

  async run() {
    console.error('Starting Warp SQL Server MCP server...');

    // Initialize database connection pool at startup
    try {
      await this.connectToDatabase();
      console.error('Database connection pool initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database connection pool:', error.message);
      console.error('Server will continue but database operations may fail');
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Warp SQL Server MCP server running on stdio');
  }
}

// Export the class for testing
export { SqlServerMCP };

// Only run the server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new SqlServerMCP();
  server.run().catch(console.error);
}
