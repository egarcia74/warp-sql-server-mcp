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
    description: 'Get sample data from a table with optional row limiting and offset',
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
        offset: {
          type: 'number',
          description: 'Number of rows to skip before returning data (optional, defaults to 0)'
        }
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
        limit: { type: 'number', description: 'Maximum number of rows to export (optional)' }
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
      properties: {}
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
        database: {
          type: 'string',
          description: 'Database name (optional)'
        }
      }
    }
  },
  {
    name: 'get_server_info',
    description: 'Get MCP server configuration, status, and logging information',
    inputSchema: {
      type: 'object',
      properties: {
        include_logs: {
          type: 'boolean',
          description: 'Include recent log entries (optional, defaults to false)'
        }
      }
    }
  }
];

// Connection tool
const CONNECTION_TOOLS = [];

export function getAllTools() {
  return [
    ...DATABASE_TOOLS,
    ...DATA_TOOLS,
    ...PERFORMANCE_TOOLS,
    ...ANALYSIS_TOOLS,
    ...OPTIMIZATION_TOOLS,
    ...CONNECTION_TOOLS
  ];
}

export function getToolsByCategory() {
  return {
    database: DATABASE_TOOLS,
    data: DATA_TOOLS,
    performance: PERFORMANCE_TOOLS,
    analysis: ANALYSIS_TOOLS,
    optimization: OPTIMIZATION_TOOLS,
    connection: CONNECTION_TOOLS
  };
}

export function getTool(toolName) {
  return getAllTools().find(tool => tool.name === toolName) || null;
}
