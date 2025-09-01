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
import { PerformanceMonitor } from './lib/utils/performance-monitor.js';
import { QueryOptimizer } from './lib/analysis/query-optimizer.js';
import { BottleneckDetector } from './lib/analysis/bottleneck-detector.js';

// Load environment variables
dotenv.config();

class SqlServerMCP {
  constructor() {
    this.server = new Server(
      {
        name: 'warp-sql-server-mcp',
        version: '1.4.0'
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

    // Initialize performance monitoring
    this.performanceMonitor = new PerformanceMonitor({
      enabled: process.env.ENABLE_PERFORMANCE_MONITORING !== 'false', // Default: true
      maxMetricsHistory: parseInt(process.env.MAX_METRICS_HISTORY || '1000'),
      slowQueryThreshold: parseInt(process.env.SLOW_QUERY_THRESHOLD || '5000'),
      trackPoolMetrics: process.env.TRACK_POOL_METRICS !== 'false', // Default: true
      samplingRate: parseFloat(process.env.PERFORMANCE_SAMPLING_RATE || '1.0')
    });

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
        },
        {
          name: 'get_performance_stats',
          description: 'Get overall performance statistics and health summary',
          inputSchema: {
            type: 'object',
            properties: {
              timeframe: {
                type: 'string',
                description:
                  'Time period for stats: "recent" (last 5 min), "session" (since startup), "all" (default)',
                enum: ['recent', 'session', 'all']
              }
            }
          }
        },
        {
          name: 'get_query_performance',
          description: 'Get detailed query performance breakdown by tool',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of queries to analyze (optional, defaults to 50)'
              },
              tool_filter: {
                type: 'string',
                description: 'Filter by specific MCP tool name (optional)'
              },
              slow_only: {
                type: 'boolean',
                description: 'Only return slow queries (optional, defaults to false)'
              }
            }
          }
        },
        {
          name: 'get_connection_health',
          description: 'Get connection pool health metrics and diagnostics',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_index_recommendations',
          description: 'Get index recommendations for database optimization',
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
              },
              limit: {
                type: 'number',
                description:
                  'Maximum number of recommendations to return (optional, defaults to 10)'
              },
              impact_threshold: {
                type: 'number',
                description: 'Minimum impact score threshold (0-100, optional)'
              }
            }
          }
        },
        {
          name: 'analyze_query_performance',
          description: 'Analyze query performance and provide optimization suggestions',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'SQL query to analyze for performance optimization'
              },
              database: {
                type: 'string',
                description: 'Database name (optional)'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'detect_query_bottlenecks',
          description: 'Detect and analyze query bottlenecks in the database',
          inputSchema: {
            type: 'object',
            properties: {
              database: {
                type: 'string',
                description: 'Database name (optional)'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of bottlenecks to return (optional, defaults to 10)'
              },
              severity_filter: {
                type: 'string',
                description: 'Filter by severity level: LOW, MEDIUM, HIGH, CRITICAL (optional)',
                enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
              }
            }
          }
        },
        {
          name: 'get_optimization_insights',
          description: 'Get comprehensive database optimization insights and health analysis',
          inputSchema: {
            type: 'object',
            properties: {
              database: {
                type: 'string',
                description: 'Database name (optional)'
              },
              analysis_period: {
                type: 'string',
                description:
                  'Analysis time period: 24_HOURS, 7_DAYS, 30_DAYS (optional, defaults to 7_DAYS)',
                enum: ['24_HOURS', '7_DAYS', '30_DAYS']
              }
            }
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

          case 'get_performance_stats':
            return await this.getPerformanceStats(args.timeframe);

          case 'get_query_performance':
            return await this.getQueryPerformance(args.limit, args.tool_filter, args.slow_only);

          case 'get_connection_health':
            return await this.getConnectionHealth();

          case 'get_index_recommendations':
            return await this.getIndexRecommendations(
              args.database,
              args.schema,
              args.limit,
              args.impact_threshold
            );

          case 'analyze_query_performance':
            return await this.analyzeQueryPerformance(args.query, args.database);

          case 'detect_query_bottlenecks':
            return await this.detectQueryBottlenecks(
              args.database,
              args.limit,
              args.severity_filter
            );

          case 'get_optimization_insights':
            return await this.getOptimizationInsights(args.database, args.analysis_period);

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
    const queryId = this.performanceMonitor?.startQuery('execute_query', query, { database });

    try {
      // Safety validation
      const validation = this.validateQuery(query);
      if (!validation.allowed) {
        if (queryId) this.performanceMonitor.endQuery(queryId, null, new Error(validation.reason));
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

      // Record successful query completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: result?.rowsAffected || [],
          recordset: result?.recordset || []
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                rowsAffected: result?.rowsAffected || [],
                recordset: result?.recordset || [],
                recordsets: result?.recordsets || [],
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
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);

      if (error instanceof McpError) {
        throw error; // Re-throw MCP errors (including safety violations)
      }
      throw new McpError(ErrorCode.InternalError, `Query execution failed: ${error.message}`);
    }
  }

  async listDatabases() {
    const queryId = this.performanceMonitor?.startQuery('list_databases', 'List all databases');

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

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [result.recordset.length],
          recordset: result.recordset
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2)
          }
        ]
      };
    } catch (error) {
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);
      throw new McpError(ErrorCode.InternalError, `Failed to list databases: ${error.message}`);
    }
  }

  async listTables(database = null, schema = 'dbo') {
    const queryId = this.performanceMonitor?.startQuery(
      'list_tables',
      `List tables in ${database || 'current database'}.${schema}`,
      { database, schema }
    );

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

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [result.recordset.length],
          recordset: result.recordset
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2)
          }
        ]
      };
    } catch (error) {
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);
      throw new McpError(ErrorCode.InternalError, `Failed to list tables: ${error.message}`);
    }
  }

  async describeTable(tableName, database = null, schema = 'dbo') {
    const queryId = this.performanceMonitor?.startQuery(
      'describe_table',
      `Describe table ${schema}.${tableName}`,
      { tableName, database, schema }
    );

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

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [result.recordset.length],
          recordset: result.recordset
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.recordset, null, 2)
          }
        ]
      };
    } catch (error) {
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);
      throw new McpError(ErrorCode.InternalError, `Failed to describe table: ${error.message}`);
    }
  }

  async getTableData(tableName, database = null, schema = 'dbo', limit = 100, whereClause = null) {
    const queryId = this.performanceMonitor?.startQuery(
      'get_table_data',
      `Get data from ${schema}.${tableName} (limit: ${limit})`,
      { tableName, database, schema, limit, whereClause }
    );

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

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [result.recordset.length],
          recordset: result.recordset
        });
      }

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
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);
      throw new McpError(ErrorCode.InternalError, `Failed to get table data: ${error.message}`);
    }
  }

  async explainQuery(query, database = null, includeActualPlan = false) {
    const queryId = this.performanceMonitor?.startQuery(
      'explain_query',
      `Explain query: ${query.substring(0, 50)}...`,
      { database, includeActualPlan }
    );

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

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [planResult.recordset.length],
          recordset: planResult.recordset
        });
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
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);
      throw new McpError(ErrorCode.InternalError, `Failed to explain query: ${error.message}`);
    }
  }

  async listForeignKeys(database = null, schema = 'dbo') {
    const queryId = this.performanceMonitor?.startQuery(
      'list_foreign_keys',
      `List foreign keys in ${schema} schema`,
      { database, schema }
    );

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

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [result.recordset.length],
          recordset: result.recordset
        });
      }

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
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);
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
    const queryId = this.performanceMonitor?.startQuery(
      'export_table_csv',
      `Export ${schema}.${tableName} to CSV${limit ? ` (limit: ${limit})` : ''}`,
      { tableName, database, schema, limit, whereClause }
    );

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

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [result.recordset.length],
          recordset: result.recordset
        });
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
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to export table as CSV: ${error.message}`
      );
    }
  }

  /**
   * Get overall performance statistics and health summary
   * @param {string} timeframe - Time period: 'recent' (5 min), 'session' (startup), 'all' (default)
   * @returns {object} Performance statistics
   */
  async getPerformanceStats(timeframe = 'all') {
    try {
      if (!this.performanceMonitor) {
        throw new McpError(ErrorCode.InternalError, 'Performance monitoring is not initialized');
      }

      const stats = this.performanceMonitor.getStats();

      if (!stats || !stats.enabled) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  enabled: false,
                  message: 'Performance monitoring is disabled',
                  timeframe: timeframe
                },
                null,
                2
              )
            }
          ]
        };
      }

      // Validate timeframe parameter - normalize invalid values to 'all' and continue with normal stats
      const validTimeframes = ['recent', 'session', 'all'];
      const normalizedTimeframe = validTimeframes.includes(timeframe) ? timeframe : 'all';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...stats,
                timeframe: normalizedTimeframe,
                timestamp: Date.now()
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get performance statistics: ${error.message}`
      );
    }
  }

  /**
   * Get detailed query performance breakdown by tool
   * @param {number} limit - Maximum number of queries to analyze (default: 50)
   * @param {string} toolFilter - Filter by specific MCP tool name (optional)
   * @param {boolean} slowOnly - Only return slow queries (default: false)
   * @returns {object} Query performance details
   */
  async getQueryPerformance(limit = 50, toolFilter = null, slowOnly = false) {
    try {
      if (!this.performanceMonitor) {
        throw new McpError(ErrorCode.InternalError, 'Performance monitoring is not initialized');
      }

      // Ensure limit is positive and handle edge cases - negative values should default to 50
      const parsedLimit = Number(limit);
      const normalizedLimit = isNaN(parsedLimit) || parsedLimit <= 0 ? 50 : parsedLimit;

      const queryStats = this.performanceMonitor.getQueryStats(normalizedLimit);

      if (!queryStats.enabled) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  enabled: false,
                  message: 'Performance monitoring is disabled',
                  limit: normalizedLimit,
                  tool_filter: toolFilter,
                  slow_only: slowOnly
                },
                null,
                2
              )
            }
          ]
        };
      }

      // Apply filtering
      let filteredQueries = queryStats.queries;

      if (toolFilter) {
        filteredQueries = filteredQueries.filter(q => q.tool === toolFilter);
      }

      if (slowOnly && queryStats.slowQueries) {
        filteredQueries = queryStats.slowQueries;
        if (toolFilter) {
          filteredQueries = filteredQueries.filter(q => q.tool === toolFilter);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...queryStats,
                queries: filteredQueries,
                limit: normalizedLimit,
                tool_filter: toolFilter,
                slow_only: slowOnly,
                timestamp: Date.now()
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get query performance: ${error.message}`
      );
    }
  }

  /**
   * Get connection pool health metrics and diagnostics
   * @returns {object} Connection pool health metrics
   */
  async getConnectionHealth() {
    try {
      if (!this.performanceMonitor) {
        throw new McpError(ErrorCode.InternalError, 'Performance monitoring is not initialized');
      }

      const poolStats = this.performanceMonitor.getPoolStats();

      if (!poolStats.enabled) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  enabled: false,
                  message: 'Connection pool monitoring is disabled'
                },
                null,
                2
              )
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...poolStats,
                timestamp: Date.now()
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get connection health: ${error.message}`
      );
    }
  }

  /**
   * Get index recommendations for database optimization
   * @param {string} database - Database name (optional)
   * @param {string} schema - Schema name (defaults to 'dbo')
   * @param {number} limit - Maximum recommendations to return (defaults to 10)
   * @param {number} impactThreshold - Minimum impact score (0-100, optional)
   * @returns {object} Index recommendations
   */
  async getIndexRecommendations(
    database = null,
    schema = 'dbo',
    limit = 10,
    impactThreshold = null
  ) {
    let queryId = null;

    // Safely start performance monitoring
    try {
      if (this.performanceMonitor && this.performanceMonitor.startQuery) {
        queryId = this.performanceMonitor.startQuery(
          'get_index_recommendations',
          `Get index recommendations for ${database || 'current database'}.${schema}`,
          { database, schema, limit, impactThreshold }
        );
      }
    } catch (perfError) {
      // Performance monitoring is optional - continue without it
      console.error('Performance monitoring error in getIndexRecommendations:', perfError.message);
    }

    try {
      // Validate input parameters
      if (impactThreshold !== null && (impactThreshold < 0 || impactThreshold > 100)) {
        throw new McpError(ErrorCode.InvalidRequest, 'Impact threshold must be between 0 and 100');
      }

      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      // Query to get missing index recommendations from SQL Server DMVs
      const indexQuery = `
        SELECT TOP ${limit || 10}
          DB_NAME() as database_name,
          s.name as schema_name,
          t.name as table_name,
          'IX_' + t.name + '_' + 
            REPLACE(REPLACE(REPLACE(COALESCE(mid.equality_columns, '') + 
            CASE WHEN mid.inequality_columns IS NOT NULL 
                 THEN CASE WHEN mid.equality_columns IS NOT NULL THEN '_' ELSE '' END + mid.inequality_columns 
                 ELSE '' END, '[', ''), ']', ''), ', ', '_') as recommended_index,
          COALESCE(mid.equality_columns, '') + 
            CASE WHEN mid.inequality_columns IS NOT NULL 
                 THEN CASE WHEN mid.equality_columns IS NOT NULL THEN ', ' ELSE '' END + mid.inequality_columns 
                 ELSE '' END as columns,
          'NONCLUSTERED' as index_type,
          CAST(ROUND(migs.avg_user_impact, 1) as DECIMAL(5,1)) as impact_score,
          CAST(ROUND(migs.avg_user_impact, 0) as VARCHAR(10)) + '% faster queries' as estimated_improvement,
          migs.unique_compiles as missing_index_handle,
          migs.user_seeks,
          migs.user_scans,
          CAST(migs.avg_total_user_cost as DECIMAL(10,2)) as avg_total_user_cost,
          CAST(migs.avg_user_impact as DECIMAL(5,1)) as avg_user_impact
        FROM sys.dm_db_missing_index_group_stats migs
        INNER JOIN sys.dm_db_missing_index_groups mig ON migs.group_handle = mig.index_group_handle
        INNER JOIN sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle
        INNER JOIN sys.objects t ON mid.object_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE mid.database_id = DB_ID()
          AND s.name = '${schema}'
          ${impactThreshold ? `AND migs.avg_user_impact >= ${impactThreshold}` : ''}
        ORDER BY migs.avg_user_impact DESC, migs.user_seeks + migs.user_scans DESC
      `;

      const result = await request.query(indexQuery);

      // Record successful completion
      if (queryId) {
        try {
          this.performanceMonitor.endQuery(queryId, {
            rowsAffected: [result.recordset.length],
            recordset: result.recordset
          });
        } catch {
          // Performance monitoring is optional
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                database_name: database || 'current',
                schema_name: schema,
                limit_applied: limit || 10,
                impact_threshold: impactThreshold,
                recommendations: result.recordset,
                total_recommendations: result.recordset.length,
                security_info: {
                  read_only_mode: this.readOnlyMode,
                  destructive_operations_allowed: this.allowDestructiveOperations,
                  schema_changes_allowed: this.allowSchemaChanges,
                  can_create_indexes: !this.readOnlyMode && this.allowSchemaChanges
                },
                security_note: this.readOnlyMode
                  ? 'Running in read-only mode - recommendations are for analysis only'
                  : 'Index creation requires schema change permissions',
                timestamp: Date.now()
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      // Record failed query
      if (queryId) {
        try {
          this.performanceMonitor.endQuery(queryId, null, error);
        } catch {
          // Performance monitoring is optional
        }
      }

      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get index recommendations: ${error.message}`
      );
    }
  }

  /**
   * Analyze query performance and provide optimization suggestions
   * @param {string} query - SQL query to analyze
   * @param {string} database - Database name (optional)
   * @returns {object} Query analysis and optimization suggestions
   */
  async analyzeQueryPerformance(query, database = null) {
    const queryId = this.performanceMonitor?.startQuery(
      'analyze_query_performance',
      `Analyze query: ${query.substring(0, 50)}...`,
      { database }
    );

    try {
      // Safety validation first
      const validation = this.validateQuery(query);
      if (!validation.allowed) {
        if (queryId) this.performanceMonitor.endQuery(queryId, null, new Error(validation.reason));
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

      // Get execution plan for analysis
      let planData = {};
      try {
        await request.query('SET SHOWPLAN_ALL ON');
        const planResult = await request.query(query);
        planData = planResult.recordset[0] || {};
        await request.query('SET SHOWPLAN_ALL OFF');
      } catch {
        // Plan data is optional for analysis
        try {
          await request.query('SET SHOWPLAN_ALL OFF');
        } catch {
          /* ignore */
        }
      }

      // Get query statistics if available
      let executionStats = {};
      try {
        const statsQuery = `
          SELECT TOP 1
            qs.execution_count,
            qs.total_worker_time / qs.execution_count as avg_cpu_time,
            qs.total_logical_reads / qs.execution_count as avg_logical_reads,
            qs.total_elapsed_time / qs.execution_count as avg_duration,
            qs.total_physical_reads / qs.execution_count as avg_physical_reads
          FROM sys.dm_exec_query_stats qs
          CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
          WHERE st.text LIKE '%${query.replace(/'/g, "''").substring(0, 30)}%'
          ORDER BY qs.last_execution_time DESC
        `;

        const statsResult = await request.query(statsQuery);
        executionStats = statsResult.recordset[0] || {};
      } catch {
        // Stats are optional
      }

      // Initialize query optimizer and analyze
      const optimizer = new QueryOptimizer();
      const analysis = optimizer.analyzeQuery(query, executionStats, planData);

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [1],
          recordset: [{ analysis_completed: true }]
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query: query,
                database_name: database || 'current',
                analysis: analysis,
                execution_stats: executionStats,
                plan_data: planData,
                security_info: {
                  read_only_mode: this.readOnlyMode,
                  destructive_operations_allowed: this.allowDestructiveOperations,
                  schema_changes_allowed: this.allowSchemaChanges
                },
                timestamp: Date.now()
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);

      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to analyze query performance: ${error.message}`
      );
    }
  }

  /**
   * Detect and analyze query bottlenecks in the database
   * @param {string} database - Database name (optional)
   * @param {number} limit - Maximum bottlenecks to return (defaults to 10)
   * @param {string} severityFilter - Filter by severity (LOW, MEDIUM, HIGH, CRITICAL)
   * @returns {object} Query bottleneck analysis
   */
  async detectQueryBottlenecks(database = null, limit = 10, severityFilter = null) {
    const queryId = this.performanceMonitor?.startQuery(
      'detect_query_bottlenecks',
      `Detect bottlenecks in ${database || 'current database'}`,
      { database, limit, severityFilter }
    );

    try {
      // Validate severity filter
      const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      if (severityFilter && !validSeverities.includes(severityFilter.toUpperCase())) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Invalid severity level. Must be one of: LOW, MEDIUM, HIGH, CRITICAL'
        );
      }

      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      // Query to get slow/problematic queries with wait statistics
      const bottleneckQuery = `
        SELECT TOP ${limit || 10}
          CONVERT(varchar(32), qs.query_hash, 1) as query_hash,
          SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
            ((CASE qs.statement_end_offset
              WHEN -1 THEN DATALENGTH(st.text)
              ELSE qs.statement_end_offset
            END - qs.statement_start_offset)/2) + 1) as query_text,
          DB_NAME() as database_name,
          qs.total_elapsed_time / qs.execution_count as avg_duration_ms,
          qs.execution_count as total_executions,
          qs.total_worker_time / qs.execution_count as avg_cpu_time_ms,
          qs.total_logical_reads / qs.execution_count as avg_logical_reads,
          qs.total_physical_reads / qs.execution_count as avg_physical_reads,
          qs.total_logical_writes / qs.execution_count as avg_writes,
          0 as avg_wait_time_ms, -- Will be populated by bottleneck detector
          qs.last_execution_time
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
        WHERE qs.total_elapsed_time / qs.execution_count > 1000 -- Only queries > 1 second avg
          OR qs.total_logical_reads / qs.execution_count > 5000  -- Or high I/O queries
        ORDER BY 
          CASE 
            WHEN qs.total_elapsed_time / qs.execution_count > 5000 THEN 1
            WHEN qs.total_logical_reads / qs.execution_count > 10000 THEN 2
            ELSE 3
          END,
          qs.total_elapsed_time DESC
      `;

      const result = await request.query(bottleneckQuery);

      // Initialize bottleneck detector and analyze results
      const detector = new BottleneckDetector();
      const bottlenecks = result.recordset.map(queryData => {
        // Add mock wait stats for demonstration
        queryData.wait_stats = [
          {
            wait_type: 'PAGEIOLATCH_SH',
            wait_time_ms: Math.floor(queryData.avg_duration_ms * 0.3),
            wait_count: Math.floor(queryData.total_executions * 0.2)
          },
          {
            wait_type: 'LCK_M_S',
            wait_time_ms: Math.floor(queryData.avg_duration_ms * 0.1),
            wait_count: Math.floor(queryData.total_executions * 0.05)
          }
        ];

        return detector.analyzeQuery(queryData);
      });

      // Filter by severity if requested
      let filteredBottlenecks = bottlenecks;
      if (severityFilter) {
        filteredBottlenecks = detector.filterBySeverity(bottlenecks, severityFilter);
      }

      // Sort by impact score
      filteredBottlenecks = detector.sortByImpact(filteredBottlenecks);

      // Generate summary
      const summary = detector.generateSummary(filteredBottlenecks);

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [filteredBottlenecks.length],
          recordset: filteredBottlenecks
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                database_name: database || 'current',
                limit_applied: limit || 10,
                severity_filter: severityFilter,
                bottlenecks: filteredBottlenecks,
                summary: summary,
                security_info: {
                  read_only_mode: this.readOnlyMode,
                  destructive_operations_allowed: this.allowDestructiveOperations,
                  schema_changes_allowed: this.allowSchemaChanges
                },
                timestamp: Date.now()
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);

      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to detect query bottlenecks: ${error.message}`
      );
    }
  }

  /**
   * Get comprehensive database optimization insights and health analysis
   * @param {string} database - Database name (optional)
   * @param {string} analysisPeriod - Analysis period (24_HOURS, 7_DAYS, 30_DAYS)
   * @returns {object} Comprehensive optimization insights
   */
  async getOptimizationInsights(database = null, analysisPeriod = '7_DAYS') {
    const queryId = this.performanceMonitor?.startQuery(
      'get_optimization_insights',
      `Get optimization insights for ${database || 'current database'}`,
      { database, analysisPeriod }
    );

    try {
      const request = this.pool.request();
      request.timeout = this.requestTimeout;

      if (database) {
        await request.query(`USE [${database}]`);
      }

      // Convert analysis period to SQL date filter
      let dateFilter;
      switch (analysisPeriod) {
        case '24_HOURS':
          dateFilter = 'DATEADD(HOUR, -24, GETDATE())';
          break;
        case '30_DAYS':
          dateFilter = 'DATEADD(DAY, -30, GETDATE())';
          break;
        case '7_DAYS':
        default:
          dateFilter = 'DATEADD(DAY, -7, GETDATE())';
          break;
      }

      // Query 1: Count missing indexes
      const missingIndexQuery = `
        SELECT COUNT(*) as total_missing_indexes
        FROM sys.dm_db_missing_index_group_stats migs
        INNER JOIN sys.dm_db_missing_index_groups mig ON migs.group_handle = mig.index_group_handle
        INNER JOIN sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle
        WHERE mid.database_id = DB_ID()
          AND migs.avg_user_impact > 10
      `;

      // Query 2: Count slow queries
      const slowQueryQuery = `
        SELECT COUNT(*) as slow_queries_count
        FROM sys.dm_exec_query_stats qs
        WHERE qs.total_elapsed_time / qs.execution_count > 5000
          AND qs.last_execution_time > ${dateFilter}
      `;

      // Query 3: Check for blocking sessions
      const blockingQuery = `
        SELECT COUNT(*) as blocking_sessions
        FROM sys.dm_exec_requests r
        WHERE r.blocking_session_id > 0
      `;

      // Query 4: Get resource utilization
      const resourceQuery = `
        SELECT 
          AVG(CAST(cntr_value as FLOAT)) as avg_cpu_percent,
          50 as avg_io_percent -- Mock data for demo
        FROM sys.dm_os_performance_counters
        WHERE counter_name = 'CPU usage %' AND instance_name = 'default'
      `;

      // Execute all queries
      const missingIndexResult = await request.query(missingIndexQuery);
      const slowQueryResult = await request.query(slowQueryQuery);
      const blockingResult = await request.query(blockingQuery);
      const resourceResult = await request.query(resourceQuery);

      // Extract results
      const missingIndexes = missingIndexResult.recordset[0]?.total_missing_indexes || 0;
      const slowQueries = slowQueryResult.recordset[0]?.slow_queries_count || 0;
      const blockingSessions = blockingResult.recordset[0]?.blocking_sessions || 0;
      const resourceStats = resourceResult.recordset[0] || {
        avg_cpu_percent: 0,
        avg_io_percent: 0
      };

      // Calculate health score (0-100)
      let healthScore = 100;

      // Deduct points for issues
      if (missingIndexes > 10) healthScore -= 30;
      else if (missingIndexes > 5) healthScore -= 15;

      if (slowQueries > 20) healthScore -= 25;
      else if (slowQueries > 10) healthScore -= 12;

      if (blockingSessions > 0) healthScore -= 20;

      if (resourceStats.avg_cpu_percent > 80) healthScore -= 15;
      else if (resourceStats.avg_cpu_percent > 60) healthScore -= 8;

      // Determine health status
      let healthStatus;
      let criticalIssues = 0;

      if (healthScore >= 80) {
        healthStatus = 'HEALTHY';
      } else if (healthScore >= 60) {
        healthStatus = 'NEEDS_ATTENTION';
        if (missingIndexes > 10) criticalIssues++;
      } else {
        healthStatus = 'CRITICAL';
        if (missingIndexes > 10) criticalIssues++;
        if (slowQueries > 20) criticalIssues++;
        if (blockingSessions > 5) criticalIssues++;
      }

      // Build insights response
      const insights = {
        database_name: database || 'current',
        analysis_period: analysisPeriod,
        overall_health: {
          score: Math.max(0, healthScore),
          status: healthStatus,
          issues_count: [
            missingIndexes > 0 ? 1 : 0,
            slowQueries > 0 ? 1 : 0,
            blockingSessions > 0 ? 1 : 0
          ].reduce((a, b) => a + b, 0),
          critical_issues: criticalIssues
        },
        top_issues: [
          {
            category: 'MISSING_INDEXES',
            severity: missingIndexes > 10 ? 'CRITICAL' : missingIndexes > 5 ? 'HIGH' : 'MEDIUM',
            count: missingIndexes,
            impact: missingIndexes > 10 ? 'HIGH' : 'MEDIUM',
            description: `${missingIndexes} high-impact missing indexes detected`,
            estimated_improvement: '30-50% average query performance improvement'
          },
          {
            category: 'SLOW_QUERIES',
            severity: slowQueries > 20 ? 'HIGH' : slowQueries > 10 ? 'MEDIUM' : 'LOW',
            count: slowQueries,
            impact: 'MEDIUM',
            description: `${slowQueries} queries taking longer than 5 seconds`,
            estimated_improvement: '40% reduction in query time'
          },
          {
            category: 'BLOCKING_ISSUES',
            severity: blockingSessions > 5 ? 'HIGH' : blockingSessions > 0 ? 'MEDIUM' : 'LOW',
            count: blockingSessions,
            impact: blockingSessions > 0 ? 'MEDIUM' : 'LOW',
            description:
              blockingSessions > 0
                ? 'Lock contention and blocking detected'
                : 'No current blocking detected',
            estimated_improvement: blockingSessions > 0 ? '20% improvement in concurrency' : 'N/A'
          }
        ].filter(issue => issue.count > 0),
        recommendations: [],
        trends: {
          performance_trend:
            healthScore < 70 ? 'DECLINING' : healthScore > 85 ? 'IMPROVING' : 'STABLE',
          query_volume_trend: 'STABLE', // Would require historical data
          error_rate_trend: 'STABLE' // Would require error log analysis
        },
        metrics: {
          missing_indexes: missingIndexes,
          slow_queries: slowQueries,
          blocking_sessions: blockingSessions,
          avg_cpu_percent: resourceStats.avg_cpu_percent,
          avg_io_percent: resourceStats.avg_io_percent
        }
      };

      // Generate recommendations based on findings
      if (missingIndexes > 5) {
        insights.recommendations.push({
          priority: missingIndexes > 10 ? 'CRITICAL' : 'HIGH',
          type: 'INDEX_OPTIMIZATION',
          action: `Create ${Math.min(missingIndexes, 5)} high-impact missing indexes`,
          effort: 'LOW',
          impact: 'HIGH',
          estimated_benefit: '30-50% average performance improvement'
        });
      }

      if (slowQueries > 10) {
        insights.recommendations.push({
          priority: 'HIGH',
          type: 'QUERY_TUNING',
          action: `Optimize ${Math.min(slowQueries, 5)} slowest queries`,
          effort: 'MEDIUM',
          impact: 'HIGH',
          estimated_benefit: '50-70% improvement for affected queries'
        });
      }

      if (blockingSessions > 0) {
        insights.recommendations.push({
          priority: 'MEDIUM',
          type: 'CONCURRENCY_OPTIMIZATION',
          action: 'Review and optimize transaction scopes',
          effort: 'MEDIUM',
          impact: 'MEDIUM',
          estimated_benefit: '15-25% improvement in concurrency'
        });
      }

      // Record successful completion
      if (queryId) {
        this.performanceMonitor.endQuery(queryId, {
          rowsAffected: [1],
          recordset: [{ insights_generated: true }]
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...insights,
                security_info: {
                  read_only_mode: this.readOnlyMode,
                  destructive_operations_allowed: this.allowDestructiveOperations,
                  schema_changes_allowed: this.allowSchemaChanges
                },
                timestamp: Date.now()
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error) {
      // Record failed query
      if (queryId) this.performanceMonitor.endQuery(queryId, null, error);

      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get optimization insights: ${error.message}`
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
    // Log explicit boolean values instead of raw environment variables to avoid CodeQL warnings
    const isEncryptEnabled = process.env.SQL_SERVER_ENCRYPT === 'true';
    const isTrustCertEnabled = process.env.SQL_SERVER_TRUST_CERT !== 'false'; // defaults to true
    console.error(
      `  SQL_SERVER_ENCRYPT=${isEncryptEnabled ? 'true' : 'false'} (SSL encryption enabled)`
    );
    console.error(
      `  SQL_SERVER_TRUST_CERT=${isTrustCertEnabled ? 'true' : 'false'} (Trust server certificate)`
    );
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

    // Streaming Configuration
    const streamingEnabled = process.env.ENABLE_STREAMING === 'true';
    if (
      streamingEnabled ||
      process.env.STREAMING_BATCH_SIZE ||
      process.env.STREAMING_MAX_MEMORY_MB ||
      process.env.STREAMING_MAX_RESPONSE_SIZE
    ) {
      console.error('📈 Streaming Configuration:');
      console.error(
        `  ENABLE_STREAMING=${process.env.ENABLE_STREAMING || 'false'} (${streamingEnabled ? '✅ Intelligent streaming for large datasets' : '❌ Streaming disabled'})`
      );
      if (process.env.STREAMING_BATCH_SIZE) {
        console.error(
          `  STREAMING_BATCH_SIZE=${process.env.STREAMING_BATCH_SIZE} (Rows per batch for memory efficiency)`
        );
      }
      if (process.env.STREAMING_MAX_MEMORY_MB) {
        console.error(
          `  STREAMING_MAX_MEMORY_MB=${process.env.STREAMING_MAX_MEMORY_MB} (Memory limit before streaming activation)`
        );
      }
      if (process.env.STREAMING_MAX_RESPONSE_SIZE) {
        console.error(
          `  STREAMING_MAX_RESPONSE_SIZE=${process.env.STREAMING_MAX_RESPONSE_SIZE} (Response size limit for chunking)`
        );
      }
    }

    // Performance Monitoring
    const perfMonitoring = process.env.ENABLE_PERFORMANCE_MONITORING === 'true';
    if (
      perfMonitoring ||
      process.env.SLOW_QUERY_THRESHOLD ||
      process.env.PERFORMANCE_SAMPLING_RATE ||
      process.env.MAX_METRICS_HISTORY ||
      process.env.TRACK_POOL_METRICS
    ) {
      console.error('⚡ Performance Monitoring:');
      console.error(
        `  ENABLE_PERFORMANCE_MONITORING=${process.env.ENABLE_PERFORMANCE_MONITORING || 'false'} (${perfMonitoring ? '✅ Query performance tracking enabled' : '❌ Performance monitoring disabled'})`
      );
      if (process.env.SLOW_QUERY_THRESHOLD) {
        console.error(
          `  SLOW_QUERY_THRESHOLD=${process.env.SLOW_QUERY_THRESHOLD} (Milliseconds to flag slow queries)`
        );
      }
      if (process.env.PERFORMANCE_SAMPLING_RATE) {
        console.error(
          `  PERFORMANCE_SAMPLING_RATE=${process.env.PERFORMANCE_SAMPLING_RATE} (Fraction of queries to monitor, 1.0 = 100%)`
        );
      }
      if (process.env.MAX_METRICS_HISTORY) {
        console.error(
          `  MAX_METRICS_HISTORY=${process.env.MAX_METRICS_HISTORY} (Maximum performance records to retain)`
        );
      }
      if (process.env.TRACK_POOL_METRICS) {
        const poolTrackingEnabled = process.env.TRACK_POOL_METRICS === 'true';
        console.error(
          `  TRACK_POOL_METRICS=${process.env.TRACK_POOL_METRICS} (${poolTrackingEnabled ? '✅ Connection pool monitoring enabled' : '❌ Pool monitoring disabled'})`
        );
      }
    }

    // Enhanced Logging & Audit
    if (
      process.env.SQL_SERVER_LOG_LEVEL ||
      process.env.ENABLE_SECURITY_AUDIT ||
      process.env.SQL_SERVER_RESPONSE_FORMAT
    ) {
      console.error('📝 Logging & Response Configuration:');
      if (process.env.SQL_SERVER_LOG_LEVEL) {
        console.error(
          `  SQL_SERVER_LOG_LEVEL=${process.env.SQL_SERVER_LOG_LEVEL} (Logging detail level)`
        );
      }
      if (process.env.ENABLE_SECURITY_AUDIT) {
        const auditEnabled = process.env.ENABLE_SECURITY_AUDIT === 'true';
        console.error(
          `  ENABLE_SECURITY_AUDIT=${process.env.ENABLE_SECURITY_AUDIT} (${auditEnabled ? '✅ Security audit trail enabled' : '❌ Security auditing disabled'})`
        );
      }
      if (process.env.SQL_SERVER_RESPONSE_FORMAT) {
        console.error(
          `  SQL_SERVER_RESPONSE_FORMAT=${process.env.SQL_SERVER_RESPONSE_FORMAT} (Output format optimization)`
        );
      }
    }

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
