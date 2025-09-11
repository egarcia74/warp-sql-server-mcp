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

// Read package.json for version info
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
   * Validates a SQL query against safety policies
   */
  validateQuery(query) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return { allowed: true, reason: 'Empty query' };
    }

    // Use direct property access for tests that override properties
    const readOnlyMode = this.readOnlyMode;
    const allowDestructiveOperations = this.allowDestructiveOperations;
    const allowSchemaChanges = this.allowSchemaChanges;

    // 🚀 OPTIMIZATION: Skip all parsing when in "full destruction mode"
    // When all safety restrictions are disabled, bypass expensive parsing
    if (!readOnlyMode && allowDestructiveOperations && allowSchemaChanges) {
      return {
        allowed: true,
        reason: 'Full destruction mode - all restrictions disabled, query validation bypassed',
        queryType: 'unrestricted',
        optimized: true
      };
    }

    const securityConfig = this.config.getSecurityConfig();

    // First, determine the query type
    const queryType = this._getQueryType(trimmedQuery, securityConfig);

    // Check read-only mode first (most restrictive)
    if (readOnlyMode) {
      if (queryType !== 'select') {
        return {
          allowed: false,
          reason:
            'Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.',
          queryType: queryType === 'select' ? 'select' : 'non-select' // Keep original type for read-only violations
        };
      }
      return { allowed: true, reason: 'Query validation passed', queryType };
    }

    // If not in read-only mode, check specific operation restrictions

    // Check for destructive operations
    if (queryType === 'destructive' && !allowDestructiveOperations) {
      return {
        allowed: false,
        reason:
          'Destructive operations (INSERT/UPDATE/DELETE) are disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.',
        queryType: 'destructive'
      };
    }

    // Check for schema changes
    if (queryType === 'schema' && !allowSchemaChanges) {
      return {
        allowed: false,
        reason:
          'Schema changes (CREATE/DROP/ALTER) are disabled. Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=true to enable.',
        queryType: 'schema'
      };
    }

    return { allowed: true, reason: 'Query validation passed', queryType };
  }

  /**
   * Determine the type of SQL query
   * @private
   */
  _getQueryType(query, securityConfig) {
    // Check for multi-statement queries first (semicolon separated)
    const statements = query
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (statements.length > 1) {
      // For multi-statement, find the most restrictive type
      const types = statements.map(stmt => this._getSingleQueryType(stmt, securityConfig));

      if (types.includes('schema')) return 'schema';
      if (types.includes('destructive')) return 'destructive';
      if (types.includes('select')) return 'select';
      return 'unknown';
    }

    return this._getSingleQueryType(query, securityConfig);
  }

  /**
   * Determine the type of a single SQL statement
   * @private
   */
  _getSingleQueryType(query, securityConfig) {
    const trimmedQuery = query.trim();

    // Safety check for corrupted security patterns
    if (!securityConfig?.patterns) {
      this.logger.warn('Security patterns are corrupted, falling back to default behavior');
      return 'unknown';
    }

    // Check for read-only queries
    if (securityConfig.patterns.readOnly?.some?.(pattern => pattern.test(trimmedQuery))) {
      return 'select';
    }

    // Check for schema changes
    if (securityConfig.patterns.schemaChanges?.some?.(pattern => pattern.test(trimmedQuery))) {
      return 'schema';
    }

    // Check for destructive operations
    if (securityConfig.patterns.destructive?.some?.(pattern => pattern.test(trimmedQuery))) {
      return 'destructive';
    }

    return 'unknown';
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
            return {
              content: await this.databaseTools.getTableData(
                args.table_name,
                args.database,
                args.schema,
                args.limit,
                args.offset
              )
            };

          case 'export_table_csv':
            return {
              content: await this.databaseTools.exportTableCsv(
                args.table_name,
                args.database,
                args.schema,
                args.limit
              )
            };

          case 'explain_query':
            return {
              content: await this.databaseTools.explainQuery(args.query, args.database)
            };

          case 'get_performance_stats':
            return {
              content: this.getPerformanceStats()
            };

          case 'get_query_performance':
            return {
              content: this.getQueryPerformance(args.limit)
            };

          case 'get_connection_health':
            return {
              content: this.getConnectionHealth()
            };

          case 'get_index_recommendations':
            return {
              content: await this.getIndexRecommendations(args.database)
            };

          case 'analyze_query_performance':
            return {
              content: await this.analyzeQueryPerformance(args.query, args.database)
            };

          case 'detect_query_bottlenecks':
            return {
              content: await this.detectQueryBottlenecks(args.database)
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
        await request.query(`USE [${database}]`);
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

      return this.formatQueryResults(result.recordset);
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

  /**
   * Format query results for display
   */
  formatQueryResults(data) {
    if (data.length === 0) {
      return { content: [{ type: 'text', text: 'No data returned' }] };
    }

    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(header => String(row[header] || '')));

    return {
      content: [
        {
          type: 'text',
          text: this.createTextTable(headers, rows)
        }
      ]
    };
  }

  /**
   * Create a text-based table
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
  getPerformanceStats() {
    const stats = this.performanceMonitor.getStats();
    return [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: stats
          },
          null,
          2
        )
      }
    ];
  }

  getQueryPerformance(limit = 50) {
    const queryStats = this.performanceMonitor.getQueryStats(limit);
    return [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: queryStats
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
  async getIndexRecommendations(database) {
    try {
      const recommendations = await this.queryOptimizer.analyzeIndexUsage(database);
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
    const analysis = await this.queryOptimizer.analyzeQuery(query, database);
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

  async detectQueryBottlenecks(database) {
    try {
      const bottlenecks = await this.bottleneckDetector.detectBottlenecks(database);
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
          securityLevel: this.readOnlyMode
            ? 'MAXIMUM (Read-Only)'
            : this.allowSchemaChanges
              ? 'MINIMAL (Full Access)'
              : this.allowDestructiveOperations
                ? 'MEDIUM (DML Allowed)'
                : 'HIGH (DDL Blocked)'
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
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new SqlServerMCP();
  server.run().catch(error => {
    // Use console.error here since logger might not be initialized yet
    console.error('Server startup error:', error);
    process.exit(1);
  });
}

// Export the class for testing
export { SqlServerMCP };
