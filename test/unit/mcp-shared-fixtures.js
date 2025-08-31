import { vi } from 'vitest';

/**
 * Shared test fixtures and utilities for MCP test suite
 * This file contains common mocks, test data, and utilities used across multiple test files
 */

// Mock the mssql module first (must be hoisted)
export const setupMssqlMock = () => {
  vi.mock('mssql', () => ({
    default: {
      connect: vi.fn(),
      ConnectionPool: vi.fn()
    },
    connect: vi.fn(),
    ConnectionPool: vi.fn()
  }));
};

// Mock StdioServerTransport at the module level
export const mockStdioTransport = {
  connect: vi.fn()
};

export const setupStdioMock = () => {
  vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: vi.fn(() => mockStdioTransport)
  }));
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

// Mock objects for testing
export const mockRequest = {
  query: vi.fn(),
  timeout: 30000
};

export const mockPool = {
  request: vi.fn(() => mockRequest),
  connected: true
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
export const createMockMcpServer = (customConfig = {}) => {
  // Mock the setupToolHandlers to prevent actual MCP server initialization
  vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
  
  const { SqlServerMCP } = require('../../index.js');
  const server = new SqlServerMCP();
  server.pool = null; // Reset pool
  
  // Apply any custom configuration
  Object.assign(server, customConfig);
  
  return server;
};

export const resetMocks = () => {
  vi.clearAllMocks();
  mockPool.connected = true;
  mockRequest.query.mockResolvedValue({
    recordset: [],
    recordsets: [[]],
    rowsAffected: [0]
  });
};

export const setupDefaultMockResponses = () => {
  mockRequest.query.mockResolvedValue({
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
  sampleCsvOutput: 'id,name,email\n1,"John Doe","john@example.com"\n2,"Jane Smith","jane@example.com"',
  expectedCsvHeaders: ['id', 'name', 'email'],
  largeDataset: Array.from({ length: 1000 }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    data: `Sample data for user ${i + 1}`
  }))
};

// Query test cases
export const queryTestCases = {
  validQueries: {
    select: 'SELECT * FROM Users',
    selectWithWhere: 'SELECT id, name FROM Users WHERE active = 1',
    selectWithJoin: 'SELECT u.name, o.total FROM Users u JOIN Orders o ON u.id = o.user_id',
    cteQuery: 'WITH UserStats AS (SELECT COUNT(*) as total FROM Users) SELECT * FROM UserStats'
  },
  destructiveQueries: {
    insert: "INSERT INTO Users (name, email) VALUES ('Test', 'test@example.com')",
    update: "UPDATE Users SET name = 'Updated' WHERE id = 1",
    delete: 'DELETE FROM Users WHERE id = 1',
    truncate: 'TRUNCATE TABLE Users'
  },
  schemaQueries: {
    createTable: 'CREATE TABLE TestTable (id INT PRIMARY KEY, name VARCHAR(100))',
    dropTable: 'DROP TABLE TestTable',
    alterTable: 'ALTER TABLE Users ADD COLUMN phone VARCHAR(20)',
    createIndex: 'CREATE INDEX idx_name ON Users (name)'
  },
  dangerousQueries: {
    exec: 'EXEC sp_configure',
    multiStatement: "SELECT * FROM Users; DELETE FROM Users WHERE id = 1",
    sqlInjection: "'; DROP TABLE Users; --"
  }
};

// Tool result helpers
export const createToolResult = (success = true, data = {}, errorMessage = null) => {
  const baseResult = {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success,
        ...data,
        ...(errorMessage && !success ? { error: { message: errorMessage } } : {})
      })
    }]
  };
  
  return baseResult;
};

export const expectToolSuccess = (result, expectedData = {}) => {
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

// Mock server instance factory
export const createTestMcpServer = async (envOverrides = {}) => {
  setupTestEnvironment(envOverrides);
  
  // Import here to ensure mocks are in place
  const { SqlServerMCP } = await import('../../index.js');
  
  // Mock the setupToolHandlers to prevent actual MCP server initialization
  vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
  
  const server = new SqlServerMCP();
  server.pool = null; // Reset pool
  
  return server;
};

// Common test setup function
export const setupMcpTest = (envOverrides = {}) => {
  resetMocks();
  setupTestEnvironment(envOverrides);
  setupDefaultMockResponses();
};

// Performance monitoring mock setup
export const setupPerformanceMonitoringMocks = () => {
  mockRequest.query.mockImplementation((query) => {
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
