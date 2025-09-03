#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
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

// Load environment variables
dotenv.config();

class SqlServerMCP {
  constructor() {
    this.server = new Server(
      {
        name: 'warp-sql-server-mcp',
        version: '1.6.2'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Initialize components with dependency injection
    this.config = serverConfig;
    this.connectionManager = new ConnectionManager(this.config.getConnectionConfig());

    // Initialize performance monitoring
    this.performanceMonitor = new PerformanceMonitor(this.config.getPerformanceConfig());

    // Initialize tool handlers
    this.databaseTools = new DatabaseToolsHandler(this.connectionManager, this.performanceMonitor);

    // Initialize analyzers
    this.queryOptimizer = new QueryOptimizer();
    this.bottleneckDetector = new BottleneckDetector();

    // Setup tool handlers
    this.setupToolHandlers();

    // Log configuration on startup - will attempt connection to get SSL info if encryption is enabled
    this._logConfigurationWithConnectionInfo();
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
      console.warn('Security patterns are corrupted, falling back to default behavior');
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

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
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

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`);
      }
    });
  }

  /**
   * Execute a SQL query with validation and performance tracking
   */
  async executeQuery(query, database = null) {
    // Validate query first
    const validation = this.validateQuery(query);
    if (!validation.allowed) {
      throw new Error(`Query blocked by safety policy: ${validation.reason}`);
    }

    const startTime = Date.now();

    try {
      const pool = await this.connectionManager.connect();
      const request = pool.request();

      // Switch database if specified
      if (database) {
        await request.query(`USE [${database}]`);
      }

      const result = await request.query(query);
      const executionTime = Date.now() - startTime;

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
        console.warn('Performance monitoring failed:', perfError.message);
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
        console.warn('Performance monitoring failed during error handling:', perfError.message);
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
  async connectToDatabase() {
    return await this.connectionManager.connect();
  }

  // Database operation methods that delegate to handlers
  async listDatabases() {
    return { content: await this.databaseTools.listDatabases() };
  }

  async listTables(database, schema) {
    return { content: await this.databaseTools.listTables(database, schema) };
  }

  async describeTable(tableName, database, schema) {
    return { content: await this.databaseTools.describeTable(tableName, database, schema) };
  }

  async listForeignKeys(database, schema) {
    return { content: await this.databaseTools.listForeignKeys(database, schema) };
  }

  async getTableData(tableName, database, schema, limit, offset) {
    return {
      content: await this.databaseTools.getTableData(tableName, database, schema, limit, offset)
    };
  }

  async exportTableCsv(tableName, database, schema) {
    return { content: await this.databaseTools.exportTableCsv(tableName, database, schema) };
  }

  async explainQuery(query, database) {
    return { content: await this.databaseTools.explainQuery(query, database) };
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
  }

  async getOptimizationInsights(database) {
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
  }

  // Configuration and utility methods
  printConfigurationSummary() {
    this.config.logConfiguration();
  }

  /**
   * Log configuration with SSL certificate information if available
   * @private
   */
  async _logConfigurationWithConnectionInfo() {
    // If SSL is enabled, try to connect first to get certificate info
    if (process.env.SQL_SERVER_ENCRYPT === 'true') {
      try {
        await this.connectionManager.connect();
        // Log with connection manager for SSL info
        this.config.logConfiguration(this.connectionManager);
      } catch (error) {
        // Connection failed, just log basic config
        this.config.logConfiguration();
        if (process.env.NODE_ENV !== 'test') {
          console.error(
            `Note: Could not establish connection for SSL certificate details: ${error.message}`
          );
        }
      }
    } else {
      // SSL not enabled, just log basic config
      this.config.logConfiguration();
    }
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
      console.error('SQL Server MCP server running on stdio');
    }
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new SqlServerMCP();
  server.run().catch(error => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

// Export the class for testing
export { SqlServerMCP };
