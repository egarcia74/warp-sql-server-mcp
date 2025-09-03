/**
 * Tool Registry - Centralized tool definitions and management
 */

// Database-related tools
const DATABASE_TOOLS = [
  {
    name: 'execute_query',
    description: 'Execute a SQL query on the connected SQL Server database',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The SQL query to execute' },
        database: { type: 'string', description: 'Optional: Database name to use for this query' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_databases',
    description: 'List all databases on the SQL Server instance',
    inputSchema: { type: 'object', properties: {} }
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
        schema: { type: 'string', description: 'Schema name (optional, defaults to dbo)' }
      }
    }
  },
  {
    name: 'describe_table',
    description: 'Get the schema information for a specific table',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table to describe' },
        database: { type: 'string', description: 'Database name (optional)' },
        schema: { type: 'string', description: 'Schema name (optional, defaults to dbo)' }
      },
      required: ['table_name']
    }
  },
  {
    name: 'list_foreign_keys',
    description: 'List all foreign key relationships in a schema',
    inputSchema: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database name (optional)' },
        schema: { type: 'string', description: 'Schema name (optional, defaults to dbo)' }
      }
    }
  }
];

// Data manipulation and export tools
const DATA_TOOLS = [
  {
    name: 'get_table_data',
    description: 'Get sample data from a table with optional filtering and limiting',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table' },
        database: { type: 'string', description: 'Database name (optional)' },
        schema: { type: 'string', description: 'Schema name (optional, defaults to dbo)' },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (optional, defaults to 100)'
        },
        where: { type: 'string', description: 'WHERE clause conditions (optional)' }
      },
      required: ['table_name']
    }
  },
  {
    name: 'export_table_csv',
    description: 'Export table data in CSV format',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table to export' },
        database: { type: 'string', description: 'Database name (optional)' },
        schema: { type: 'string', description: 'Schema name (optional, defaults to dbo)' },
        limit: { type: 'number', description: 'Maximum number of rows to export (optional)' },
        where: { type: 'string', description: 'WHERE clause conditions (optional)' }
      },
      required: ['table_name']
    }
  }
];

// Performance monitoring tools
const PERFORMANCE_TOOLS = [
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
        tool_filter: { type: 'string', description: 'Filter by specific MCP tool name (optional)' },
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
    inputSchema: { type: 'object', properties: {} }
  }
];

// Query analysis and optimization tools
const ANALYSIS_TOOLS = [
  {
    name: 'explain_query',
    description: 'Get the execution plan for a SQL query to analyze performance',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The SQL query to analyze' },
        database: { type: 'string', description: 'Optional: Database name to use for this query' },
        include_actual_plan: {
          type: 'boolean',
          description: 'Include actual execution statistics (optional, defaults to false)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'analyze_query_performance',
    description: 'Analyze query performance and provide optimization suggestions',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query to analyze for performance optimization' },
        database: { type: 'string', description: 'Database name (optional)' }
      },
      required: ['query']
    }
  }
];

const OPTIMIZATION_TOOLS = [
  {
    name: 'get_index_recommendations',
    description: 'Get index recommendations for database optimization',
    inputSchema: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database name (optional)' },
        schema: { type: 'string', description: 'Schema name (optional, defaults to dbo)' },
        limit: {
          type: 'number',
          description: 'Maximum number of recommendations to return (optional, defaults to 10)'
        },
        impact_threshold: {
          type: 'number',
          description: 'Minimum impact score threshold (0-100, optional)'
        }
      }
    }
  },
  {
    name: 'detect_query_bottlenecks',
    description: 'Detect and analyze query bottlenecks in the database',
    inputSchema: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database name (optional)' },
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
        database: { type: 'string', description: 'Database name (optional)' },
        analysis_period: {
          type: 'string',
          description:
            'Analysis time period: 24_HOURS, 7_DAYS, 30_DAYS (optional, defaults to 7_DAYS)',
          enum: ['24_HOURS', '7_DAYS', '30_DAYS']
        }
      }
    }
  }
];

// Export functions
export function getAllTools() {
  return [
    ...DATABASE_TOOLS,
    ...DATA_TOOLS,
    ...PERFORMANCE_TOOLS,
    ...ANALYSIS_TOOLS,
    ...OPTIMIZATION_TOOLS
  ];
}

export function getToolsByCategory() {
  return {
    database: DATABASE_TOOLS,
    data: DATA_TOOLS,
    performance: PERFORMANCE_TOOLS,
    analysis: ANALYSIS_TOOLS,
    optimization: OPTIMIZATION_TOOLS
  };
}

export function getTool(toolName) {
  return getAllTools().find(tool => tool.name === toolName) || null;
}
