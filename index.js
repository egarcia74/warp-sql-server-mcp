#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

// Import our new modular components
import { getAllTools } from './lib/tools/tool-registry.js';
import { ConnectionManager } from './lib/database/connection-manager.js';
import { serverConfig } from './lib/config/server-config.js';
import { DatabaseToolsHandler } from './lib/tools/handlers/database-tools.js';
import { PerformanceMonitor } from './lib/utils/performance-monitor.js';
import { QueryOptimizer } from './lib/analysis/query-optimizer.js';
import { BottleneckDetector } from './lib/analysis/bottleneck-detector.js';
import { Logger } from './lib/utils/logger.js';
import { findForbiddenWhereClauseSyntax } from './lib/security/where-clause-guard.js';
import { validateQuery as evaluateQuerySafety } from './lib/security/query-policy.js';
import { formatQueryResults } from './lib/utils/result-formatter.js';
import { escapeBracketIdentifier } from './lib/utils/sql-identifier.js';

// Read package.json for version info
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const VERSION = packageJson.version;

// Load environment variables
// Suppress dotenv output in MCP environments to avoid parsing warnings
const isMcpEnvironment =
  process.env.VSCODE_MCP === 'true' ||
  process.env.MCP_TRANSPORT === 'stdio' ||
  process.env.PARENT_PROCESS?.includes('code') ||
  process.env.PARENT_PROCESS?.includes('mcp') ||
  (!process.stdout.isTTY &&
    (!process.stdin.isTTY || process.stdin.isTTY === undefined) &&
    process.ppid);

if (isMcpEnvironment) {
  // In MCP environments, capture and suppress dotenv output to prevent parsing errors
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;

  // Temporarily suppress console output during dotenv loading
  console.log = () => {};
  console.warn = () => {};

  try {
    dotenv.config({ debug: false });
  } finally {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }
} else {
  dotenv.config();
}

class SqlServerMCP {
  constructor() {
    this.server = new Server(
      {
        name: 'warp-sql-server-mcp',
        version: VERSION,
        description: packageJson.description
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          logging: {}
        },
        instructions:
          "🗄️ SQL Server MCP Server - Enterprise-grade database operations with graduated safety levels\n\n📊 Available Operations:\n• Database exploration: list_databases, list_tables, describe_table\n• Data operations: execute_query, get_table_data, export_table_csv\n• Performance analysis: get_performance_stats, analyze_query_performance\n• Query optimization: get_index_recommendations, detect_query_bottlenecks\n• Server diagnostics: get_server_info, get_connection_health\n\n🔒 Security Features:\n• Three-tier safety system with read-only, DML, and DDL restrictions\n• Query validation and SQL injection protection\n• Comprehensive audit logging and performance monitoring\n\n⚙️ Configuration:\n• Use 'get_server_info' tool to view current security settings\n• Supports both SQL Server and Windows authentication\n• Enterprise secret management (Azure Key Vault, AWS Secrets Manager)\n\n🚀 Quick Start: Try 'list_databases' to explore available databases"
      }
    );

    // Initialize components with dependency injection
    this.config = serverConfig;
    // Force reload to ensure latest environment values are loaded
    this.config.reload();

    // Initialize logging system
    this.logger = new Logger({
      level: this.config.logging?.logLevel || 'info',
      enableSecurityAudit: this.config.logging?.securityAudit ?? false,
      // Only pass log file paths if they are explicitly set
      // This allows the Logger to use smart defaults when not specified
      ...(process.env.LOG_FILE && { logFile: process.env.LOG_FILE }),
      ...(process.env.SECURITY_LOG_FILE && { securityLogFile: process.env.SECURITY_LOG_FILE })
    });

    this.connectionManager = new ConnectionManager(this.config.getConnectionConfig());

    // Initialize performance monitoring
    this.performanceMonitor = new PerformanceMonitor(this.config.getPerformanceConfig());

    // Initialize tool handlers
    this.databaseTools = new DatabaseToolsHandler(this.connectionManager, this.performanceMonitor);

    // Initialize analyzers
    this.queryOptimizer = new QueryOptimizer(this.connectionManager);
    this.bottleneckDetector = new BottleneckDetector(this.connectionManager);

    // Setup tool handlers
    this.setupToolHandlers();

    // Configuration logging will happen after MCP server connects
  }

  /**
   * Validates a caller-supplied WHERE clause for table-scoped tools.
   *
   * The clause is concatenated into a SELECT, so it must pass the same safety
   * policy as execute_query — otherwise a filter such as "1=1; DELETE FROM t"
   * would bypass read-only mode. Throws McpError when the assembled statement
   * is not allowed; no-op when no clause is supplied.
   */
  validateWhereClause(where, tableName, schema = 'dbo', tool = 'get_table_data') {
    if (typeof where !== 'string' || !where.trim()) {
      return;
    }

    const clause = where.trim();
    const probe = `SELECT * FROM [${schema || 'dbo'}].[${tableName}] WHERE ${clause}`;

    const block = reason => {
      this.logger.security('QUERY_BLOCKED', 'WHERE clause blocked by safety policy', {
        query: probe.substring(0, 200),
        reason,
        tool
      });
      throw new McpError(
        ErrorCode.InvalidRequest,
        `WHERE clause blocked by safety policy: ${reason}`
      );
    };

    // Layer 1 — lexical guard. A filter must be a single predicate on the
    // requested table, which is stricter than validateQuery()'s statement-level
    // policy (e.g. a top-level UNION is a valid read-only query but not a valid
    // filter). This check must not rely on parsing the SQL.
    const lexicalReason = findForbiddenWhereClauseSyntax(clause);
    if (lexicalReason) {
      block(lexicalReason);
    }

    // Layer 2 — the same safety policy applied to execute_query.
    const validation = this.validateQuery(probe);
    if (!validation.allowed) {
      block(validation.reason);
    }
  }

  /**
   * Validates a SQL query against safety policies.
   *
   * Thin delegator: reads the active safety-mode flags from the instance
   * getters (which tests override) and the security patterns from config
   * (which tests spy on), then applies the pure policy in
   * lib/security/query-policy.js. The return shape is unchanged.
   */
  validateQuery(query) {
    // Use direct property access for tests that override properties
    const modes = {
      readOnlyMode: this.readOnlyMode,
      allowDestructiveOperations: this.allowDestructiveOperations,
      allowSchemaChanges: this.allowSchemaChanges
    };

    return evaluateQuerySafety(query, modes, this.config.getSecurityConfig(), this.logger);
  }

  setupToolHandlers() {
    // Register tools from the tool registry
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getAllTools()
    }));

    // Handle resources list (return empty since this server only provides tools)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: []
    }));

    // Handle tool calls
    this.handleCallToolRequest = async request => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_databases':
            return {
              content: await this.databaseTools.listDatabases()
            };

          case 'list_tables':
            return {
              content: await this.databaseTools.listTables(args.database, args.schema)
            };

          case 'describe_table':
            return {
              content: await this.databaseTools.describeTable(
                args.table_name,
                args.database,
                args.schema
              )
            };

          case 'list_foreign_keys':
            return {
              content: await this.databaseTools.listForeignKeys(args.database, args.schema)
            };

          case 'execute_query': {
            const queryResult = await this.executeQuery(args.query, args.database);
            return {
              content: queryResult.content
            };
          }

          case 'get_table_data':
            this.validateWhereClause(args.where, args.table_name, args.schema, 'get_table_data');
            return {
              content: await this.databaseTools.getTableData(
                args.table_name,
                args.database,
                args.schema,
                args.limit,
                args.offset,
                args.where
              )
            };

          case 'export_table_csv':
            this.validateWhereClause(args.where, args.table_name, args.schema, 'export_table_csv');
            return {
              content: await this.databaseTools.exportTableCsv(
                args.table_name,
                args.database,
                args.schema,
                args.limit,
                args.where
              )
            };

          case 'explain_query': {
            // include_actual_plan executes the statement (STATISTICS XML), so
            // gate explain_query through the same safety policy as execute_query
            // to prevent it being used to run DML/DDL in read-only mode.
            const explainValidation = this.validateQuery(args.query);
            if (!explainValidation.allowed) {
              this.logger.security('QUERY_BLOCKED', 'Query blocked by safety policy', {
                query: args.query?.substring(0, 200),
                reason: explainValidation.reason,
                queryType: explainValidation.queryType,
                tool: 'explain_query'
              });
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Query blocked by safety policy: ${explainValidation.reason}`
              );
            }
            return {
              content: await this.databaseTools.explainQuery(
                args.query,
                args.database,
                args.include_actual_plan
              )
            };
          }

          case 'get_performance_stats':
            return {
              content: this.getPerformanceStats(args.timeframe)
            };

          case 'get_query_performance':
            return {
              content: this.getQueryPerformance(args.limit, {
                slowOnly: args.slow_only,
                toolFilter: args.tool_filter
              })
            };

          case 'get_connection_health':
            return {
              content: this.getConnectionHealth()
            };

          case 'get_index_recommendations':
            return {
              content: await this.getIndexRecommendations(args.database, {
                limit: args.limit,
                impactThreshold: args.impact_threshold,
                schema: args.schema
              })
            };

          case 'analyze_query_performance':
            return {
              content: await this.analyzeQueryPerformance(args.query, args.database)
            };

          case 'detect_query_bottlenecks':
            return {
              content: await this.detectQueryBottlenecks(args.database, {
                limit: args.limit,
                severityFilter: args.severity_filter
              })
            };

          case 'get_optimization_insights':
            return {
              content: await this.getOptimizationInsights(args.database)
            };

          case 'get_server_info':
            return {
              content: this.getServerInfo(args.include_logs)
            };

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        // Ensure all thrown errors are McpError instances
        if (error instanceof McpError) {
          throw error;
        }
        // Wrap other errors in a generic McpError
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`);
      }
    };
    this.server.setRequestHandler(CallToolRequestSchema, this.handleCallToolRequest);
  }

  /**
   * Execute a SQL query with validation and performance tracking
   */
  async executeQuery(query, database = null) {
    // Validate query first
    const validation = this.validateQuery(query);
    if (!validation.allowed) {
      this.logger.security('QUERY_BLOCKED', 'Query blocked by safety policy', {
        query: query.substring(0, 200),
        reason: validation.reason,
        queryType: validation.queryType
      });
      throw new Error(`Query blocked by safety policy: ${validation.reason}`);
    }

    const startTime = Date.now();

    this.logger.debug('Executing query', {
      tool: 'execute_query',
      database,
      queryLength: query.length,
      queryType: validation.queryType
    });

    try {
      const pool = await this.connectionManager.connect();
      const request = pool.request();

      // Switch database if specified
      if (database) {
        await request.query(`USE [${escapeBracketIdentifier(database)}]`);
      }

      const result = await request.query(query);
      const executionTime = Date.now() - startTime;

      // Log successful query execution
      this.logger.logQueryExecution(
        'execute_query',
        query,
        { database, securityLevel: validation.queryType },
        { success: true, duration: executionTime, rowsAffected: result.rowsAffected }
      );

      // Track performance (don't let performance monitoring failures break query execution)
      try {
        this.performanceMonitor.recordQuery({
          tool: 'execute_query',
          query,
          executionTime,
          success: true,
          database,
          timestamp: new Date(startTime)
        });
      } catch (perfError) {
        this.logger.warn('Performance monitoring failed', { error: perfError.message });
      }

      // Format results
      if (!result.recordset || result.recordset.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Query executed successfully. ${result.rowsAffected} rows affected.`
            }
          ]
        };
      }

      return formatQueryResults(result.recordset);
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Log failed query execution
      this.logger.logQueryExecution(
        'execute_query',
        query,
        { database, securityLevel: validation.queryType },
        { success: false, duration: executionTime, error }
      );

      // Track failed query (don't let performance monitoring failures break error handling)
      try {
        this.performanceMonitor.recordQuery({
          tool: 'execute_query',
          query,
          executionTime,
          success: false,
          error: error.message,
          database,
          timestamp: new Date(startTime)
        });
      } catch (perfError) {
        this.logger.warn('Performance monitoring failed during error handling', {
          error: perfError.message
        });
      }

      throw new McpError(ErrorCode.InternalError, `Query execution failed: ${error.message}`);
    }
  }

  // Connection management methods for test compatibility
  async connectToDatabase(...args) {
    try {
      return await this.connectionManager.connect(...args);
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  // Database operation methods that delegate to handlers
  async listDatabases(...args) {
    try {
      return { content: await this.databaseTools.listDatabases(...args) };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async listTables(...args) {
    try {
      return { content: await this.databaseTools.listTables(...args) };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async describeTable(...args) {
    try {
      return { content: await this.databaseTools.describeTable(...args) };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async listForeignKeys(...args) {
    try {
      return { content: await this.databaseTools.listForeignKeys(...args) };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async getTableData(...args) {
    try {
      return {
        content: await this.databaseTools.getTableData(...args)
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async exportTableCsv(...args) {
    try {
      return { content: await this.databaseTools.exportTableCsv(...args) };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async explainQuery(...args) {
    try {
      return { content: await this.databaseTools.explainQuery(...args) };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  // Performance monitoring methods
  getPerformanceStats(timeframe = 'all') {
    const stats = this.performanceMonitor.getStats();

    // Scope the reported statistics to the requested window. The performance
    // monitor already maintains two windows: `recent` (last 5 minutes) and
    // `overall` (cumulative since server startup). We surface the block that
    // matches `timeframe` rather than inventing new tracking:
    //   - 'recent'            -> the last-5-minute block
    //   - 'session' / 'all'   -> the since-startup block (default)
    // The full stats object is still returned so existing consumers that read
    // `data.overall` / `data.recent` keep working; `data.timeframe` and
    // `data.scoped` make the selected window explicit for schema-driven clients.
    const normalizedTimeframe = ['recent', 'session', 'all'].includes(timeframe)
      ? timeframe
      : 'all';

    let data = stats;
    if (stats && stats.enabled) {
      const scoped = normalizedTimeframe === 'recent' ? stats.recent : stats.overall;
      data = {
        ...stats,
        timeframe: normalizedTimeframe,
        scoped
      };
    }

    return [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data
          },
          null,
          2
        )
      }
    ];
  }

  getQueryPerformance(limit = 50, { slowOnly = false, toolFilter = null } = {}) {
    const queryStats = this.performanceMonitor.getQueryStats(limit, { slowOnly, toolFilter });
    return [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: queryStats,
            filters: {
              slowOnly: Boolean(slowOnly),
              toolFilter: toolFilter || null
            }
          },
          null,
          2
        )
      }
    ];
  }

  getConnectionHealth() {
    const poolStats = this.performanceMonitor.getPoolStats();
    const connectionHealth = this.connectionManager.getConnectionHealth
      ? this.connectionManager.getConnectionHealth()
      : { connected: true, status: 'Connected' };

    return [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: {
              connection: connectionHealth,
              pool: poolStats
            }
          },
          null,
          2
        )
      }
    ];
  }

  // Query optimization methods
  async getIndexRecommendations(database, options = {}) {
    try {
      const recommendations = await this.queryOptimizer.analyzeIndexUsage(database, options);
      return [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: recommendations
            },
            null,
            2
          )
        }
      ];
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async analyzeQueryPerformance(query, database) {
    const analysis = this.queryOptimizer.analyzeQuery(query, database);
    return [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: analysis
          },
          null,
          2
        )
      }
    ];
  }

  async detectQueryBottlenecks(database, options = {}) {
    try {
      const bottlenecks = await this.bottleneckDetector.detectBottlenecks(database, options);
      return [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: bottlenecks
            },
            null,
            2
          )
        }
      ];
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  async getOptimizationInsights(database) {
    try {
      const insights = await this.queryOptimizer.getOptimizationInsights(database);
      return [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: insights
            },
            null,
            2
          )
        }
      ];
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }

  /**
   * Get server configuration and status information
   * @param {boolean} includeLogs - Whether to include recent log entries
   * @returns {Array} Formatted server information
   */
  getServerInfo(includeLogs = false) {
    const connectionSummary = this.config.getConnectionSummary();
    const performanceStats = this.performanceMonitor.getStats();
    const connectionHealth = this.getConnectionHealth();

    let securityLevel;
    if (this.readOnlyMode) {
      securityLevel = 'MAXIMUM (Read-Only)';
    } else if (this.allowSchemaChanges) {
      securityLevel = 'MINIMAL (Full Access)';
    } else if (this.allowDestructiveOperations) {
      securityLevel = 'MEDIUM (DML Allowed)';
    } else {
      securityLevel = 'HIGH (DDL Blocked)';
    }

    const serverInfo = {
      server: {
        name: 'warp-sql-server-mcp',
        version: VERSION,
        status: 'Running',
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform
      },
      configuration: {
        connection: {
          server: connectionSummary.server,
          database: connectionSummary.database,
          authType: connectionSummary.authType,
          encrypt: connectionSummary.encrypt,
          trustCert: connectionSummary.trustCert,
          pool: `${connectionSummary.poolMin}-${connectionSummary.poolMax} connections`
        },
        security: {
          readOnlyMode: this.readOnlyMode,
          allowDestructiveOperations: this.allowDestructiveOperations,
          allowSchemaChanges: this.allowSchemaChanges,
          securityLevel
        },
        performance: {
          enabled: this.config.performanceMonitoring.enabled,
          slowQueryThreshold: `${this.config.performanceMonitoring.slowQueryThreshold}ms`,
          maxMetricsHistory: this.config.performanceMonitoring.maxMetricsHistory,
          samplingRate: `${this.config.performanceMonitoring.samplingRate * 100}%`
        },
        logging: {
          level: this.logger.config.level,
          securityAudit: this.logger.config.enableSecurityAudit,
          responseFormat: this.config.logging.responseFormat,
          logFile: this.logger.config.logFile || 'Not configured (console only)',
          securityLogFile: this.logger.config.securityLogFile || 'Not configured (console only)'
        },
        streaming: {
          enabled: this.config.streaming.enabled,
          batchSize: this.config.streaming.batchSize,
          maxMemoryMB: this.config.streaming.maxMemoryMB,
          maxResponseSizeMB: Math.round(this.config.streaming.maxResponseSize / 1048576)
        }
      },
      runtime: {
        performance: performanceStats,
        connection: connectionHealth,
        environment: {
          nodeEnv: process.env.NODE_ENV || 'production',
          memoryUsage: process.memoryUsage(),
          pid: process.pid
        }
      }
    };

    if (includeLogs) {
      // Add detailed logging information including file paths
      serverInfo.logging = {
        note: "MCP server logs provide detailed insights into the system's operations and security events.",
        level: this.logger.config.level,
        securityAudit: this.logger.config.enableSecurityAudit ? 'Enabled' : 'Disabled',
        logLocation: 'stdout/stderr (captured by Warp)',
        structuredLogging: 'Winston-based with timestamps and metadata',
        mainLogFile: this.logger.config.logFile,
        securityLogFile: this.logger.config.securityLogFile,
        developmentMode: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
        outputTargets: {
          console: 'stdout/stderr (captured by Warp)',
          fileLogging: this.logger.config.logFile ? 'Enabled' : 'Console only',
          structuredLogging: 'Winston-based with timestamps and metadata'
        }
      };
    }

    return [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: serverInfo
          },
          null,
          2
        )
      }
    ];
  }

  // Configuration and utility methods
  printConfigurationSummary() {
    this.config.logConfiguration(this.connectionManager, this.logger);
  }

  // Expose configuration properties for test compatibility
  get readOnlyMode() {
    return this.config.getSecurityConfig().readOnlyMode;
  }

  get allowDestructiveOperations() {
    return this.config.getSecurityConfig().allowDestructiveOperations;
  }

  get allowSchemaChanges() {
    return this.config.getSecurityConfig().allowSchemaChanges;
  }

  get debugMode() {
    return this.config.isDebugMode();
  }

  // Pool access for test compatibility
  get pool() {
    return this.connectionManager.getPool ? this.connectionManager.getPool() : null;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    if (process.env.NODE_ENV !== 'test') {
      this.logger.info('SQL Server MCP server running on stdio');

      // Log enriched configuration summary after MCP server is connected so Warp captures it
      this.printConfigurationSummary();
    }
  }
}

// Main execution
// Use fileURLToPath for cross-platform compatibility (Windows vs Unix path formats)
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = new SqlServerMCP();
  server.run().catch(error => {
    // Use console.error here since logger might not be initialized yet
    console.error('Server startup error:', error);
    process.exit(1);
  });
}

// Export the class for testing
export { SqlServerMCP };
