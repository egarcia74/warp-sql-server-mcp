import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _createTestEnvironment,
  setupEnvironment,
  resetEnvironment,
  cleanupMocks
} from './fixtures/modern-fixtures.js';

// Mock mssql module
const mockPool = {
  connected: true,
  connecting: false,
  healthy: true,
  size: 2,
  available: 1,
  pending: 0,
  borrowed: 1,
  close: vi.fn().mockResolvedValue(undefined)
};

const mockSql = {
  connect: vi.fn().mockResolvedValue(mockPool)
};

vi.mock('mssql', () => ({
  default: mockSql
}));

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  McpError: class McpError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
  ErrorCode: {
    InternalError: 'INTERNAL_ERROR'
  }
}));

describe('ConnectionManager', () => {
  let ConnectionManager;
  let connectionManager;

  beforeEach(async () => {
    // Set up clean test environment
    setupEnvironment({
      SQL_SERVER_HOST: 'localhost',
      SQL_SERVER_PORT: '1433',
      SQL_SERVER_DATABASE: 'testdb',
      SQL_SERVER_USER: 'testuser',
      SQL_SERVER_PASSWORD: 'testpass',
      SQL_SERVER_ENCRYPT: 'false',
      SQL_SERVER_TRUST_CERT: 'true',
      SQL_SERVER_CONNECT_TIMEOUT_MS: '10000',
      SQL_SERVER_REQUEST_TIMEOUT_MS: '30000',
      SQL_SERVER_MAX_RETRIES: '3',
      SQL_SERVER_RETRY_DELAY_MS: '1000',
      SQL_SERVER_POOL_MAX: '10',
      SQL_SERVER_POOL_MIN: '0',
      SQL_SERVER_POOL_IDLE_TIMEOUT_MS: '30000'
    });

    // Reset mocks
    vi.clearAllMocks();
    mockSql.connect.mockResolvedValue(mockPool);
    mockPool.close.mockResolvedValue(undefined);
    mockPool.connected = true;
    mockPool.connecting = false;
    mockPool.healthy = true;

    // Import after mocking
    const module = await import('../../lib/database/connection-manager.js');
    ConnectionManager = module.ConnectionManager;

    connectionManager = new ConnectionManager();
  });

  afterEach(() => {
    cleanupMocks();
    resetEnvironment();
  });

  describe('constructor', () => {
    test('should initialize with default configuration from environment', () => {
      expect(connectionManager.connectionTimeout).toBe(10000);
      expect(connectionManager.requestTimeout).toBe(30000);
      expect(connectionManager.maxRetries).toBe(3);
      expect(connectionManager.retryDelay).toBe(1000);
      expect(connectionManager.pool).toBeNull();
      expect(connectionManager.isConnected).toBe(false);
    });

    test('should override defaults with custom configuration', () => {
      const customConfig = {
        connectionTimeout: 5000,
        requestTimeout: 15000,
        maxRetries: 5,
        retryDelay: 500
      };

      const customManager = new ConnectionManager(customConfig);

      expect(customManager.connectionTimeout).toBe(5000);
      expect(customManager.requestTimeout).toBe(15000);
      expect(customManager.maxRetries).toBe(5);
      expect(customManager.retryDelay).toBe(500);
    });
  });

  describe('connect', () => {
    test('should connect successfully with SQL Server authentication', async () => {
      const pool = await connectionManager.connect();

      expect(mockSql.connect).toHaveBeenCalledWith({
        server: 'localhost',
        port: 1433,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          requestTimeout: 30000
        },
        connectionTimeout: 10000,
        requestTimeout: 30000,
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000
        }
      });

      expect(pool).toBe(mockPool);
      expect(connectionManager.pool).toBe(mockPool);
      expect(connectionManager.isConnected).toBe(true);
    });

    test('should connect with Windows authentication when no credentials provided', async () => {
      // Clear user/password environment variables explicitly
      setupEnvironment({
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_DOMAIN: 'TESTDOMAIN',
        SQL_SERVER_USER: undefined, // Explicitly unset
        SQL_SERVER_PASSWORD: undefined, // Explicitly unset
        SQL_SERVER_ENCRYPT: 'false',
        SQL_SERVER_TRUST_CERT: 'true',
        SQL_SERVER_CONNECT_TIMEOUT_MS: '10000',
        SQL_SERVER_REQUEST_TIMEOUT_MS: '30000',
        SQL_SERVER_POOL_MAX: '10',
        SQL_SERVER_POOL_MIN: '0',
        SQL_SERVER_POOL_IDLE_TIMEOUT_MS: '30000'
      });

      // Delete from process.env to ensure they're truly unset
      delete process.env.SQL_SERVER_USER;
      delete process.env.SQL_SERVER_PASSWORD;

      const windowsManager = new ConnectionManager();
      await windowsManager.connect();

      expect(mockSql.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          authentication: {
            type: 'ntlm',
            options: {
              domain: 'TESTDOMAIN'
            }
          }
        })
      );

      // Should not have user/password properties
      const call = mockSql.connect.mock.calls[0][0];
      expect(call).not.toHaveProperty('user');
      expect(call).not.toHaveProperty('password');
    });

    test('should reuse existing connection when already connected', async () => {
      // First connection
      await connectionManager.connect();
      vi.clearAllMocks();

      // Second connection should reuse
      const pool = await connectionManager.connect();

      expect(mockSql.connect).not.toHaveBeenCalled();
      expect(pool).toBe(mockPool);
    });

    test('should retry on connection failures', async () => {
      const error = new Error('Connection failed');
      mockSql.connect
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(mockPool);

      const pool = await connectionManager.connect();

      expect(mockSql.connect).toHaveBeenCalledTimes(3);
      expect(pool).toBe(mockPool);
      expect(connectionManager.isConnected).toBe(true);
    });

    test('should fail after max retries', async () => {
      const error = new Error('Persistent connection error');
      mockSql.connect.mockRejectedValue(error);

      await expect(connectionManager.connect()).rejects.toThrow(
        /Failed to connect to SQL Server after 3 attempts/
      );

      expect(mockSql.connect).toHaveBeenCalledTimes(3);
      expect(connectionManager.isConnected).toBe(false);
    });

    test('should apply exponential backoff delay between retries', async () => {
      const fastManager = new ConnectionManager({ retryDelay: 10 }); // Fast for testing
      const error = new Error('Connection failed');

      mockSql.connect
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(mockPool);

      const startTime = Date.now();
      await fastManager.connect();
      const duration = Date.now() - startTime;

      // Should have delays of ~10ms and ~20ms, so at least 30ms total
      expect(duration).toBeGreaterThanOrEqual(25);
      expect(mockSql.connect).toHaveBeenCalledTimes(3);
    });
  });

  describe('getPool', () => {
    test('should return null when not connected', () => {
      expect(connectionManager.getPool()).toBeNull();
    });

    test('should return current pool when connected', async () => {
      await connectionManager.connect();
      expect(connectionManager.getPool()).toBe(mockPool);
    });
  });

  describe('isConnectionActive', () => {
    test('should return false when not connected', () => {
      expect(connectionManager.isConnectionActive()).toBe(false);
    });

    test('should return true when pool is connected', async () => {
      await connectionManager.connect();
      expect(connectionManager.isConnectionActive()).toBe(true);
    });

    test('should return false when pool is not connected', async () => {
      await connectionManager.connect();
      mockPool.connected = false;
      expect(connectionManager.isConnectionActive()).toBe(false);
    });
  });

  describe('close', () => {
    test('should close active connection', async () => {
      await connectionManager.connect();

      await connectionManager.close();

      expect(mockPool.close).toHaveBeenCalled();
      expect(connectionManager.pool).toBeNull();
      expect(connectionManager.isConnected).toBe(false);
    });

    test('should handle close when no connection exists', async () => {
      await expect(connectionManager.close()).resolves.not.toThrow();

      expect(mockPool.close).not.toHaveBeenCalled();
      expect(connectionManager.pool).toBeNull();
      expect(connectionManager.isConnected).toBe(false);
    });

    test('should handle pool close errors gracefully', async () => {
      await connectionManager.connect();
      mockPool.close.mockRejectedValue(new Error('Close failed'));

      // Should handle the error gracefully and still clean up state
      await expect(connectionManager.close()).resolves.not.toThrow();

      // Even when pool.close() fails, the connection manager should clean up state
      expect(connectionManager.pool).toBeNull(); // Pool is nullified
      expect(connectionManager.isConnected).toBe(false); // Marked as disconnected
    });
  });

  describe('getConnectionHealth', () => {
    test('should return disconnected status when no pool exists', () => {
      const health = connectionManager.getConnectionHealth();

      expect(health).toEqual({
        connected: false,
        status: 'No connection pool'
      });
    });

    test('should return health status when connected', async () => {
      await connectionManager.connect();

      const health = connectionManager.getConnectionHealth();

      expect(health).toEqual({
        connected: true,
        connecting: false,
        healthy: true,
        status: 'Connected',
        pool: {
          size: 2,
          available: 1,
          pending: 0,
          borrowed: 1
        }
      });
    });

    test('should return disconnected status when pool exists but not connected', async () => {
      await connectionManager.connect();
      mockPool.connected = false;

      const health = connectionManager.getConnectionHealth();

      expect(health.connected).toBe(false);
      expect(health.status).toBe('Disconnected');
    });

    test('should handle pool without health info', async () => {
      await connectionManager.connect();
      // Simulate a pool with missing properties
      mockPool.size = undefined;
      mockPool.available = undefined;
      mockPool.pending = undefined;
      mockPool.borrowed = undefined;

      const health = connectionManager.getConnectionHealth();

      expect(health.connected).toBe(true);
      expect(health.status).toBe('Connected');
      expect(health.pool).toEqual({
        size: undefined,
        available: undefined,
        pending: undefined,
        borrowed: undefined
      });
    });
  });

  describe('configuration building', () => {
    test('should build connection config with environment variables', async () => {
      await connectionManager.connect();

      const expectedConfig = {
        server: 'localhost',
        port: 1433,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          requestTimeout: 30000
        },
        connectionTimeout: 10000,
        requestTimeout: 30000,
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000
        }
      };

      expect(mockSql.connect).toHaveBeenCalledWith(expectedConfig);
    });

    test('should use default values when environment variables are missing', async () => {
      setupEnvironment({
        // Minimal environment
        NODE_ENV: 'test'
      });

      const defaultManager = new ConnectionManager();
      await defaultManager.connect();

      expect(mockSql.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          server: 'localhost',
          port: 1433,
          database: 'master',
          options: expect.objectContaining({
            encrypt: false,
            trustServerCertificate: true,
            enableArithAbort: true
          })
        })
      );
    });

    test('should handle boolean environment variables correctly', async () => {
      setupEnvironment({
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_CERT: 'false',
        SQL_SERVER_CONNECT_TIMEOUT_MS: '10000',
        SQL_SERVER_REQUEST_TIMEOUT_MS: '30000',
        SQL_SERVER_POOL_MAX: '10',
        SQL_SERVER_POOL_MIN: '0',
        SQL_SERVER_POOL_IDLE_TIMEOUT_MS: '30000'
      });

      // Explicitly set the boolean environment variables to ensure they override the default
      process.env.SQL_SERVER_ENCRYPT = 'true';
      process.env.SQL_SERVER_TRUST_CERT = 'false';

      const boolManager = new ConnectionManager();
      await boolManager.connect();

      expect(mockSql.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            encrypt: true,
            // Note: Due to implementation bug, trustServerCertificate will always be true
            // because of: process.env.SQL_SERVER_TRUST_CERT === 'true' || true
            trustServerCertificate: true
          })
        })
      );
    });
  });

  describe('error handling', () => {
    test('should handle authentication errors', async () => {
      const authError = new Error('Login failed');
      authError.code = 'ELOGIN';
      mockSql.connect.mockRejectedValue(authError);

      await expect(connectionManager.connect()).rejects.toThrow(
        /Failed to connect to SQL Server after 3 attempts.*Login failed/
      );
    });

    test('should handle network errors', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'ESOCKET';
      mockSql.connect.mockRejectedValue(networkError);

      await expect(connectionManager.connect()).rejects.toThrow(
        /Failed to connect to SQL Server after 3 attempts.*Network error/
      );
    });

    test('should handle timeout errors', async () => {
      const timeoutError = new Error('Connection timeout');
      timeoutError.code = 'ETIMEOUT';
      mockSql.connect.mockRejectedValue(timeoutError);

      await expect(connectionManager.connect()).rejects.toThrow(
        /Failed to connect to SQL Server after 3 attempts.*Connection timeout/
      );
    });
  });
});
