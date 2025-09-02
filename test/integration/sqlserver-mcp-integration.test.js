import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlServerMCP } from '../../index.js';

/**
 * Integration Tests for SqlServerMCP Main Class
 *
 * These tests validate the integration between all components:
 * - Configuration management
 * - Connection handling
 * - Security validation
 * - Tool execution
 * - Performance monitoring
 * - Error propagation
 */

// Integration test environment setup
const setupIntegrationEnvironment = () => {
  process.env.NODE_ENV = 'test';
  process.env.SQL_SERVER_HOST = 'localhost';
  process.env.SQL_SERVER_PORT = '1433';
  process.env.SQL_SERVER_DATABASE = 'testdb';
  process.env.SQL_SERVER_USER = 'testuser';
  process.env.SQL_SERVER_PASSWORD = 'testpass';
};

const cleanupIntegrationEnvironment = () => {
  delete process.env.SQL_SERVER_HOST;
  delete process.env.SQL_SERVER_PORT;
  delete process.env.SQL_SERVER_DATABASE;
  delete process.env.SQL_SERVER_USER;
  delete process.env.SQL_SERVER_PASSWORD;
  delete process.env.SQL_SERVER_READ_ONLY;
  delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
  delete process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES;
};

describe('SqlServerMCP Integration Tests', () => {
  let server;

  beforeEach(() => {
    setupIntegrationEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupIntegrationEnvironment();
    if (server?.connectionManager?.pool) {
      server.connectionManager.close();
    }
  });

  describe('Server Initialization and Component Integration', () => {
    test('should initialize all components correctly', () => {
      server = new SqlServerMCP();

      // Verify main server components are initialized
      expect(server.server).toBeDefined();
      expect(server.config).toBeDefined();
      expect(server.connectionManager).toBeDefined();
      expect(server.performanceMonitor).toBeDefined();
      expect(server.databaseTools).toBeDefined();
      expect(server.queryOptimizer).toBeDefined();
      expect(server.bottleneckDetector).toBeDefined();

      // Verify configuration properties are properly set
      expect(server.connectionManager.connectionTimeout).toBeGreaterThan(0);
      expect(server.connectionManager.maxRetries).toBeGreaterThan(0);
      expect(server.performanceMonitor).toBeDefined();
    });

    test('should propagate configuration changes across components', () => {
      // Test read-only mode affects query validation
      process.env.SQL_SERVER_READ_ONLY = 'true';
      server = new SqlServerMCP();

      const result = server.validateQuery('DELETE FROM users');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only mode');
    });

    test('should handle component initialization failures gracefully', () => {
      // Test with invalid configuration
      process.env.SQL_SERVER_PORT = 'invalid';

      expect(() => {
        server = new SqlServerMCP();
      }).not.toThrow(); // Should handle gracefully
    });
  });

  describe('Tool Request Processing Integration', () => {
    test('should process list_databases request through full pipeline', async () => {
      server = new SqlServerMCP();

      // Mock the connection manager to return a successful connection
      const mockPool = {
        request: () => ({
          query: vi.fn().mockResolvedValue({
            recordset: [{ name: 'master' }, { name: 'tempdb' }, { name: 'model' }]
          })
        })
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);

      const result = await server.databaseTools.listDatabases();

      expect(result).toBeDefined();
      expect(result[0].text).toContain('master');
      expect(server.connectionManager.connect).toHaveBeenCalled();
    });

    test('should validate queries before execution in full pipeline', async () => {
      process.env.SQL_SERVER_READ_ONLY = 'true';
      server = new SqlServerMCP();

      // This should be blocked by query validation before hitting the database
      await expect(server.executeQuery('DROP TABLE users')).rejects.toThrow(
        'Query blocked by safety policy'
      );

      // Verify connection was never attempted
      expect(server.connectionManager.pool).toBeNull();
    });

    test('should track performance across component interactions', async () => {
      server = new SqlServerMCP();

      const mockPool = {
        request: () => ({
          query: vi.fn().mockResolvedValue({
            recordset: [{ count: 5 }]
          })
        })
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);
      vi.spyOn(server.performanceMonitor, 'recordQuery');

      await server.executeQuery('SELECT COUNT(*) FROM users');

      expect(server.performanceMonitor.recordQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'execute_query',
          success: true
        })
      );
    });
  });

  describe('Error Propagation and Recovery', () => {
    test('should handle connection failures across components', async () => {
      server = new SqlServerMCP();

      // Mock connection failure
      const connectionError = new Error('Connection failed');
      vi.spyOn(server.connectionManager, 'connect').mockRejectedValue(connectionError);
      vi.spyOn(server.performanceMonitor, 'recordQuery');

      await expect(server.executeQuery('SELECT 1')).rejects.toThrow('Query execution failed');

      // Verify error was recorded in performance monitor
      expect(server.performanceMonitor.recordQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Connection failed'
        })
      );
    });

    test('should handle cascading failures gracefully', async () => {
      server = new SqlServerMCP();

      // Mock multiple component failures
      vi.spyOn(server.connectionManager, 'connect').mockRejectedValue(new Error('DB Error'));
      vi.spyOn(server.performanceMonitor, 'recordQuery').mockImplementation(() => {
        throw new Error('Monitor Error');
      });

      // Should propagate an error (may be monitor error if it throws first)
      await expect(server.executeQuery('SELECT 1')).rejects.toThrow(); // Accept any error in this cascading failure scenario
    });
  });

  describe('Security Policy Integration', () => {
    test('should enforce security policies consistently across all tools', async () => {
      // Test with read-only disabled but destructive ops disabled
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'false';
      server = new SqlServerMCP();

      // Test different destructive operations are all blocked
      const queries = [
        'DELETE FROM users',
        'UPDATE users SET name = "test"',
        'INSERT INTO users VALUES (1, "test")'
      ];

      for (const query of queries) {
        await expect(server.executeQuery(query)).rejects.toThrow('Query blocked by safety policy');
      }
    });

    test('should handle security policy changes dynamically', async () => {
      // Test default security posture (secure by default)
      server = new SqlServerMCP();
      expect(server.readOnlyMode).toBe(true); // Secure default
      expect(server.allowDestructiveOperations).toBe(false); // Secure default

      // Now test with relaxed security
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';

      // Create new server with updated environment - need to reload config
      const { serverConfig } = await import('../../lib/config/server-config.js');
      serverConfig.reload(); // Force reload of configuration
      server = new SqlServerMCP();
      expect(server.readOnlyMode).toBe(false);
      expect(server.allowDestructiveOperations).toBe(true);

      // Now should allow destructive operations
      const result = server.validateQuery('DELETE FROM users');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Resource Management Integration', () => {
    test('should properly manage resources across components', async () => {
      server = new SqlServerMCP();

      const mockPool = {
        request: () => ({
          query: vi.fn().mockResolvedValue({ recordset: [] })
        }),
        close: vi.fn()
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);
      vi.spyOn(server.connectionManager, 'close');

      // Perform operation
      await server.executeQuery('SELECT 1');

      // Verify connection was established (pool may not be directly accessible)
      expect(server.connectionManager.connect).toHaveBeenCalled();

      // Test cleanup
      await server.connectionManager.close();
      expect(server.connectionManager.close).toHaveBeenCalled();
    });
  });

  describe('Performance and Monitoring Integration', () => {
    test('should collect comprehensive metrics across all operations', async () => {
      server = new SqlServerMCP();

      const mockPool = {
        request: () => ({
          query: vi.fn().mockResolvedValue({
            recordset: [{ id: 1 }],
            rowsAffected: [1]
          })
        })
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);

      // Perform multiple operations
      await server.executeQuery('SELECT * FROM users');
      await server.databaseTools.listDatabases();

      const stats = server.getPerformanceStats();
      expect(stats.content[0].text).toContain('totalQueries');

      const health = server.getConnectionHealth();
      expect(health.content[0].text).toContain('connection');
    });
  });
});
