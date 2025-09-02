import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupEnvironment,
  _resetEnvironment,
  createMockPool,
  cleanupMocks
} from './fixtures/modern-fixtures.js';

// Mock mssql module
vi.mock('mssql', () => ({
  default: {
    connect: vi.fn(),
    ConnectionPool: vi.fn()
  },
  connect: vi.fn()
}));

describe('ConnectionManager', () => {
  let connectionManager;
  let mockSql;
  let mockPool;
  let mockConfig;

  beforeEach(async () => {
    setupEnvironment({
      SQL_SERVER_HOST: 'localhost',
      SQL_SERVER_PORT: '1433',
      SQL_SERVER_DATABASE: 'testdb',
      SQL_SERVER_USER: 'testuser',
      SQL_SERVER_PASSWORD: 'testpass'
    });

    // Reset modules to pick up environment changes
    vi.resetModules();

    mockPool = createMockPool();
    mockSql = await import('mssql');
    mockSql.default.connect.mockResolvedValue(mockPool);

    mockConfig = {
      connectionTimeout: 10000,
      requestTimeout: 30000,
      maxRetries: 3,
      retryDelay: 1000
    };

    const { ConnectionManager } = await import('../../lib/database/connection-manager.js');
    connectionManager = new ConnectionManager(mockConfig);
  });

  afterEach(() => {
    cleanupMocks();
  });

  describe('connect', () => {
    test('should connect successfully with SQL Server authentication', async () => {
      const pool = await connectionManager.connect();

      expect(mockSql.default.connect).toHaveBeenCalledWith({
        server: 'localhost',
        port: 1433,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          requestTimeout: 30000,
          connectionTimeout: 10000
        }
      });

      expect(pool).toBe(mockPool);
      expect(connectionManager.getPool()).toBe(mockPool);
    });

    test('should connect with Windows authentication when no credentials provided', async () => {
      setupEnvironment({
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_USER: '',
        SQL_SERVER_PASSWORD: '',
        SQL_SERVER_DOMAIN: 'TESTDOMAIN'
      });

      vi.resetModules();
      const { ConnectionManager } = await import('../../lib/database/connection-manager.js');
      connectionManager = new ConnectionManager(mockConfig);

      await connectionManager.connect();

      expect(mockSql.default.connect).toHaveBeenCalledWith({
        server: 'localhost',
        port: 1433,
        database: 'testdb',
        authentication: {
          type: 'ntlm',
          options: {
            domain: 'TESTDOMAIN'
          }
        },
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          requestTimeout: 30000,
          connectionTimeout: 10000
        }
      });
    });

    test('should reuse existing connection when already connected', async () => {
      // First connection
      const pool1 = await connectionManager.connect();

      // Second connection should reuse the same pool
      const pool2 = await connectionManager.connect();

      expect(mockSql.default.connect).toHaveBeenCalledTimes(1);
      expect(pool1).toBe(pool2);
    });

    test('should handle connection timeout', async () => {
      const timeoutError = new Error('Connection timeout');
      timeoutError.code = 'ETIMEOUT';
      mockSql.default.connect.mockRejectedValue(timeoutError);

      await expect(connectionManager.connect()).rejects.toThrow(
        'Failed to connect to SQL Server after 3 attempts: Connection timeout'
      );

      expect(mockSql.default.connect).toHaveBeenCalledTimes(3);
    });

    test('should handle authentication failures', async () => {
      const authError = new Error('Login failed');
      authError.code = 'ELOGIN';
      mockSql.default.connect.mockRejectedValue(authError);

      await expect(connectionManager.connect()).rejects.toThrow(
        'Failed to connect to SQL Server after 3 attempts: Login failed'
      );
    });

    test('should handle server not found errors', async () => {
      const serverError = new Error('Server not found');
      serverError.code = 'ENOTFOUND';
      mockSql.default.connect.mockRejectedValue(serverError);

      await expect(connectionManager.connect()).rejects.toThrow(
        'Failed to connect to SQL Server after 3 attempts: Server not found'
      );
    });

    test('should retry on transient failures', async () => {
      const transientError = new Error('Connection lost');
      transientError.code = 'ECONNRESET';

      // Fail twice, then succeed
      mockSql.default.connect
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(mockPool);

      const pool = await connectionManager.connect();

      expect(mockSql.default.connect).toHaveBeenCalledTimes(3);
      expect(pool).toBe(mockPool);
    });

    test('should not retry on non-transient failures', async () => {
      const authError = new Error('Invalid credentials');
      authError.code = 'ELOGIN';
      mockSql.default.connect.mockRejectedValue(authError);

      await expect(connectionManager.connect()).rejects.toThrow();

      // Should fail immediately without retries for auth errors
      expect(mockSql.default.connect).toHaveBeenCalledTimes(1);
    });

    test('should apply retry delay between attempts', async () => {
      const { ConnectionManager } = await import('../../lib/database/connection-manager.js');
      const connectionManager = new ConnectionManager({
        ...mockConfig,
        retryDelay: 50 // Use shorter delay for testing
      });

      const transientError = new Error('Connection lost');
      transientError.code = 'ECONNRESET';
      mockSql.default.connect.mockRejectedValue(transientError);

      const startTime = Date.now();

      try {
        await connectionManager.connect();
      } catch {
        // Expected to fail
      }

      const duration = Date.now() - startTime;

      // Should have taken at least 100ms (2 retries * 50ms delay)
      expect(duration).toBeGreaterThanOrEqual(90); // Allow some variance
      expect(mockSql.default.connect).toHaveBeenCalledTimes(3);
    });
  });

  describe('getPool', () => {
    test('should return current pool when connected', async () => {
      await connectionManager.connect();

      const pool = connectionManager.getPool();
      expect(pool).toBe(mockPool);
    });

    test('should return null when not connected', () => {
      const pool = connectionManager.getPool();
      expect(pool).toBeNull();
    });
  });

  describe('isConnectionActive', () => {
    test('should return true when pool is connected', async () => {
      await connectionManager.connect();

      expect(connectionManager.isConnectionActive()).toBe(true);
    });

    test('should return false when pool is not connected', async () => {
      await connectionManager.connect();
      mockPool.connected = false;

      expect(connectionManager.isConnectionActive()).toBe(false);
    });

    test('should return false when no pool exists', () => {
      expect(connectionManager.isConnectionActive()).toBe(false);
    });
  });

  describe('close', () => {
    test('should close active connection', async () => {
      await connectionManager.connect();

      await connectionManager.close();

      expect(mockPool.close).toHaveBeenCalled();
      expect(connectionManager.getPool()).toBeNull();
    });

    test('should handle close when no connection exists', async () => {
      // Should not throw when closing non-existent connection
      await expect(connectionManager.close()).resolves.not.toThrow();
    });

    test('should handle pool close errors gracefully', async () => {
      await connectionManager.connect();
      mockPool.close.mockRejectedValue(new Error('Close failed'));

      // Should not throw even if close fails
      await expect(connectionManager.close()).resolves.not.toThrow();
      expect(connectionManager.getPool()).toBeNull();
    });
  });

  describe('getConnectionHealth', () => {
    test('should return health status when connected', async () => {
      await connectionManager.connect();

      const health = connectionManager.getConnectionHealth();

      expect(health).toEqual({
        connected: true,
        status: 'Connected',
        pool: {
          size: expect.any(Number),
          available: expect.any(Number),
          pending: expect.any(Number),
          borrowed: expect.any(Number)
        }
      });
    });

    test('should return disconnected status when not connected', () => {
      const health = connectionManager.getConnectionHealth();

      expect(health).toEqual({
        connected: false,
        status: 'Disconnected',
        pool: null
      });
    });

    test('should handle pool without health info', async () => {
      // Create pool without health properties
      const simplePool = {
        connected: true,
        close: vi.fn()
      };
      mockSql.default.connect.mockResolvedValue(simplePool);

      await connectionManager.connect();

      const health = connectionManager.getConnectionHealth();

      expect(health.connected).toBe(true);
      expect(health.status).toBe('Connected');
      expect(health.pool).toEqual({
        size: 0,
        available: 0,
        pending: 0,
        borrowed: 0
      });
    });
  });

  describe('configuration handling', () => {
    test('should use default configuration when no config provided', async () => {
      const { ConnectionManager } = await import('../../lib/database/connection-manager.js');
      const defaultConnectionManager = new ConnectionManager();

      await defaultConnectionManager.connect();

      expect(mockSql.default.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            requestTimeout: 30000,
            connectionTimeout: 15000
          })
        })
      );
    });

    test('should merge custom config with defaults', async () => {
      const customConfig = {
        connectionTimeout: 5000,
        requestTimeout: 10000
      };

      const { ConnectionManager } = await import('../../lib/database/connection-manager.js');
      const customConnectionManager = new ConnectionManager(customConfig);

      await customConnectionManager.connect();

      expect(mockSql.default.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            requestTimeout: 10000,
            connectionTimeout: 5000
          })
        })
      );
    });
  });
});
