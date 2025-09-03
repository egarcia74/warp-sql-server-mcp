import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlServerMCP } from '../../index.js';

/**
 * Unit Tests for get_server_info MCP Tool
 *
 * Tests the comprehensive server diagnostics functionality that returns:
 * - Server information (version, status, uptime)
 * - Configuration details (connection, security, performance, logging, streaming)
 * - Runtime statistics (performance metrics, connection health, environment)
 * - Optional log information when includeLogs=true
 */

describe('get_server_info Tool', () => {
  let server;

  // Setup test environment
  const setupTestEnvironment = () => {
    process.env.NODE_ENV = 'test';
    process.env.SQL_SERVER_HOST = 'localhost';
    process.env.SQL_SERVER_PORT = '1433';
    process.env.SQL_SERVER_DATABASE = 'testdb';
    process.env.SQL_SERVER_USER = 'testuser';
    process.env.SQL_SERVER_PASSWORD = 'testpass';
    process.env.SQL_SERVER_READ_ONLY = 'false';
    process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
    process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
    process.env.LOG_LEVEL = 'debug';
    process.env.SQL_SERVER_RESPONSE_FORMAT = 'structured';
  };

  const cleanupTestEnvironment = () => {
    delete process.env.SQL_SERVER_HOST;
    delete process.env.SQL_SERVER_PORT;
    delete process.env.SQL_SERVER_DATABASE;
    delete process.env.SQL_SERVER_USER;
    delete process.env.SQL_SERVER_PASSWORD;
    delete process.env.SQL_SERVER_READ_ONLY;
    delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
    delete process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES;
    delete process.env.LOG_LEVEL;
    delete process.env.SQL_SERVER_RESPONSE_FORMAT;
  };

  beforeEach(() => {
    setupTestEnvironment();
    vi.clearAllMocks();
    server = new SqlServerMCP();
  });

  afterEach(() => {
    cleanupTestEnvironment();
    if (server?.connectionManager?.pool) {
      server.connectionManager.close();
    }
  });

  describe('Basic Server Information', () => {
    test('should return basic server information', () => {
      const result = server.getServerInfo(false);

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('"success": true')
        }
      ]);

      const data = JSON.parse(result[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();

      const serverInfo = data.data.server;
      expect(serverInfo.name).toBe('warp-sql-server-mcp');
      expect(serverInfo.version).toBe('1.6.2');
      expect(serverInfo.status).toBe('Running');
      expect(serverInfo.uptime).toBeTypeOf('number');
      expect(serverInfo.nodeVersion).toBe(process.version);
      expect(serverInfo.platform).toBe(process.platform);
    });

    test('should include process uptime', () => {
      const result = server.getServerInfo();
      const data = JSON.parse(result[0].text);

      expect(data.data.server.uptime).toBeGreaterThan(0);
    });
  });

  describe('Configuration Information', () => {
    test('should return connection configuration', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const connectionConfig = data.data.configuration.connection;
      expect(connectionConfig.server).toBe('localhost:1433');
      expect(connectionConfig.database).toBe('testdb');
      expect(connectionConfig.authType).toBe('SQL Server Authentication');
      expect(connectionConfig.encrypt).toBe(true); // Default is true
      expect(connectionConfig.trustCert).toBe(false); // Default is false when encrypt is true
      expect(connectionConfig.pool).toMatch(/\d+-\d+ connections/);
    });

    test('should return security configuration', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const securityConfig = data.data.configuration.security;
      expect(securityConfig.readOnlyMode).toBe(false);
      expect(securityConfig.allowDestructiveOperations).toBe(true);
      expect(securityConfig.allowSchemaChanges).toBe(false);
      expect(securityConfig.securityLevel).toBe('MEDIUM (DML Allowed)');
    });

    test('should return performance configuration', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const performanceConfig = data.data.configuration.performance;
      expect(performanceConfig.enabled).toBeDefined();
      expect(performanceConfig.slowQueryThreshold).toMatch(/\d+ms/);
      expect(performanceConfig.maxMetricsHistory).toBeTypeOf('number');
      expect(performanceConfig.samplingRate).toMatch(/\d+%/);
    });

    test('should return logging configuration', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const loggingConfig = data.data.configuration.logging;
      expect(loggingConfig.level).toBe('info'); // Default log level
      expect(loggingConfig.securityAudit).toBeTypeOf('boolean');
      expect(loggingConfig.responseFormat).toBe('structured');
    });

    test('should return streaming configuration', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const streamingConfig = data.data.configuration.streaming;
      expect(streamingConfig.enabled).toBeTypeOf('boolean');
      expect(streamingConfig.batchSize).toBeTypeOf('number');
      expect(streamingConfig.maxMemoryMB).toBeTypeOf('number');
      expect(streamingConfig.maxResponseSizeMB).toBeTypeOf('number');
    });
  });

  describe('Runtime Information', () => {
    test('should return performance statistics', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const performanceStats = data.data.runtime.performance;
      expect(performanceStats).toBeDefined();
      // Performance stats structure may vary based on query history
      expect(typeof performanceStats).toBe('object');
    });

    test('should return connection health', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const connectionHealth = data.data.runtime.connection;
      expect(connectionHealth).toBeDefined();
      // Connection health structure may vary based on connection state
    });

    test('should return environment information', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      const environment = data.data.runtime.environment;
      expect(environment.nodeEnv).toBe('test');
      expect(environment.memoryUsage).toBeDefined();
      expect(environment.memoryUsage.rss).toBeTypeOf('number');
      expect(environment.memoryUsage.heapUsed).toBeTypeOf('number');
      expect(environment.memoryUsage.heapTotal).toBeTypeOf('number');
      expect(environment.memoryUsage.external).toBeTypeOf('number');
      expect(environment.pid).toBe(process.pid);
    });
  });

  describe('Security Level Detection', () => {
    test('should detect MAXIMUM security level (read-only mode)', () => {
      process.env.SQL_SERVER_READ_ONLY = 'true';
      server = new SqlServerMCP();

      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      expect(data.data.configuration.security.securityLevel).toBe('MAXIMUM (Read-Only)');
      expect(data.data.configuration.security.readOnlyMode).toBe(true);
    });

    test('should detect HIGH security level (DDL blocked)', () => {
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'false';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
      server = new SqlServerMCP();

      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      expect(data.data.configuration.security.securityLevel).toBe('HIGH (DDL Blocked)');
      expect(data.data.configuration.security.allowDestructiveOperations).toBe(false);
      expect(data.data.configuration.security.allowSchemaChanges).toBe(false);
    });

    test('should detect MEDIUM security level (DML allowed)', () => {
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
      server = new SqlServerMCP();

      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      expect(data.data.configuration.security.securityLevel).toBe('MEDIUM (DML Allowed)');
      expect(data.data.configuration.security.allowDestructiveOperations).toBe(true);
      expect(data.data.configuration.security.allowSchemaChanges).toBe(false);
    });

    test('should detect MINIMAL security level (full access)', () => {
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';
      server = new SqlServerMCP();

      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      expect(data.data.configuration.security.securityLevel).toBe('MINIMAL (Full Access)');
      expect(data.data.configuration.security.allowSchemaChanges).toBe(true);
    });
  });

  describe('Authentication Type Detection', () => {
    test('should detect SQL Server Authentication', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      expect(data.data.configuration.connection.authType).toBe('SQL Server Authentication');
    });

    test('should detect Windows Authentication', () => {
      process.env.SQL_SERVER_USER = '';
      process.env.SQL_SERVER_PASSWORD = '';
      server = new SqlServerMCP();

      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      expect(data.data.configuration.connection.authType).toBe('Windows Authentication');
    });
  });

  describe('includeLogs Parameter', () => {
    test('should not include logging section when includeLogs=false', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      expect(data.data.logging).toBeUndefined();
    });

    test('should include logging section when includeLogs=true', () => {
      const result = server.getServerInfo(true);
      const data = JSON.parse(result[0].text);

      expect(data.data.logging).toBeDefined();
      expect(data.data.logging.note).toContain('MCP server logs');
      expect(data.data.logging.logLocation).toContain('Warp');
      expect(data.data.logging.structuredLogging).toContain('Winston');
      expect(data.data.logging.securityAudit).toMatch(/Enabled|Disabled/);
    });

    test('should handle undefined includeLogs parameter (defaults to false)', () => {
      const result = server.getServerInfo();
      const data = JSON.parse(result[0].text);

      expect(data.data.logging).toBeUndefined();
    });
  });

  describe('Response Format', () => {
    test('should return properly structured MCP response', () => {
      const result = server.getServerInfo(false);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('type', 'text');
      expect(result[0]).toHaveProperty('text');
    });

    test('should return valid JSON in text field', () => {
      const result = server.getServerInfo(false);

      expect(() => JSON.parse(result[0].text)).not.toThrow();

      const data = JSON.parse(result[0].text);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    test('should format JSON with proper indentation', () => {
      const result = server.getServerInfo(false);

      // JSON should be formatted with 2-space indentation
      expect(result[0].text).toContain('{\n  "success": true');
      expect(result[0].text).toContain('\n  "data": {');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing configuration gracefully', () => {
      // Remove some environment variables to test graceful handling
      delete process.env.SQL_SERVER_HOST;
      server = new SqlServerMCP();

      // Should not throw when getting server info
      expect(() => server.getServerInfo(false)).not.toThrow();
    });

    test('should handle performance monitor errors gracefully', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      // Performance stats should be included even if there are internal errors
      expect(data.data.runtime.performance).toBeDefined();
    });
  });

  describe('Integration with Other Components', () => {
    test('should retrieve data from ServerConfig component', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      // Verify it's using actual ServerConfig data
      expect(data.data.configuration.connection.server).toBeDefined();
      expect(data.data.configuration.security).toBeDefined();
    });

    test('should retrieve data from PerformanceMonitor component', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      // Verify it's using actual PerformanceMonitor data
      expect(data.data.runtime.performance).toBeDefined();
      expect(data.data.configuration.performance.enabled).toBeTypeOf('boolean');
    });

    test('should retrieve data from Logger component', () => {
      const result = server.getServerInfo(false);
      const data = JSON.parse(result[0].text);

      // Verify it's using actual Logger configuration
      expect(data.data.configuration.logging.level).toBeDefined();
      expect(data.data.configuration.logging.securityAudit).toBeTypeOf('boolean');
    });
  });
});
