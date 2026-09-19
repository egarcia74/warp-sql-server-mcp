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

  describe('connect characterization', () => {
    let stderr;
    let stdout;
    let timer;

    beforeEach(() => {
      vi.useFakeTimers();
      mockSql.connect.mockReset().mockResolvedValue(mockPool);
      stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
      timer = vi.spyOn(globalThis, 'setTimeout');
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    test('reuses a connected pool without configuration, logging, or state normalization', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SQL_SERVER_DEBUG = 'true';
      connectionManager.pool = mockPool;
      connectionManager.isConnected = false;
      const build = vi.spyOn(connectionManager, '_buildConnectionConfig');

      await expect(connectionManager.connect()).resolves.toBe(mockPool);

      expect(build).not.toHaveBeenCalled();
      expect(mockSql.connect).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
      expect(connectionManager.isConnected).toBe(false);
    });

    test('replaces a disconnected pool only after immediate success without a delay', async () => {
      const previous = { connected: false };
      connectionManager.pool = previous;
      const pending = connectionManager.connect();
      expect(connectionManager.pool).toBe(previous);
      expect(connectionManager.isConnected).toBe(false);
      await expect(pending).resolves.toBe(mockPool);
      expect(connectionManager.pool).toBe(mockPool);
      expect(connectionManager.isConnected).toBe(true);
      expect(mockSql.connect).toHaveBeenCalledTimes(1);
      expect(timer).not.toHaveBeenCalled();
    });

    test('waits exactly 1000 then 2000 milliseconds and builds one configuration with fresh shallow copies', async () => {
      const build = vi.spyOn(connectionManager, '_buildConnectionConfig');
      mockSql.connect
        .mockRejectedValueOnce(new Error('first'))
        .mockRejectedValueOnce(new Error('second'));
      const pending = connectionManager.connect();
      await vi.advanceTimersByTimeAsync(999);
      expect(mockSql.connect).toHaveBeenCalledTimes(1);
      expect(connectionManager.pool).toBeNull();
      expect(connectionManager.isConnected).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockSql.connect).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(mockSql.connect).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe(mockPool);
      expect(timer.mock.calls.map(([, delay]) => delay)).toEqual([1000, 2000]);
      expect(vi.getTimerCount()).toBe(0);
      expect(build).toHaveBeenCalledTimes(1);
      expect(build.mock.contexts[0]).toBe(connectionManager);
      const configs = mockSql.connect.mock.calls.map(([config]) => config);
      expect(configs).toHaveLength(3);
      expect(configs[0]).not.toBe(configs[1]);
      expect(configs[1]).not.toBe(configs[2]);
      expect(configs[0]).toEqual(configs[2]);
      expect(configs[0].options).toBe(configs[2].options);
      expect(connectionManager.isConnected).toBe(true);
    });

    test('exhausts four attempts with no final delay and preserves existing state', async () => {
      connectionManager.maxRetries = 4;
      connectionManager.retryDelay = 7;
      const previous = { connected: false };
      connectionManager.pool = previous;
      connectionManager.isConnected = true;
      mockSql.connect.mockRejectedValue(new Error('last failure'));
      const outcome = connectionManager.connect().catch(error => error);
      await vi.runAllTimersAsync();
      expect(await outcome).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Failed to connect to SQL Server after 4 attempts: last failure'
      });
      expect(mockSql.connect).toHaveBeenCalledTimes(4);
      expect(timer.mock.calls.map(([, delay]) => delay)).toEqual([7, 14, 28]);
      expect(vi.getTimerCount()).toBe(0);
      expect(connectionManager.pool).toBe(previous);
      expect(connectionManager.isConnected).toBe(true);
    });

    test('does not delay a single exhausted attempt', async () => {
      connectionManager.maxRetries = 1;
      mockSql.connect.mockRejectedValue(new Error('only failure'));
      await expect(connectionManager.connect()).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Failed to connect to SQL Server after 1 attempts: only failure'
      });
      expect(timer).not.toHaveBeenCalled();
      expect(connectionManager.pool).toBeNull();
      expect(connectionManager.isConnected).toBe(false);
    });

    test('retains Unknown error when the retry loop does not run', async () => {
      connectionManager.maxRetries = 0;
      await expect(connectionManager.connect()).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Failed to connect to SQL Server after 0 attempts: Unknown error'
      });
      expect(mockSql.connect).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
    });

    test.each([
      ['test', 'true', []],
      ['production', 'false', []],
      ['production', 'TRUE', []],
      ['production', undefined, []],
      [
        'production',
        'true',
        [
          ['Establishing new database connection...'],
          ['Connection attempt 1 failed: first'],
          ['Connected to SQL Server successfully (attempt 2)']
        ]
      ]
    ])('preserves debug output for NODE_ENV=%s and DEBUG=%s', async (nodeEnv, debug, logs) => {
      process.env.NODE_ENV = nodeEnv;
      if (debug === undefined) delete process.env.SQL_SERVER_DEBUG;
      else process.env.SQL_SERVER_DEBUG = debug;
      mockSql.connect.mockRejectedValueOnce(new Error('first'));
      const pending = connectionManager.connect();
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe(mockPool);
      expect(stderr.mock.calls).toEqual(logs);
      expect(stdout).not.toHaveBeenCalled();
    });

    test('does not read a failure message for disabled debug before a successful retry', async () => {
      const message = vi.fn(() => 'unused');
      mockSql.connect.mockRejectedValueOnce({
        get message() {
          return message();
        }
      });
      const pending = connectionManager.connect();
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe(mockPool);
      expect(message).not.toHaveBeenCalled();
    });

    test('rechecks debug conditions after the connection attempt', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SQL_SERVER_DEBUG = 'false';
      mockSql.connect.mockImplementationOnce(async () => {
        process.env.SQL_SERVER_DEBUG = 'true';
        return mockPool;
      });
      await connectionManager.connect();
      expect(stderr.mock.calls).toEqual([['Connected to SQL Server successfully (attempt 1)']]);
    });

    test('propagates configuration failures without retry or wrapping', async () => {
      const failure = new Error('bad configuration');
      vi.spyOn(connectionManager, '_buildConnectionConfig').mockImplementation(() => {
        throw failure;
      });
      await expect(connectionManager.connect()).rejects.toBe(failure);
      expect(mockSql.connect).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
    });

    test('propagates initial debug logging failures outside the retry boundary', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SQL_SERVER_DEBUG = 'true';
      const failure = new Error('stderr unavailable');
      stderr.mockImplementationOnce(() => {
        throw failure;
      });
      await expect(connectionManager.connect()).rejects.toBe(failure);
      expect(mockSql.connect).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
    });

    test('catches success logging failures after the pool state transition', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SQL_SERVER_DEBUG = 'true';
      connectionManager.maxRetries = 1;
      stderr
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error('success log failed');
        });
      await expect(connectionManager.connect()).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Failed to connect to SQL Server after 1 attempts: success log failed'
      });
      expect(connectionManager.pool).toBe(mockPool);
      expect(connectionManager.isConnected).toBe(true);
      expect(stderr).toHaveBeenLastCalledWith('Connection attempt 1 failed: success log failed');
      expect(timer).not.toHaveBeenCalled();
    });

    test('propagates failure logging errors without scheduling another attempt', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SQL_SERVER_DEBUG = 'true';
      const failure = new Error('failure log failed');
      mockSql.connect.mockRejectedValue(new Error('connection failed'));
      stderr
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw failure;
        });
      await expect(connectionManager.connect()).rejects.toBe(failure);
      expect(mockSql.connect).toHaveBeenCalledTimes(1);
      expect(timer).not.toHaveBeenCalled();
    });

    test('propagates retry scheduling errors without wrapping or another attempt', async () => {
      const failure = new Error('timer failed');
      timer.mockImplementationOnce(() => {
        throw failure;
      });
      mockSql.connect.mockRejectedValue(new Error('connection failed'));
      await expect(connectionManager.connect()).rejects.toBe(failure);
      expect(mockSql.connect).toHaveBeenCalledTimes(1);
      expect(connectionManager.isConnected).toBe(false);
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

    test('should expose the pool capacity from the tarn pool, falling back to the configured max', async () => {
      await connectionManager.connect();
      try {
        // mssql exposes the resolved tarn pool as `pool.pool`
        mockPool.pool = { max: 10 };
        mockPool.config = { pool: { max: 7 } };
        expect(connectionManager.getConnectionHealth().pool.max).toBe(10);

        delete mockPool.pool;
        expect(connectionManager.getConnectionHealth().pool.max).toBe(7);

        delete mockPool.config;
        expect(connectionManager.getConnectionHealth().pool.max).toBeUndefined();
      } finally {
        delete mockPool.pool;
        delete mockPool.config;
      }
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
            encrypt: true,
            trustServerCertificate: true, // Now true for development environments (NODE_ENV=test)
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
            // Now correctly respects SQL_SERVER_TRUST_CERT='false' setting
            trustServerCertificate: false
          })
        })
      );
    });
  });

  describe('SSL configuration and display', () => {
    test('should extract SSL info correctly when encryption is enabled', async () => {
      setupEnvironment({
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_CERT: 'false'
      });

      const sslManager = new ConnectionManager();
      await sslManager.connect();

      const health = sslManager.getConnectionHealth();

      expect(health.ssl).toEqual({
        enabled: true,
        encrypt: true,
        trust_server_certificate: false,
        connection_status: 'Encrypted connection established',
        server: 'localhost:1433',
        protocol: 'TLS/SSL',
        note: 'Certificate details not available through mssql library abstraction'
      });
    });

    test('should extract SSL info with trust certificate enabled', async () => {
      setupEnvironment({
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass',
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_CERT: 'true'
      });

      const sslManager = new ConnectionManager();
      await sslManager.connect();

      const health = sslManager.getConnectionHealth();

      expect(health.ssl).toEqual({
        enabled: true,
        encrypt: true,
        trust_server_certificate: true,
        connection_status: 'Encrypted connection established',
        server: 'localhost:1433',
        protocol: 'TLS/SSL',
        note: 'Certificate details not available through mssql library abstraction'
      });
    });

    test('should not include SSL info when encryption is disabled', async () => {
      setupEnvironment({
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass',
        SQL_SERVER_ENCRYPT: 'false',
        SQL_SERVER_TRUST_CERT: 'true'
      });

      const noSslManager = new ConnectionManager();
      await noSslManager.connect();

      const health = noSslManager.getConnectionHealth();

      expect(health.ssl).toBeUndefined();
    });

    test('should handle SSL info extraction when not connected', () => {
      const health = connectionManager.getConnectionHealth();
      expect(health.ssl).toBeUndefined();
    });

    test('should verify SSL configuration consistency between settings and health', async () => {
      // Test scenario 1: Secure production config (encrypt=true, trust=false)
      setupEnvironment({
        SQL_SERVER_ENCRYPT: 'true',
        SQL_SERVER_TRUST_CERT: 'false'
      });

      const secureManager = new ConnectionManager();
      await secureManager.connect();

      const connectionConfig = secureManager._buildConnectionConfig();
      const health = secureManager.getConnectionHealth();

      // Verify consistency between connection config and SSL health info
      expect(connectionConfig.options.encrypt).toBe(health.ssl.encrypt);
      expect(connectionConfig.options.trustServerCertificate).toBe(
        health.ssl.trust_server_certificate
      );
      expect(connectionConfig.options.encrypt).toBe(true);
      expect(connectionConfig.options.trustServerCertificate).toBe(false);

      // Test scenario 2: Development config (encrypt=false, trust=true)
      setupEnvironment({
        SQL_SERVER_ENCRYPT: 'false',
        SQL_SERVER_TRUST_CERT: 'true'
      });

      const devManager = new ConnectionManager();
      await devManager.connect();

      const devConfig = devManager._buildConnectionConfig();
      const devHealth = devManager.getConnectionHealth();

      expect(devConfig.options.encrypt).toBe(false);
      expect(devConfig.options.trustServerCertificate).toBe(true);
      // SSL info should not be present when encryption is disabled
      expect(devHealth.ssl).toBeUndefined();
    });

    test('should detect development environments correctly', () => {
      const baseTestEnv = {
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass'
      };

      const testCases = [
        // Development indicators
        {
          env: { ...baseTestEnv, NODE_ENV: 'development' },
          expected: true,
          desc: 'NODE_ENV=development'
        },
        { env: { ...baseTestEnv, NODE_ENV: 'test' }, expected: true, desc: 'NODE_ENV=test' },
        {
          env: { ...baseTestEnv, SQL_SERVER_HOST: 'localhost' },
          expected: true,
          desc: 'localhost'
        },
        {
          env: { ...baseTestEnv, SQL_SERVER_HOST: '127.0.0.1' },
          expected: true,
          desc: '127.0.0.1'
        },
        {
          env: { ...baseTestEnv, SQL_SERVER_HOST: 'db.local' },
          expected: true,
          desc: '.local domain'
        },
        {
          env: { ...baseTestEnv, SQL_SERVER_HOST: '192.168.1.10' },
          expected: true,
          desc: '192.168.x.x'
        },
        { env: { ...baseTestEnv, SQL_SERVER_HOST: '10.0.0.5' }, expected: true, desc: '10.x.x.x' },
        {
          env: { ...baseTestEnv, SQL_SERVER_HOST: '172.16.0.1' },
          expected: true,
          desc: '172.16-31.x.x'
        },
        {
          env: { ...baseTestEnv, SQL_SERVER_HOST: '172.31.255.255' },
          expected: true,
          desc: '172.16-31.x.x boundary'
        },

        // Production indicators
        {
          env: { ...baseTestEnv, NODE_ENV: 'production', SQL_SERVER_HOST: 'prod.company.com' },
          expected: false,
          desc: 'NODE_ENV=production with domain'
        },
        {
          env: { ...baseTestEnv, NODE_ENV: 'production', SQL_SERVER_HOST: 'db.company.com' },
          expected: false,
          desc: 'public domain'
        },
        {
          env: { ...baseTestEnv, NODE_ENV: 'production', SQL_SERVER_HOST: '203.0.113.10' },
          expected: false,
          desc: 'public IP'
        },
        {
          env: { ...baseTestEnv, NODE_ENV: 'production', SQL_SERVER_HOST: '172.15.0.1' },
          expected: false,
          desc: 'public 172.x range'
        },
        {
          env: { ...baseTestEnv, NODE_ENV: 'production', SQL_SERVER_HOST: '172.32.0.1' },
          expected: false,
          desc: 'public 172.x range'
        }
      ];

      testCases.forEach(testCase => {
        setupEnvironment(testCase.env);
        const manager = new ConnectionManager();
        expect(manager._isLikelyDevEnvironment()).toBe(
          testCase.expected,
          `Failed for ${testCase.desc}: expected ${testCase.expected}`
        );
      });
    });

    test('should use context-aware SSL certificate defaults', () => {
      const baseTestEnv = {
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'testdb',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass'
      };

      const testCases = [
        // Explicit settings (should override environment detection)
        {
          env: {
            ...baseTestEnv,
            SQL_SERVER_TRUST_CERT: 'true',
            NODE_ENV: 'production',
            SQL_SERVER_HOST: 'prod.company.com'
          },
          expected: true,
          desc: 'explicit true overrides production detection'
        },
        {
          env: { ...baseTestEnv, SQL_SERVER_TRUST_CERT: 'false', NODE_ENV: 'development' },
          expected: false,
          desc: 'explicit false overrides development detection'
        },

        // Environment-based defaults
        {
          env: { ...baseTestEnv, NODE_ENV: 'development' },
          expected: true,
          desc: 'development environment auto-trusts certificates'
        },
        {
          env: { ...baseTestEnv, NODE_ENV: 'production', SQL_SERVER_HOST: 'prod.company.com' },
          expected: false,
          desc: 'production environment requires valid certificates'
        },
        {
          env: { ...baseTestEnv, SQL_SERVER_HOST: 'localhost' },
          expected: true,
          desc: 'localhost auto-trusts certificates'
        },
        {
          env: { ...baseTestEnv, NODE_ENV: 'production', SQL_SERVER_HOST: 'db.company.com' },
          expected: false,
          desc: 'public domain requires valid certificates'
        }
      ];

      testCases.forEach(testCase => {
        setupEnvironment(testCase.env);
        const manager = new ConnectionManager();
        const config = manager._buildConnectionConfig();
        expect(config.options.trustServerCertificate).toBe(
          testCase.expected,
          `Failed for ${testCase.desc}: expected ${testCase.expected}`
        );
      });
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
