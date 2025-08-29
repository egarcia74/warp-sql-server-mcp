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
        version: '1.3.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Debug mode for enhanced logging
    this.debugMode = process.env.SQL_SERVER_DEBUG === 'true';

    this.pool = null;
    this.isConnected = false;

    // Configurable timeouts and retry strategy
    this.connectionTimeout = parseInt(process.env.SQL_SERVER_CONNECT_TIMEOUT_MS || '10000'); // 10s
    this.requestTimeout = parseInt(process.env.SQL_SERVER_REQUEST_TIMEOUT_MS || '30000'); // 30s
    this.maxRetries = parseInt(process.env.SQL_SERVER_MAX_RETRIES || '3');
    this.retryDelay = parseInt(process.env.SQL_SERVER_RETRY_DELAY_MS || '1000'); // 1s

    // Safety configuration with secure defaults
    this.readOnlyMode = process.env.SQL_SERVER_READ_ONLY !== 'false'; // Default: true
    this.allowDestructiveOperations =
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS === 'true'; // Default: false
    this.allowSchemaChanges = process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES === 'true'; // Default: false

    // Define dangerous SQL patterns
    this.destructivePatterns = [
      /^\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i,
      /^\s*EXEC(UTE)?\s+/i,
      /^\s*CALL\s+/i,
      /;\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i // Multi-statement
    ];

    this.schemaChangePatterns = [
      /^\s*(CREATE|DROP|ALTER)\s+/i,
      /^\s*(GRANT|REVOKE)\s+/i,
      /;\s*(CREATE|DROP|ALTER|GRANT|REVOKE)\s+/i // Multi-statement
    ];

    this.setupToolHandlers();
  }

  /**
   * Validates a SQL query against safety policies
   * @param {string} query - SQL query to validate
   * @returns {object} - Validation result with allowed flag and reason
   */
  validateQuery(query) {
    const trimmedQuery = query.trim();

    // Always allow empty queries (though they're pointless)
    if (!trimmedQuery) {
      return { allowed: true, reason: 'Empty query' };
    }

    // Check read-only mode first (most restrictive)
    if (this.readOnlyMode) {
      // In read-only mode, only allow SELECT, SHOW, DESCRIBE, EXPLAIN, etc.
      const readOnlyPatterns = [
        /^\s*SELECT\s+/i,
        /^\s*SHOW\s+/i,
        /^\s*DESCRIBE\s+/i,
        /^\s*DESC\s+/i,
        /^\s*EXPLAIN\s+/i,
        /^\s*WITH\s+[\s\S]*?\bSELECT\s+/i // CTE queries - improved to handle multi-line
      ];

      const isReadOnlyQuery = readOnlyPatterns.some(pattern => pattern.test(trimmedQuery));

      if (!isReadOnlyQuery) {
        return {
          allowed: false,
          reason:
            'Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.',
          queryType: 'non-select'
        };
      }
    }

    // Check for destructive operations (if not in read-only mode)
    if (!this.readOnlyMode) {
      const hasDestructiveOps = this.destructivePatterns.some(pattern =>
        pattern.test(trimmedQuery)
      );

      if (hasDestructiveOps && !this.allowDestructiveOperations) {
        return {
          allowed: false,
          reason:
            'Destructive operations (INSERT/UPDATE/DELETE) are disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.',
          queryType: 'destructive'
        };
      }
    }

    // Check for schema changes (if not in read-only mode)
    if (!this.readOnlyMode) {
      const hasSchemaChanges = this.schemaChangePatterns.some(pattern =>
        pattern.test(trimmedQuery)
      );

      if (hasSchemaChanges && !this.allowSchemaChanges) {
        return {
          allowed: false,
          reason:
            'Schema changes (CREATE/DROP/ALTER) are disabled. Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=true to enable.',
          queryType: 'schema'
        };
      }
    }

    return { allowed: true, reason: 'Query validation passed' };
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
        this.isConnected = true;
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
      // Safety validation
      const validation = this.validateQuery(query);
      if (!validation.allowed) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Query blocked by safety policy: ${validation.reason}`
        );
      }

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
                recordsets: result.recordsets,
                // Include safety info in response
                safetyInfo: {
                  readOnlyMode: this.readOnlyMode,
                  destructiveOperationsAllowed: this.allowDestructiveOperations,
                  schemaChangesAllowed: this.allowSchemaChanges
                }
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error; // Re-throw MCP errors (including safety violations)
      }
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

  /**
   * Prints connection status and comprehensive configuration summary
   */
  printConfigurationSummary() {
    if (process.env.NODE_ENV === 'test') {
      return; // Skip printing during tests
    }

    // Build configuration details
    const host = process.env.SQL_SERVER_HOST || 'localhost';
    const port = process.env.SQL_SERVER_PORT || '1433';
    const database = process.env.SQL_SERVER_DATABASE || 'master';
    const auth = process.env.SQL_SERVER_USER ? 'SQL Auth' : 'Windows Auth';

    const isInSafeMode =
      this.readOnlyMode && !this.allowDestructiveOperations && !this.allowSchemaChanges;
    const securityLevel = isInSafeMode ? '🔒 SECURE' : '⚠️  UNSAFE';
    const readOnlyStatus = this.readOnlyMode ? 'RO' : 'RW';
    const destructiveStatus = this.allowDestructiveOperations ? 'DML+' : 'DML-';
    const schemaStatus = this.allowSchemaChanges ? 'DDL+' : 'DDL-';

    // Only show connection info if we're actually connected
    if (this.isConnected) {
      console.error(`✅ Connected to ${host}:${port}/${database} (${auth})`);
    } else {
      console.error(`❌ Connection failed to ${host}:${port}/${database} (${auth})`);
      console.error('⚠️  Database operations will be attempted but may fail');
    }

    console.error(
      `Security: ${securityLevel} (${readOnlyStatus}, ${destructiveStatus}, ${schemaStatus})`
    );
    // Show comprehensive configuration summary
    console.error('📈 Current Configuration:');
    console.error('='.repeat(60));
    // Connection Settings
    console.error('🌐 Connection Settings:');
    console.error(`  SQL_SERVER_HOST=${host} (Server hostname/IP)`);
    console.error(`  SQL_SERVER_PORT=${port} (Database port)`);
    console.error(`  SQL_SERVER_DATABASE=${database} (Default database)`);
    console.error(
      `  SQL_SERVER_USER=${process.env.SQL_SERVER_USER || '(Windows Auth)'} (Authentication user)`
    );

    // Mask password for security - only show if it's set or not
    const passwordStatus = process.env.SQL_SERVER_PASSWORD ? '***MASKED***' : '(not set)';
    console.error(`  SQL_SERVER_PASSWORD=${passwordStatus} (Authentication password)`);

    // SSL/TLS Settings (safe to log - boolean configuration values)
    const encryptSetting = process.env.SQL_SERVER_ENCRYPT || 'false';
    const trustCertSetting = process.env.SQL_SERVER_TRUST_CERT || 'true';
    // lgtm[js/clear-text-logging] - These are non-sensitive boolean config values ('true'/'false')
    console.error(`  SQL_SERVER_ENCRYPT=${encryptSetting} (SSL encryption enabled)`);
    // lgtm[js/clear-text-logging] - These are non-sensitive boolean config values ('true'/'false')
    console.error(`  SQL_SERVER_TRUST_CERT=${trustCertSetting} (Trust server certificate)`);
    // Timeout & Retry Settings
    console.error('⏱️ Timeout & Retry Settings:');
    console.error(
      `  SQL_SERVER_CONNECT_TIMEOUT_MS=${this.connectionTimeout} (Connection timeout in milliseconds)`
    );
    console.error(
      `  SQL_SERVER_REQUEST_TIMEOUT_MS=${this.requestTimeout} (Query timeout in milliseconds)`
    );
    console.error(
      `  SQL_SERVER_MAX_RETRIES=${this.maxRetries} (Maximum connection retry attempts)`
    );
    console.error(
      `  SQL_SERVER_RETRY_DELAY_MS=${this.retryDelay} (Delay between retries in milliseconds)`
    );
    // Debug Settings
    if (this.debugMode) {
      console.error('🐛 Debug Settings:');
      console.error(`  SQL_SERVER_DEBUG=${this.debugMode} (Enhanced logging enabled)`);
    }
    // Connection Pool Settings
    console.error('🏊 Pool Settings:');
    const poolMax = process.env.SQL_SERVER_POOL_MAX || '10';
    const poolMin = process.env.SQL_SERVER_POOL_MIN || '0';
    const poolIdle = process.env.SQL_SERVER_POOL_IDLE_TIMEOUT_MS || '30000';
    console.error(`  SQL_SERVER_POOL_MAX=${poolMax} (Maximum concurrent connections)`);
    console.error(`  SQL_SERVER_POOL_MIN=${poolMin} (Minimum pool connections maintained)`);
    console.error(`  SQL_SERVER_POOL_IDLE_TIMEOUT_MS=${poolIdle} (Idle connection timeout)`);
    // Security Settings
    console.error('🔒 Security Settings:');
    console.error(
      `  SQL_SERVER_READ_ONLY=${this.readOnlyMode ? 'true' : 'false'} (${this.readOnlyMode ? '✅' : '❌'} ${this.readOnlyMode ? 'Read-only mode: SELECT only' : 'Read-write mode: All queries allowed'})`
    );
    console.error(
      `  SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=${this.allowDestructiveOperations} (${this.allowDestructiveOperations ? '❌' : '✅'} DML operations: INSERT/UPDATE/DELETE ${this.allowDestructiveOperations ? 'allowed' : 'blocked'})`
    );
    console.error(
      `  SQL_SERVER_ALLOW_SCHEMA_CHANGES=${this.allowSchemaChanges} (${this.allowSchemaChanges ? '❌' : '✅'} DDL operations: CREATE/DROP/ALTER ${this.allowSchemaChanges ? 'allowed' : 'blocked'})`
    );
    // Show overall security level more prominently
    if (isInSafeMode) {
      console.error('  Overall Security Level: ✅ SECURE - Only SELECT queries permitted');
    } else {
      const riskyFeatures = [];
      if (!this.readOnlyMode) riskyFeatures.push('Read-write');
      if (this.allowDestructiveOperations) riskyFeatures.push('DML');
      if (this.allowSchemaChanges) riskyFeatures.push('DDL');
      console.error(`  Overall Security Level: ❌ UNSAFE - ${riskyFeatures.join(' + ')} enabled`);
    }
    console.error('='.repeat(60));
    // Add warnings and recommendations
    if (!isInSafeMode) {
      const warnings = [];
      if (!this.readOnlyMode) warnings.push('Read-write mode');
      if (this.allowDestructiveOperations) warnings.push('DML allowed');
      if (this.allowSchemaChanges) warnings.push('DDL allowed');
      console.error(
        `⚠️  WARNING: ${warnings.join(', ')} - consider stricter settings for production`
      );
      console.error('💡 For production use, consider:');
      if (!this.readOnlyMode) {
        console.error('   Set SQL_SERVER_READ_ONLY=true for read-only access');
      }
      if (this.allowDestructiveOperations) {
        console.error('   Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false to block DML');
      }
      if (this.allowSchemaChanges) {
        console.error('   Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=false to block DDL');
      }
    } else {
      console.error('✅ Running in secure mode - only SELECT queries allowed');
    }
    // Add connection troubleshooting help if not connected
    if (!this.isConnected) {
      console.error('🔧 Connection troubleshooting:');
      console.error('   1. Verify SQL Server is running and accessible');
      console.error('   2. Check firewall settings (port 1433)');
      console.error('   3. Verify credentials and permissions');
      console.error('   4. For local dev, try: SQL_SERVER_ENCRYPT=false');
      console.error('   5. Check connection timeout settings if retries are failing');
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('Starting Warp SQL Server MCP server...');

    // Show connection configuration before attempting connection
    if (process.env.NODE_ENV !== 'test') {
      const host = process.env.SQL_SERVER_HOST || 'localhost';
      const port = process.env.SQL_SERVER_PORT || '1433';
      const database = process.env.SQL_SERVER_DATABASE || 'master';
      console.error(
        `Attempting connection to ${host}:${port}/${database} (max ${this.maxRetries} attempts)...`
      );
    }

    // Initialize database connection pool at startup
    try {
      await this.connectToDatabase();
      if (process.env.NODE_ENV !== 'test') {
        console.error('Database connection pool initialized successfully');
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Failed to initialize database connection pool:', error.message);
        console.error('Server will continue but database operations will likely fail');
      }
    }

    // Print configuration summary after connection attempt
    this.printConfigurationSummary();

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
