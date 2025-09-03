import { vi } from 'vitest';

/**
 * Modern Test Fixtures for New Modular Architecture
 *
 * These fixtures are designed to work with:
 * - Handler-based architecture (DatabaseToolsHandler, etc.)
 * - Dependency injection
 * - Proper mocking patterns
 * - Environment variable handling via vi.resetModules()
 */

// ============================================================================
// Mock Data
// ============================================================================

export const mockData = {
  databases: [
    {
      database_name: 'TestDB1',
      database_id: 5,
      create_date: '2024-01-01T00:00:00.000Z',
      collation_name: 'SQL_Latin1_General_CP1_CI_AS',
      state: 'ONLINE'
    },
    {
      database_name: 'TestDB2',
      database_id: 6,
      create_date: '2024-01-02T00:00:00.000Z',
      collation_name: 'SQL_Latin1_General_CP1_CI_AS',
      state: 'ONLINE'
    }
  ],

  tables: [
    {
      schema_name: 'dbo',
      table_name: 'Users',
      table_type: 'BASE TABLE'
    },
    {
      schema_name: 'dbo',
      table_name: 'Orders',
      table_type: 'BASE TABLE'
    }
  ],

  tableSchema: [
    {
      column_name: 'id',
      data_type: 'int',
      is_nullable: 'NO',
      column_default: null,
      max_length: null,
      precision: 10,
      scale: 0,
      is_primary_key: 'YES'
    },
    {
      column_name: 'name',
      data_type: 'varchar',
      is_nullable: 'YES',
      column_default: null,
      max_length: 100,
      precision: null,
      scale: null,
      is_primary_key: 'NO'
    }
  ],

  tableData: [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com' }
  ]
};

// ============================================================================
// Mock Database Components
// ============================================================================

export const createMockRequest = () => ({
  query: vi.fn().mockResolvedValue({
    recordset: [],
    recordsets: [[]],
    rowsAffected: [0]
  }),
  timeout: 30000
});

export const createMockPool = (mockRequest = createMockRequest()) => ({
  request: vi.fn(() => mockRequest),
  connected: true,
  close: vi.fn().mockResolvedValue()
});

export const createMockConnectionManager = (mockPool = createMockPool()) => ({
  connect: vi.fn().mockResolvedValue(mockPool),
  getPool: vi.fn().mockReturnValue(mockPool),
  isConnectionActive: vi.fn().mockReturnValue(true),
  close: vi.fn().mockResolvedValue(),
  getConnectionHealth: vi.fn().mockReturnValue({
    connected: true,
    status: 'Connected',
    pool: { size: 5, available: 3, pending: 0, borrowed: 2 }
  })
});

export const createMockPerformanceMonitor = () => ({
  recordQuery: vi.fn(),
  getStats: vi.fn().mockReturnValue({
    totalQueries: 100,
    avgDuration: 150.5,
    slowQueries: 5,
    errorRate: 0.02
  }),
  getQueryStats: vi.fn().mockReturnValue([]),
  getPoolStats: vi.fn().mockReturnValue({
    size: 5,
    available: 3,
    pending: 0,
    borrowed: 2
  }),
  reset: vi.fn()
});

// ============================================================================
// Environment Setup Utilities
// ============================================================================

const originalEnv = process.env;

export const createTestEnvironment = (customEnv = {}) => ({
  ...originalEnv,
  SQL_SERVER_HOST: 'localhost',
  SQL_SERVER_PORT: '1433',
  SQL_SERVER_DATABASE: 'master',
  SQL_SERVER_USER: 'testuser',
  SQL_SERVER_PASSWORD: 'testpass',
  NODE_ENV: 'test',
  ...customEnv
});

export const setupEnvironment = (customEnv = {}) => {
  process.env = createTestEnvironment(customEnv);
};

export const resetEnvironment = () => {
  process.env = originalEnv;
};

// ============================================================================
// Modern Server Creation Utilities
// ============================================================================

/**
 * Creates a properly mocked SqlServerMCP instance for testing
 * Uses the new architecture with dependency injection
 */
export const createMockMcpServer = async (envOverrides = {}, mocks = {}) => {
  // Set up environment
  setupEnvironment(envOverrides);

  // Clear module cache to pick up new environment variables
  vi.resetModules();

  // Default mocks
  const mockConnectionManager = mocks.connectionManager || createMockConnectionManager();
  const mockPerformanceMonitor = mocks.performanceMonitor || createMockPerformanceMonitor();

  // Mock the dependencies
  vi.doMock('../../lib/database/connection-manager.js', () => ({
    ConnectionManager: vi.fn().mockImplementation(() => mockConnectionManager)
  }));

  vi.doMock('../../lib/utils/performance-monitor.js', () => ({
    PerformanceMonitor: vi.fn().mockImplementation(() => mockPerformanceMonitor)
  }));

  // Import after mocking
  const { SqlServerMCP } = await import('../../index.js');
  const { serverConfig } = await import('../../lib/config/server-config.js');

  // Reload config to pick up environment changes
  serverConfig.reload();

  // Mock tool handlers setup to prevent actual MCP initialization
  vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
  vi.spyOn(serverConfig, 'logConfiguration').mockImplementation(() => {});

  const server = new SqlServerMCP();

  // Expose mocks for testing
  server.__mocks = {
    connectionManager: mockConnectionManager,
    performanceMonitor: mockPerformanceMonitor
  };

  return server;
};

// ============================================================================
// Handler Testing Utilities
// ============================================================================

/**
 * Creates a mock DatabaseToolsHandler for testing
 */
export const createMockDatabaseToolsHandler = (mockConnectionManager, mockPerformanceMonitor) => {
  const { DatabaseToolsHandler } = vi.importActual('../../lib/tools/handlers/database-tools.js');
  const handler = new DatabaseToolsHandler(mockConnectionManager, mockPerformanceMonitor);

  // Override executeQuery for testing
  handler.executeQuery = vi.fn().mockImplementation(async _query => {
    return { recordset: mockData.databases };
  });

  return handler;
};

// ============================================================================
// Response Validation Utilities
// ============================================================================

// These functions return objects for test files to validate against
// They don't use expect() directly to avoid global dependency issues
export const expectValidToolResponse = result => {
  if (!result || !Array.isArray(result) || result.length === 0) {
    throw new Error('Invalid tool response structure');
  }

  if (!result[0] || result[0].type !== 'text' || !result[0].text) {
    throw new Error('Invalid tool response content');
  }

  // Validate JSON structure
  const data = JSON.parse(result[0].text);
  if (!Object.prototype.hasOwnProperty.call(data, 'success')) {
    throw new Error('Response missing success property');
  }

  return data;
};

export const expectToolSuccess = (result, expectedData = {}) => {
  const data = expectValidToolResponse(result);
  if (!data.success) {
    throw new Error('Expected successful result but got failure');
  }

  // Simple property checking instead of expect.toMatchObject
  for (const [key, value] of Object.entries(expectedData)) {
    if (data[key] !== value) {
      throw new Error(`Expected ${key} to be ${value} but got ${data[key]}`);
    }
  }

  return data;
};

export const expectToolError = (result, expectedErrorMessage = null) => {
  const data = expectValidToolResponse(result);
  if (data.success) {
    throw new Error('Expected error result but got success');
  }

  if (!data.error) {
    throw new Error('Expected error property in failed result');
  }

  if (expectedErrorMessage && !data.error.message.includes(expectedErrorMessage)) {
    throw new Error(
      `Expected error message to contain '${expectedErrorMessage}' but got '${data.error.message}'`
    );
  }

  return data;
};

// ============================================================================
// Cleanup Utilities
// ============================================================================

export const cleanupMocks = () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetEnvironment();
};
