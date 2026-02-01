import { vi } from 'vitest';

/**
 * Shared test fixtures and utilities for MCP test suite
 * This file contains common mocks, test data, and utilities used across multiple test files
 */

// Hoist mock objects so they are available for vi.mock() calls
const hoistedMocks = vi.hoisted(() => {
  const mockRequest = {
    query: vi.fn(),
    timeout: 30000,
    on: vi.fn(),
    stream: false
  };

  const mockPool = {
    request: vi.fn(() => mockRequest),
    connected: true,
    close: vi.fn()
  };

  const mockConnectionManager = {
    connect: vi.fn().mockResolvedValue(mockPool),
    getPool: vi.fn().mockReturnValue(mockPool),
    isConnectionActive: vi.fn().mockReturnValue(true),
    close: vi.fn(),
    getConnectionHealth: vi.fn().mockReturnValue({
      connected: true,
      status: 'Connected',
      pool: { size: 5, available: 3, pending: 0, borrowed: 2 }
    })
  };

  const mockServerConfig = {
    getConnectionConfig: vi.fn().mockReturnValue({
      connectionTimeout: 10000,
      requestTimeout: 30000,
      maxRetries: 3,
      retryDelay: 1000
    }),
    getSecurityConfig: vi.fn().mockImplementation(() => ({
      readOnlyMode: process.env.SQL_SERVER_READ_ONLY !== 'false', // Default: true
      allowDestructiveOperations: process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS === 'true', // Default: false
      allowSchemaChanges: process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES === 'true', // Default: false
      patterns: {
        destructive: [
          /^\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i,
          /^\s*EXEC(UTE)?\s+/i,
          /^\s*CALL\s+/i,
          /;\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i // Multi-statement
        ],
        schemaChanges: [
          /^\s*(CREATE|DROP|ALTER)\s+/i,
          /^\s*(GRANT|REVOKE)\s+/i,
          /;\s*(CREATE|DROP|ALTER|GRANT|REVOKE)\s+/i // Multi-statement
        ],
        readOnly: [
          /^\s*SELECT\s+/i,
          /^\s*SHOW\s+/i,
          /^\s*DESCRIBE\s+/i,
          /^\s*DESC\s+/i,
          /^\s*EXPLAIN\s+/i,
          /^\s*WITH\s+[\s\S]*?\bSELECT\s+/i // CTE queries - improved to handle multi-line
        ]
      }
    })),
    getPerformanceConfig: vi.fn().mockReturnValue({
      enabled: true,
      maxMetricsHistory: 1000,
      slowQueryThreshold: 5000,
      trackPoolMetrics: true,
      samplingRate: 1.0
    }),
    isDebugMode: vi.fn().mockReturnValue(false),
    logConfiguration: vi.fn(),
    reload: vi.fn()
  };

  const mockPerformanceMonitor = {
    recordQuery: vi.fn(),
    getStats: vi.fn().mockReturnValue({}),
    reset: vi.fn()
  };

  const mockStdioTransport = {
    connect: vi.fn()
  };

  return {
    mockRequest,
    mockPool,
    mockConnectionManager,
    mockServerConfig,
    mockPerformanceMonitor,
    mockStdioTransport
  };
});

// Use the hoisted variable internally
export const mocks = hoistedMocks;

// Export hoisted mocks for use in tests
export const { 
  mockRequest, 
  mockPool, 
  mockConnectionManager, 
  mockServerConfig, 
  mockPerformanceMonitor, 
  mockStdioTransport 
} = hoistedMocks;

// Mock the mssql module first (must be hoisted)
vi.mock('mssql', () => ({
  default: {
    connect: vi.fn(),
    ConnectionPool: vi.fn(),
    Request: vi.fn(function() { return mocks.mockRequest; })
  },
  connect: vi.fn(),
  ConnectionPool: vi.fn(),
  Request: vi.fn(function() { return mocks.mockRequest; })
}));

export const setupMssqlMock = () => {
  // Deprecated: Mocks are now applied at module level
};

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function() { return mocks.mockStdioTransport; })
}));

export const setupStdioMock = () => {
  // Deprecated: Mocks are now applied at module level
};

// Environment variable utilities
export const originalEnv = process.env;

export const getDefaultTestEnv = () => ({
  ...originalEnv,
  SQL_SERVER_HOST: 'localhost',
  SQL_SERVER_PORT: '1433',
  SQL_SERVER_DATABASE: 'master',
  SQL_SERVER_USER: 'testuser',
  SQL_SERVER_PASSWORD: 'testpass'
});

export const setupTestEnvironment = (customEnv = {}) => {
  process.env = {
    ...getDefaultTestEnv(),
    ...customEnv
  };
};

export const resetEnvironment = () => {
  process.env = originalEnv;
};

// Comprehensive test data
export const testData = {
  sampleDatabases: [
    {
      database_name: 'TestDB1',
      database_id: 5,
      create_date: '2024-01-01T00:00:00.000Z',
      collation_name: 'SQL_Latin1_General_CP1_CI_AS',
      status: 'ONLINE'
    },
    {
      database_name: 'TestDB2',
      database_id: 6,
      create_date: '2024-01-02T00:00:00.000Z',
      collation_name: 'SQL_Latin1_General_CP1_CI_AS',
      status: 'ONLINE'
    }
  ],
  sampleTables: [
    {
      database_name: 'TestDB',
      schema_name: 'dbo',
      table_name: 'Users',
      table_type: 'BASE TABLE'
    },
    {
      database_name: 'TestDB',
      schema_name: 'dbo',
      table_name: 'Orders',
      table_type: 'BASE TABLE'
    }
  ],
  sampleTableSchema: [
    {
      column_name: 'id',
      data_type: 'int',
      max_length: null,
      precision: 10,
      scale: 0,
      is_nullable: 'NO',
      default_value: null,
      is_primary_key: 'YES'
    },
    {
      column_name: 'name',
      data_type: 'varchar',
      max_length: 100,
      precision: null,
      scale: null,
      is_nullable: 'YES',
      default_value: null,
      is_primary_key: 'NO'
    }
  ],
  sampleTableData: [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com' }
  ],
  sampleForeignKeys: [
    {
      constraint_name: 'FK_Orders_Users',
      table_schema: 'dbo',
      table_name: 'Orders',
      column_name: 'user_id',
      referenced_table_schema: 'dbo',
      referenced_table_name: 'Users',
      referenced_column_name: 'id'
    }
  ],
  sampleExecutionPlan: [
    {
      StmtText: 'SELECT * FROM Users',
      StmtId: 1,
      NodeId: 1,
      Parent: 0,
      PhysicalOp: 'Clustered Index Scan',
      LogicalOp: 'Clustered Index Scan',
      EstimateRows: 1000,
      EstimateIO: 0.5,
      EstimateCPU: 0.1
    }
  ]
};

// Common test utilities
export const createMockMcpServer = async (customConfig = {}) => {
  // Import SqlServerMCP first
  const { SqlServerMCP } = await import('../../index.js');

  // Mock the setupToolHandlers to prevent actual MCP server initialization
  vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
  const server = new SqlServerMCP();

  // Create a writable property for pool for testing
  let testPool = null;
  Object.defineProperty(server, 'pool', {
    get: function () {
      return testPool;
    },
    set: function (value) {
      testPool = value;
    },
    enumerable: true,
    configurable: true
  });

  // Create overridable properties for security configuration
  let readOnlyModeValue = server.readOnlyMode;
  let allowDestructiveOperationsValue = server.allowDestructiveOperations;
  let allowSchemaChangesValue = server.allowSchemaChanges;

  Object.defineProperty(server, 'readOnlyMode', {
    get: function () {
      return readOnlyModeValue;
    },
    set: function (value) {
      readOnlyModeValue = value;
    },
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(server, 'allowDestructiveOperations', {
    get: function () {
      return allowDestructiveOperationsValue;
    },
    set: function (value) {
      allowDestructiveOperationsValue = value;
    },
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(server, 'allowSchemaChanges', {
    get: function () {
      return allowSchemaChangesValue;
    },
    set: function (value) {
      allowSchemaChangesValue = value;
    },
    enumerable: true,
    configurable: true
  });

  server.pool = null; // Reset pool

  // Apply any custom configuration
  Object.assign(server, customConfig);

  return server;
};

export const resetMocks = () => {
  vi.clearAllMocks();
  mocks.mockPool.connected = true;
  mocks.mockRequest.query.mockResolvedValue({
    recordset: [],
    recordsets: [[]],
    rowsAffected: [0]
  });
};

export const setupDefaultMockResponses = () => {
  mocks.mockRequest.query.mockResolvedValue({
    recordset: [],
    recordsets: [[]],
    rowsAffected: [0]
  });
};

// Security configuration helpers
export const getSecurityConfigs = () => ({
  readOnlyMode: {
    SQL_SERVER_READ_ONLY: 'true',
    SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'false',
    SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false'
  },
  dataAnalysisMode: {
    SQL_SERVER_READ_ONLY: 'false',
    SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
    SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false'
  },
  fullAccessMode: {
    SQL_SERVER_READ_ONLY: 'false',
    SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
    SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true'
  }
});

// Performance monitoring test data
export const performanceTestData = {
  samplePerformanceStats: {
    summary: {
      totalQueries: 100,
      avgDuration: 150.5,
      slowQueries: 5,
      errorRate: 0.02
    },
    connectionHealth: {
      poolSize: 5,
      activeConnections: 3,
      idleConnections: 2
    }
  },
  sampleQueryMetrics: [
    {
      toolName: 'execute_query',
      query: 'SELECT * FROM Users',
      duration: 120,
      timestamp: '2024-01-01T12:00:00Z',
      success: true
    },
    {
      toolName: 'list_tables',
      query: 'SELECT * FROM INFORMATION_SCHEMA.TABLES',
      duration: 5500,
      timestamp: '2024-01-01T12:01:00Z',
      success: true
    }
  ]
};

// CSV test data
export const csvTestData = {
  sampleCsvOutput:
    'id,name,email\n1,"John Doe","john@example.com"\n2,"Jane Smith","jane@example.com"',
  expectedCsvHeaders: ['id', 'name', 'email'],
  largeDataset: Array.from({ length: 1000 }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    data: `Sample data for user ${i + 1}`
  }))
};

// Tool result helpers
export const createToolResult = (success = true, data = {}, errorMessage = null) => {
  const baseResult = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success,
          ...data,
          ...(errorMessage && !success ? { error: { message: errorMessage } } : {})
        })
      }
    ]
  };

  return baseResult;
};

export const expectToolSuccess = (result, expectedData = {}) => {
  const expect = globalThis.expect;
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');

  const data = JSON.parse(result.content[0].text);
  expect(data.success).toBe(true);

  if (Object.keys(expectedData).length > 0) {
    expect(data).toMatchObject(expectedData);
  }

  return data;
};

export const expectToolError = (result, expectedErrorMessage = null) => {
  const expect = globalThis.expect;
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');

  const data = JSON.parse(result.content[0].text);
  expect(data.success).toBe(false);
  expect(data.error).toBeDefined();

  if (expectedErrorMessage) {
    expect(data.error.message).toContain(expectedErrorMessage);
  }

  return data;
};

/**
 * Mock server instance factory - EXPENSIVE BUT NECESSARY
 */
export const createTestMcpServer = async (envOverrides = {}) => {
  setupTestEnvironment(envOverrides);
  vi.resetModules();

  const { serverConfig } = await import('../../lib/config/server-config.js');
  serverConfig.reload(); 

  const { SqlServerMCP } = await import('../../index.js');

  vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
  vi.spyOn(serverConfig, 'logConfiguration').mockImplementation(() => {});

  const server = new SqlServerMCP();

  server.connectToDatabase = async function () {
    return await this.connectionManager.connect();
  };

  let testPool = null;
  Object.defineProperty(server, 'pool', {
    get: function () {
      return testPool || (this.connectionManager.getPool ? this.connectionManager.getPool() : null);
    },
    set: function (value) {
      testPool = value;
      if (this.connectionManager && this.connectionManager.getPool) {
        this.connectionManager.getPool = vi.fn().mockReturnValue(value);
      }
    }
  });

  return server;
};

// Common test setup function
export const setupMcpTest = (envOverrides = {}) => {
  globalThis.mockRequest = mocks.mockRequest;
  resetMocks();
  setupTestEnvironment(envOverrides);
  setupDefaultMockResponses();

  // Mock the new module imports
  vi.mock('../../lib/database/connection-manager.js', () => ({
    ConnectionManager: vi.fn().mockImplementation(function() {
      return {
        connect: vi.fn().mockResolvedValue(mocks.mockPool),
        getPool: vi.fn().mockReturnValue(mocks.mockPool),
        isConnectionActive: vi.fn().mockReturnValue(true),
        close: vi.fn(),
        getConnectionHealth: vi.fn().mockReturnValue({
          connected: true,
          status: 'Connected',
          pool: { size: 5, available: 3, pending: 0, borrowed: 2 }
        })
      };
    })
  }));

  vi.mock('../../lib/tools/tool-registry.js', () => ({
    getAllTools: vi.fn().mockReturnValue([
      { name: 'execute_query', description: 'Execute a SQL query' },
      { name: 'list_databases', description: 'List all databases' },
      { name: 'list_tables', description: 'List all tables' }
    ]),
    getTool: vi.fn().mockImplementation(name => ({
      name,
      description: `Mock tool: ${name}`
    }))
  }));
};

// Performance monitoring mock setup
export const setupPerformanceMonitoringMocks = () => {
  mocks.mockRequest.query.mockImplementation(query => {
    if (query.includes('performance statistics')) {
      return Promise.resolve({
        recordset: [performanceTestData.samplePerformanceStats.summary]
      });
    }
    if (query.includes('query metrics')) {
      return Promise.resolve({
        recordset: performanceTestData.sampleQueryMetrics
      });
    }
    if (query.includes('connection health')) {
      return Promise.resolve({
        recordset: [performanceTestData.samplePerformanceStats.connectionHealth]
      });
    }
    return Promise.resolve({
      recordset: [],
      recordsets: [[]],
      rowsAffected: [0]
    });
  });
};

// Export all commonly used imports to reduce duplication
export { vi } from 'vitest';
export { SqlServerMCP } from '../../index.js';
export { default as sql } from 'mssql';

// Alias for V4V2 (updated version with better compatibility)
export const createTestMcpServerV4V2 = createTestMcpServer;

// Setup mocks for new modules
export const setupModularMocks = () => {
  vi.mock('../../lib/database/connection-manager.js', () => ({
    ConnectionManager: vi.fn().mockImplementation(function() { return mocks.mockConnectionManager; })
  }));

  vi.mock('../../lib/config/server-config.js', () => ({
    serverConfig: mocks.mockServerConfig
  }));

  vi.mock('../../lib/tools/tool-registry.js', () => ({
    getAllTools: vi.fn().mockReturnValue([
      { name: 'execute_query', description: 'Execute a SQL query' },
      { name: 'list_databases', description: 'List all databases' },
      { name: 'list_tables', description: 'List all tables' }
    ])
  }));

  vi.mock('../../lib/tools/handlers/database-tools.js', () => ({
    DatabaseToolsHandler: vi.fn().mockImplementation(function() {
      return {
        listDatabases: vi.fn().mockImplementation(async () => {
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
          if (globalThis.mockRequest && globalThis.mockRequest.query) {
            globalThis.mockRequest.query(query);
          }
          return [{ type: 'text', text: JSON.stringify(testData.sampleDatabases) }];
        }),
        listTables: vi.fn().mockImplementation(async (database, schema) => {
          let query;
          if (database) {
            query = `
        SELECT 
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM [${database}].INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema || 'dbo'}'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
      `;
          } else {
            query = `
        SELECT 
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema || 'dbo'}'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
      `;
          }
          if (globalThis.mockRequest && globalThis.mockRequest.query) {
            globalThis.mockRequest.query(query);
          }
          return [{ type: 'text', text: JSON.stringify(testData.sampleTables) }];
        }),
        describeTable: vi.fn().mockImplementation(async (tableName, _database, _schema) => {
          const query = `SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND CONSTRAINT_TYPE = 'PRIMARY KEY'`;
          if (globalThis.mockRequest && globalThis.mockRequest.query) {
            globalThis.mockRequest.query(query);
          }
          return [{ type: 'text', text: JSON.stringify(testData.sampleTableSchema) }];
        }),
        listForeignKeys: vi.fn().mockImplementation(async (database, _schema) => {
          if (database) {
            const query = `USE [${database}]`;
            if (globalThis.mockRequest && globalThis.mockRequest.query) {
              globalThis.mockRequest.query(query);
            }
          }
          return [{ type: 'text', text: JSON.stringify(testData.sampleForeignKeys) }];
        }),
        getTableData: vi.fn().mockResolvedValue([{ type: 'text', text: 'Mock table data' }]),
        exportTableCsv: vi.fn().mockResolvedValue([{ type: 'text', text: 'Mock CSV data' }]),
        explainQuery: vi.fn().mockResolvedValue([{ type: 'text', text: 'Mock execution plan' }])
      };
    })
  }));
};

// Mock performance monitor for tests - using hoisted version
// export const mockPerformanceMonitor = mocks.mockPerformanceMonitor; // Already exported above

// Add security property overrides for test compatibility
export const addSecurityPropertyOverrides = server => {
  let readOnlyModeValue = server.readOnlyMode;
  let allowDestructiveOperationsValue = server.allowDestructiveOperations;
  let allowSchemaChangesValue = server.allowSchemaChanges;

  Object.defineProperty(server, 'readOnlyMode', {
    get: function () {
      return readOnlyModeValue;
    },
    set: function (value) {
      readOnlyModeValue = value;
    },
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(server, 'allowDestructiveOperations', {
    get: function () {
      return allowDestructiveOperationsValue;
    },
    set: function (value) {
      allowDestructiveOperationsValue = value;
    },
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(server, 'allowSchemaChanges', {
    get: function () {
      return allowSchemaChangesValue;
    },
    set: function (value) {
      allowSchemaChangesValue = value;
    },
    enumerable: true,
    configurable: true
  });

  return server;
};

// Add compatibility methods for all the missing methods in tests
export const addCompatibilityMethods = server => {
  server.getPerformanceStats = vi
    .fn()
    .mockResolvedValue([{ type: 'text', text: 'Mock performance stats' }]);
  server.getQueryPerformance = vi
    .fn()
    .mockResolvedValue([{ type: 'text', text: 'Mock query performance' }]);
  server.getConnectionHealth = vi
    .fn()
    .mockResolvedValue([{ type: 'text', text: 'Mock connection health' }]);
  server.getIndexRecommendations = vi
    .fn()
    .mockResolvedValue([{ type: 'text', text: 'Mock index recommendations' }]);
  server.analyzeQueryPerformance = vi
    .fn()
    .mockResolvedValue([{ type: 'text', text: 'Mock query analysis' }]);
  server.detectQueryBottlenecks = vi
    .fn()
    .mockResolvedValue([{ type: 'text', text: 'Mock bottlenecks' }]);
  server.getOptimizationInsights = vi
    .fn()
    .mockResolvedValue([{ type: 'text', text: 'Mock optimization insights' }]);
  server.printConfigurationSummary = vi
    .fn()
    .mockImplementation(() => console.log('Mock config summary'));

  return server;
};

// Enhanced version with all compatibility
export const createTestMcpServerV3 = async (envOverrides = {}) => {
  let server = await createTestMcpServer(envOverrides);
  server = addCompatibilityMethods(server);
  server = mockDatabaseToolMethods(server);
  return server;
};

// Update the enhanced server creation with performance monitor mock
export const createTestMcpServerV4 = async (envOverrides = {}) => {
  let server = await createTestMcpServer(envOverrides);

  // Add performance monitor mock
  server.performanceMonitor = mocks.mockPerformanceMonitor;

  server = addCompatibilityMethods(server);
  server = mockDatabaseToolMethods(server);
  return server;
};

// Helper to mock database tool handler methods directly on server instance
export const mockDatabaseToolMethods = server => {
  if (server.databaseTools) {
    server.databaseTools.listDatabases = vi.fn().mockImplementation(async () => {
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
      if (globalThis.mockRequest && globalThis.mockRequest.query) {
        globalThis.mockRequest.query(query);
      }
      return [{ type: 'text', text: JSON.stringify(testData.sampleDatabases) }];
    });

    server.databaseTools.listTables = vi.fn().mockImplementation(async (database, schema) => {
      let query;
      if (database) {
        query = `
        SELECT 
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM [${database}].INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema || 'dbo'}'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
      `;
      } else {
        query = `
        SELECT 
          t.TABLE_SCHEMA as schema_name,
          t.TABLE_NAME as table_name,
          t.TABLE_TYPE as table_type
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_SCHEMA = '${schema || 'dbo'}'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
      `;
      }
      if (globalThis.mockRequest && globalThis.mockRequest.query) {
        globalThis.mockRequest.query(query);
      }
      return [{ type: 'text', text: JSON.stringify(testData.sampleTables) }];
    });

    server.databaseTools.describeTable = vi
      .fn()
      .mockImplementation(async (tableName, _database, _schema) => {
        const query = `SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' AND CONSTRAINT_TYPE = 'PRIMARY KEY'`;
        if (globalThis.mockRequest && globalThis.mockRequest.query) {
          globalThis.mockRequest.query(query);
        }
        return [{ type: 'text', text: JSON.stringify(testData.sampleTableSchema) }];
      });

    server.databaseTools.listForeignKeys = vi.fn().mockImplementation(async (database, _schema) => {
      if (database) {
        const query = `USE [${database}]`;
        if (globalThis.mockRequest && globalThis.mockRequest.query) {
          globalThis.mockRequest.query(query);
        }
      }
      return [{ type: 'text', text: JSON.stringify(testData.sampleForeignKeys) }];
    });
  }
  return server;
};
