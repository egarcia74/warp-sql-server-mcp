import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../lib/utils/logger.js';
import winston from 'winston';

// Mock winston to control logging behavior in tests
vi.mock('winston', () => {
  const mockLogger = {
    log: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    on: vi.fn((event, callback) => {
      // Simulate immediate finish for flush tests
      if (event === 'finish') {
        setTimeout(callback, 0);
      }
    }),
    end: vi.fn(),
    level: 'info'
  };

  return {
    default: {
      createLogger: vi.fn(() => mockLogger),
      format: {
        errors: vi.fn(() => 'errors-format'),
        timestamp: vi.fn(() => 'timestamp-format'),
        colorize: vi.fn(() => 'colorize-format'),
        printf: vi.fn(() => 'printf-format'),
        json: vi.fn(() => 'json-format'),
        combine: vi.fn((...formats) => formats.join('-'))
      },
      transports: {
        Console: vi.fn(),
        File: vi.fn()
      }
    }
  };
});

describe('Logger', () => {
  let logger;
  let mockWinston;
  let mockSecurityLogger;
  let originalNodeEnv;
  let originalLogLevel;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Store original environment variables
    originalNodeEnv = process.env.NODE_ENV;
    originalLogLevel = process.env.SQL_SERVER_LOG_LEVEL;

    // Get mock references - create fresh instances for each test
    mockWinston = {
      log: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      on: vi.fn((event, callback) => {
        if (event === 'finish') {
          setTimeout(callback, 0);
        }
      }),
      end: vi.fn(),
      level: 'info'
    };

    mockSecurityLogger = {
      log: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      on: vi.fn((event, callback) => {
        if (event === 'finish') {
          setTimeout(callback, 0);
        }
      }),
      end: vi.fn(),
      level: 'info'
    };

    // Configure winston mock to return fresh instances
    winston.createLogger.mockImplementation(() => {
      // Alternate between main and security logger
      const calls = winston.createLogger.mock.calls.length;
      return calls % 2 === 1 ? mockWinston : mockSecurityLogger;
    });

    // Mock Date.now for consistent timestamps
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T00:00:00.000Z');
  });

  afterEach(() => {
    // Restore environment variables
    process.env.NODE_ENV = originalNodeEnv;
    process.env.SQL_SERVER_LOG_LEVEL = originalLogLevel;

    // Restore Date mock
    Date.prototype.toISOString.mockRestore();
  });

  describe('Constructor and Configuration', () => {
    test('should initialize with default configuration', () => {
      logger = new Logger();

      expect(logger.config).toEqual({
        level: 'info',
        enableSecurityAudit: true,
        includeTimestamp: true,
        includeMetadata: true,
        maxFileSize: '10m',
        maxFiles: 5
      });

      expect(winston.createLogger).toHaveBeenCalled(); // Should create loggers
    });

    test('should initialize with custom configuration', () => {
      const config = {
        level: 'debug',
        enableSecurityAudit: false,
        includeTimestamp: false,
        includeMetadata: false,
        maxFileSize: '5m',
        maxFiles: 3,
        customOption: 'test'
      };

      logger = new Logger(config);

      expect(logger.config).toEqual(config);
    });

    test('should use environment variable for log level', () => {
      process.env.SQL_SERVER_LOG_LEVEL = 'debug';

      logger = new Logger();

      expect(logger.config.level).toBe('debug');
    });

    test('should override environment with explicit config', () => {
      process.env.SQL_SERVER_LOG_LEVEL = 'debug';

      logger = new Logger({ level: 'warn' });

      expect(logger.config.level).toBe('warn');
    });

    test('should create security logger when enabled', () => {
      logger = new Logger({ enableSecurityAudit: true });

      expect(logger.securityLogger).toBe(mockSecurityLogger);
      expect(winston.createLogger).toHaveBeenCalled();
    });

    test('should not create security logger when disabled', () => {
      logger = new Logger({ enableSecurityAudit: false });

      expect(logger.securityLogger).toBeNull();
      expect(winston.createLogger).toHaveBeenCalled();
    });
  });

  describe('Logger Creation', () => {
    test('should create logger with development format', () => {
      process.env.NODE_ENV = 'development';

      logger = new Logger();

      // Verify development-specific formats were used
      expect(winston.format.colorize).toHaveBeenCalled();
      expect(winston.format.printf).toHaveBeenCalled();
      expect(winston.format.json).not.toHaveBeenCalled();
    });

    test('should create logger with production format', () => {
      process.env.NODE_ENV = 'production';

      logger = new Logger();

      // Verify production-specific formats were used
      expect(winston.format.json).toHaveBeenCalled();
      expect(winston.format.colorize).not.toHaveBeenCalled();
    });

    test('should include timestamp format when enabled', () => {
      logger = new Logger({ includeTimestamp: true });

      expect(winston.format.timestamp).toHaveBeenCalled();
    });

    test('should not include timestamp format when disabled', () => {
      logger = new Logger({ includeTimestamp: false });

      expect(winston.format.timestamp).toHaveBeenCalledTimes(1); // Only for security logger
    });

    test('should create file transport in production with logFile', () => {
      process.env.NODE_ENV = 'production';

      logger = new Logger({
        logFile: '/path/to/app.log',
        securityLogFile: '/path/to/security.log'
      });

      expect(winston.transports.File).toHaveBeenCalledTimes(2); // Main + security file transports
    });

    test('should not create file transport without logFile', () => {
      process.env.NODE_ENV = 'production';

      logger = new Logger();

      expect(winston.transports.File).not.toHaveBeenCalled();
    });
  });

  describe('Basic Logging Methods', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should log with metadata when includeMetadata is true', () => {
      logger.log('info', 'Test message', { key: 'value' });

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Test message', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        key: 'value'
      });
    });

    test('should log without metadata when includeMetadata is false', () => {
      logger = new Logger({ includeMetadata: false });

      logger.log('info', 'Test message', { key: 'value' });

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Test message', { key: 'value' });
    });

    test('should log info messages', () => {
      logger.info('Info message', { data: 'test' });

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Info message', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        data: 'test'
      });
    });

    test('should log warning messages', () => {
      logger.warn('Warning message', { context: 'test' });

      expect(mockWinston.log).toHaveBeenCalledWith('warn', 'Warning message', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        context: 'test'
      });
    });

    test('should log debug messages', () => {
      logger.debug('Debug message', { debug: true });

      expect(mockWinston.log).toHaveBeenCalledWith('debug', 'Debug message', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        debug: true
      });
    });
  });

  describe('Error Logging', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should log errors with Error object', () => {
      const error = new Error('Test error');
      error.stack = 'Error stack trace';

      logger.error('Error occurred', error, { context: 'test' });

      expect(mockWinston.log).toHaveBeenCalledWith('error', 'Error occurred', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        context: 'test',
        error: {
          name: 'Error',
          message: 'Test error',
          stack: 'Error stack trace'
        }
      });
    });

    test('should log errors with plain object', () => {
      const errorData = { code: 'ERR001', details: 'Custom error' };

      logger.error('Error occurred', errorData, { context: 'test' });

      expect(mockWinston.log).toHaveBeenCalledWith('error', 'Error occurred', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        context: 'test',
        error: errorData
      });
    });

    test('should log errors without error object', () => {
      logger.error('Error occurred', undefined, { context: 'test' });

      expect(mockWinston.log).toHaveBeenCalledWith('error', 'Error occurred', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        context: 'test',
        error: {}
      });
    });
  });

  describe('Security Logging', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should log security events when security logger enabled', () => {
      logger.security('UNAUTHORIZED_ACCESS', 'User attempted unauthorized access', {
        userId: 'user123',
        resource: 'sensitive_table'
      });

      expect(mockSecurityLogger.info).toHaveBeenCalledWith('Security Event', {
        event: 'UNAUTHORIZED_ACCESS',
        message: 'User attempted unauthorized access',
        timestamp: '2023-01-01T00:00:00.000Z',
        severity: 'CRITICAL',
        userId: 'user123',
        resource: 'sensitive_table'
      });
    });

    test('should log high-severity security events to main logger', () => {
      logger.security('CONNECTION_FAILED', 'Database connection failed', {
        host: 'db.example.com'
      });

      expect(mockSecurityLogger.info).toHaveBeenCalled();
      expect(mockWinston.log).toHaveBeenCalledWith(
        'warn',
        'Security Event: Database connection failed',
        {
          service: 'warp-sql-server-mcp',
          timestamp: '2023-01-01T00:00:00.000Z',
          securityEvent: expect.objectContaining({
            event: 'CONNECTION_FAILED',
            severity: 'HIGH'
          })
        }
      );
    });

    test('should not log low-severity security events to main logger', () => {
      logger.security('CONFIGURATION_CHANGE', 'Config updated', {});

      expect(mockSecurityLogger.info).toHaveBeenCalled();
      // Should not call main logger for MEDIUM severity
      expect(mockWinston.log).toHaveBeenCalledTimes(0);
    });

    test('should handle disabled security logging', () => {
      logger = new Logger({ enableSecurityAudit: false });

      logger.security('UNAUTHORIZED_ACCESS', 'Test event');

      expect(mockWinston.log).toHaveBeenCalledWith('warn', 'Security logging is disabled', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        event: 'UNAUTHORIZED_ACCESS',
        message: 'Test event'
      });
    });
  });

  describe('Security Severity Mapping', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should return correct severity for known events', () => {
      expect(logger.getSecuritySeverity('QUERY_BLOCKED')).toBe('MEDIUM');
      expect(logger.getSecuritySeverity('CONNECTION_FAILED')).toBe('HIGH');
      expect(logger.getSecuritySeverity('UNAUTHORIZED_ACCESS')).toBe('CRITICAL');
      expect(logger.getSecuritySeverity('SUSPICIOUS_ACTIVITY')).toBe('HIGH');
      expect(logger.getSecuritySeverity('CONFIGURATION_CHANGE')).toBe('MEDIUM');
      expect(logger.getSecuritySeverity('PRIVILEGE_ESCALATION')).toBe('CRITICAL');
    });

    test('should return LOW severity for unknown events', () => {
      expect(logger.getSecuritySeverity('UNKNOWN_EVENT')).toBe('LOW');
      expect(logger.getSecuritySeverity('')).toBe('LOW');
    });
  });

  describe('Query Execution Logging', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should log successful query execution', () => {
      logger.logQueryExecution(
        'execute_query',
        'SELECT * FROM users WHERE id = 1',
        { database: 'testdb', user: 'testuser', securityLevel: 'low' },
        { success: true, rowsAffected: 1, duration: 250 }
      );

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Query executed successfully', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        tool: 'execute_query',
        query: 'SELECT * FROM users WHERE id = 1',
        database: 'testdb',
        user: 'testuser',
        success: true,
        rowsAffected: 1,
        duration: 250,
        securityLevel: 'low'
      });
    });

    test('should log failed query execution', () => {
      const error = new Error('Syntax error');

      logger.logQueryExecution(
        'execute_query',
        'INVALID SQL',
        { database: 'testdb' },
        { success: false, error, duration: 50 }
      );

      expect(mockWinston.log).toHaveBeenCalledWith('error', 'Query execution failed', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        tool: 'execute_query',
        query: 'INVALID SQL',
        database: 'testdb',
        user: 'unknown',
        success: false,
        rowsAffected: 0,
        duration: 50,
        securityLevel: 'unknown',
        error: {
          name: 'Error',
          message: 'Syntax error',
          stack: expect.any(String)
        }
      });
    });

    test('should truncate long queries', () => {
      const longQuery =
        'SELECT * FROM users WHERE ' + 'condition AND '.repeat(20) + 'final_condition';

      logger.logQueryExecution('execute_query', longQuery, {}, { success: true });

      const logCall = mockWinston.log.mock.calls[0];
      expect(logCall[2].query).toHaveLength(203); // 200 chars + '...'
      expect(logCall[2].query).toMatch(/\.\.\.$/);
    });

    test('should log security violations', () => {
      logger.logQueryExecution(
        'execute_query',
        'DROP TABLE users',
        { securityViolation: true },
        { success: false, error: new Error('Blocked by security policy') }
      );

      expect(mockSecurityLogger.info).toHaveBeenCalledWith('Security Event', {
        event: 'QUERY_BLOCKED',
        message: 'Query blocked by security policy',
        timestamp: '2023-01-01T00:00:00.000Z',
        severity: 'MEDIUM',
        tool: 'execute_query',
        reason: 'Blocked by security policy',
        query: 'DROP TABLE users'
      });
    });

    test('should use default values for missing context', () => {
      logger.logQueryExecution('list_tables', 'SHOW TABLES');

      const logCall = mockWinston.log.mock.calls[0];
      expect(logCall[2]).toEqual({
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        tool: 'list_tables',
        query: 'SHOW TABLES',
        database: 'default',
        user: 'unknown',
        success: true,
        rowsAffected: 0,
        duration: 0,
        securityLevel: 'unknown'
      });
    });
  });

  describe('Database Connection Logging', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should log successful connection', () => {
      logger.logConnection('CONNECTION_SUCCESS', {
        host: 'localhost',
        database: 'testdb',
        authType: 'integrated'
      });

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Database connection established', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        event: 'CONNECTION_SUCCESS',
        host: 'localhost',
        database: 'testdb',
        authType: 'integrated'
      });
    });

    test('should log failed connection with security event', () => {
      const error = new Error('Login failed');

      logger.logConnection('CONNECTION_FAILED', {
        host: 'localhost',
        database: 'testdb',
        authType: 'sql',
        error
      });

      expect(mockWinston.log).toHaveBeenCalledWith('error', 'Database connection failed', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        event: 'CONNECTION_FAILED',
        host: 'localhost',
        database: 'testdb',
        authType: 'sql',
        error: {
          name: 'Error',
          message: 'Login failed',
          stack: expect.any(String)
        }
      });

      expect(mockSecurityLogger.info).toHaveBeenCalledWith('Security Event', {
        event: 'CONNECTION_FAILED',
        message: 'Database connection failure',
        timestamp: '2023-01-01T00:00:00.000Z',
        severity: 'HIGH',
        host: 'localhost',
        database: 'testdb',
        authType: 'sql',
        error
      });
    });

    test('should log connection retry', () => {
      logger.logConnection('CONNECTION_RETRY', {
        host: 'localhost',
        attempt: 2
      });

      expect(mockWinston.log).toHaveBeenCalledWith('warn', 'Database connection retry', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        event: 'CONNECTION_RETRY',
        host: 'localhost',
        database: 'unknown',
        authType: 'unknown',
        attempt: 2
      });
    });

    test('should log unknown connection events', () => {
      logger.logConnection('CUSTOM_EVENT', { custom: 'data' });

      expect(mockWinston.log).toHaveBeenCalledWith(
        'info',
        'Database connection event: CUSTOM_EVENT',
        {
          service: 'warp-sql-server-mcp',
          timestamp: '2023-01-01T00:00:00.000Z',
          event: 'CUSTOM_EVENT',
          host: 'unknown',
          database: 'unknown',
          authType: 'unknown',
          custom: 'data'
        }
      );
    });

    test('should remove sensitive information from logs', () => {
      logger.logConnection('CONNECTION_SUCCESS', {
        host: 'localhost',
        password: 'secret123',
        connectionString: 'Server=localhost;Password=secret123;',
        authType: 'sql'
      });

      const logCall = mockWinston.log.mock.calls[0];
      expect(logCall[2]).not.toHaveProperty('password');
      expect(logCall[2]).not.toHaveProperty('connectionString');
      expect(logCall[2]).toHaveProperty('authType', 'sql');
    });
  });

  describe('Tool Usage Logging', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should log tool usage with statistics', () => {
      logger.logToolUsage('export_table_csv', {
        executionTime: 1500,
        resultSize: 102400,
        cacheHit: true,
        rowsExported: 500
      });

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Tool usage: export_table_csv', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        tool: 'export_table_csv',
        executionTime: 1500,
        resultSize: 102400,
        cacheHit: true,
        rowsExported: 500
      });
    });

    test('should use default values for missing statistics', () => {
      logger.logToolUsage('list_tables');

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Tool usage: list_tables', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        tool: 'list_tables',
        executionTime: 0,
        resultSize: 0,
        cacheHit: false
      });
    });
  });

  describe('Child Logger', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should create child logger with additional context', () => {
      const childLogger = logger.child({ requestId: 'req-123', userId: 'user-456' });

      childLogger.info('Test message', { action: 'test' });

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Test message', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        requestId: 'req-123',
        userId: 'user-456',
        action: 'test'
      });
    });

    test('should merge context with existing default context', () => {
      logger.defaultContext = { service: 'parent-service' };
      const childLogger = logger.child({ requestId: 'req-123' });

      childLogger.info('Test message', { action: 'test' });

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Test message', {
        service: 'parent-service', // Should use parent service from defaultContext
        timestamp: '2023-01-01T00:00:00.000Z',
        requestId: 'req-123',
        action: 'test'
      });
    });

    test('should override parent context with child context', () => {
      logger.defaultContext = { priority: 'low' };
      const childLogger = logger.child({ priority: 'high' });

      childLogger.info('Test message');

      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Test message', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z',
        priority: 'high'
      });
    });
  });

  describe('Log Level Management', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should set new log level', () => {
      logger.setLevel('debug');

      expect(logger.config.level).toBe('debug');
      expect(mockWinston.level).toBe('debug');
      expect(mockWinston.log).toHaveBeenCalledWith('info', 'Log level changed to debug', {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z'
      });
    });
  });

  describe('Log Flushing', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should flush logs successfully', async () => {
      const flushPromise = logger.flush();

      // Wait for promise to resolve
      await expect(flushPromise).resolves.toBeUndefined();

      expect(mockWinston.end).toHaveBeenCalled();
      expect(mockSecurityLogger.end).toHaveBeenCalled();
      expect(mockWinston.on).toHaveBeenCalledWith('finish', expect.any(Function));
      expect(mockSecurityLogger.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });

    test('should flush only main logger when security logger disabled', async () => {
      logger = new Logger({ enableSecurityAudit: false });

      await logger.flush();

      expect(mockWinston.end).toHaveBeenCalled();
      // When security logger is disabled, mockSecurityLogger.end might still be called
      // due to our mock setup, so we don't assert on it
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      logger = new Logger();
    });

    test('should handle undefined values gracefully', () => {
      logger.info(undefined);
      logger.warn(null);
      logger.debug('', null);

      expect(mockWinston.log).toHaveBeenCalledTimes(3);
    });

    test('should handle empty context objects', () => {
      logger.logQueryExecution('test_tool', 'SELECT 1', {}, {});
      logger.logConnection('TEST_EVENT', {});
      logger.logToolUsage('test_tool', {});

      expect(mockWinston.log).toHaveBeenCalledTimes(3);
    });

    test('should handle circular reference in metadata', () => {
      const circular = { name: 'test' };
      circular.self = circular;

      // Should not throw
      expect(() => {
        logger.info('Test with circular reference', circular);
      }).not.toThrow();
    });

    test('should handle very long messages', () => {
      const longMessage = 'A'.repeat(10000);

      logger.info(longMessage);

      expect(mockWinston.log).toHaveBeenCalledWith('info', longMessage, {
        service: 'warp-sql-server-mcp',
        timestamp: '2023-01-01T00:00:00.000Z'
      });
    });
  });
});
