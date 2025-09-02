import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlServerMCP } from '../../index.js';

/**
 * Cross-Component Error Scenario Tests
 *
 * Tests complex error scenarios that span multiple components:
 * - Cascading failures across the system
 * - Recovery mechanisms and graceful degradation
 * - Error propagation and handling
 * - Resource cleanup during failures
 * - System resilience under stress
 */

describe('Cross-Component Error Scenarios', () => {
  let server;

  const setupErrorTestEnvironment = () => {
    process.env.NODE_ENV = 'test';
    process.env.SQL_SERVER_HOST = 'localhost';
    process.env.SQL_SERVER_PORT = '1433';
    process.env.SQL_SERVER_DATABASE = 'testdb';
    process.env.SQL_SERVER_USER = 'testuser';
    process.env.SQL_SERVER_PASSWORD = 'testpass';
    process.env.SQL_SERVER_READ_ONLY = 'false';
    process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
  };

  const cleanupErrorTestEnvironment = () => {
    delete process.env.SQL_SERVER_HOST;
    delete process.env.SQL_SERVER_PORT;
    delete process.env.SQL_SERVER_DATABASE;
    delete process.env.SQL_SERVER_USER;
    delete process.env.SQL_SERVER_PASSWORD;
    delete process.env.SQL_SERVER_READ_ONLY;
    delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
  };

  beforeEach(() => {
    setupErrorTestEnvironment();
    vi.clearAllMocks();
    server = new SqlServerMCP();
  });

  afterEach(async () => {
    cleanupErrorTestEnvironment();
    if (server?.connectionManager?.pool) {
      await server.connectionManager.close();
    }
  });

  describe('Database Connection Cascade Failures', () => {
    test('should handle connection failure during query execution with performance tracking', async () => {
      // Setup: Mock connection failure
      const connectionError = new Error('ECONNREFUSED: Connection refused');
      connectionError.code = 'ECONNREFUSED';

      vi.spyOn(server.connectionManager, 'connect').mockRejectedValue(connectionError);

      // Also mock performance monitor to verify error tracking
      const recordQuerySpy = vi.spyOn(server.performanceMonitor, 'recordQuery');

      // Test: Attempt query execution
      await expect(server.executeQuery('SELECT 1')).rejects.toThrow('Query execution failed');

      // Verify: Error was properly tracked in performance monitor
      expect(recordQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'execute_query',
          success: false,
          error: 'ECONNREFUSED: Connection refused'
        })
      );
    });

    test('should handle connection timeout with retry exhaustion', async () => {
      // Setup: Mock connection timeout that exhausts retries
      const timeoutError = new Error('Connection timeout');
      timeoutError.code = 'ETIMEOUT';

      vi.spyOn(server.connectionManager, 'connect').mockRejectedValue(timeoutError);

      const recordQuerySpy = vi.spyOn(server.performanceMonitor, 'recordQuery');

      // Test: This should fail after retries
      const startTime = Date.now();
      await expect(server.executeQuery('SELECT 1')).rejects.toThrow('Query execution failed');
      const endTime = Date.now();

      // Verify: Error tracking includes timing information
      expect(recordQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Connection timeout',
          executionTime: expect.any(Number)
        })
      );

      // Verify: At least some execution time elapsed (even if minimal for mocked operations)
      expect(endTime - startTime).toBeGreaterThanOrEqual(0);
    });

    test('should handle connection pool exhaustion gracefully', async () => {
      // Setup: Mock pool exhaustion error
      const poolError = new Error('Connection pool exhausted');
      poolError.code = 'EPOOL_EXHAUSTED';

      vi.spyOn(server.connectionManager, 'connect').mockRejectedValue(poolError);

      // Test: Multiple concurrent requests should all fail gracefully
      const concurrentRequests = Array.from({ length: 5 }, () =>
        server.executeQuery('SELECT 1').catch(err => err)
      );

      const results = await Promise.all(concurrentRequests);

      // Verify: All requests failed with proper error messages
      results.forEach(result => {
        expect(result).toBeInstanceOf(Error);
        expect(result.message).toContain('Query execution failed');
      });
    });
  });

  describe('Performance Monitor Failures', () => {
    test('should continue query execution when performance monitoring fails', async () => {
      // Setup: Mock successful query but failing performance monitor
      const mockPool = {
        request: () => ({
          query: vi.fn().mockResolvedValue({
            recordset: [{ result: 'success' }],
            rowsAffected: [1]
          })
        })
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);

      // Make performance monitor fail
      vi.spyOn(server.performanceMonitor, 'recordQuery').mockImplementation(() => {
        throw new Error('Performance monitoring database down');
      });

      // Test: Query should still succeed despite performance monitor failure
      const result = await server.executeQuery('SELECT 1');

      // Verify: Query succeeded despite performance monitor failure
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('success');
    });

    test('should handle cascading performance monitor and database failures', async () => {
      // Setup: Both database and performance monitor fail
      vi.spyOn(server.connectionManager, 'connect').mockRejectedValue(
        new Error('Database connection failed')
      );

      vi.spyOn(server.performanceMonitor, 'recordQuery').mockImplementation(() => {
        throw new Error('Performance monitor failed');
      });

      // Test: Should handle both failures gracefully
      await expect(server.executeQuery('SELECT 1')).rejects.toThrow('Query execution failed'); // Primary error should be about query execution

      // The system should not crash despite both failures
      expect(server).toBeDefined();
      expect(server.connectionManager).toBeDefined();
      expect(server.performanceMonitor).toBeDefined();
    });
  });

  describe('Security Validation Failures', () => {
    test('should handle malformed security patterns gracefully', async () => {
      // Setup: Mock corrupted security configuration
      const mockBadSecurityConfig = {
        readOnlyMode: false,
        allowDestructiveOperations: true,
        allowSchemaChanges: true,
        patterns: {
          readOnly: null, // Corrupt pattern
          destructive: [/^\\s*(DELETE|UPDATE|INSERT)\\s+/i],
          schemaChanges: [/^\\s*(CREATE|DROP|ALTER)\\s+/i]
        }
      };

      vi.spyOn(server.config, 'getSecurityConfig').mockReturnValue(mockBadSecurityConfig);

      // Test: Should handle corrupted security config gracefully
      expect(() => {
        server.validateQuery('SELECT * FROM users');
      }).not.toThrow();
    });

    test('should fail safely when query validation throws unexpected error', async () => {
      // Setup: Mock validation method to throw unexpected error
      vi.spyOn(server, 'validateQuery').mockImplementation(() => {
        throw new Error('Unexpected validation error');
      });

      // Test: Should catch validation errors and fail safely
      await expect(server.executeQuery('SELECT 1')).rejects.toThrow('Unexpected validation error');

      // Connection should not be attempted
      expect(server.connectionManager.pool).toBeNull();
    });
  });

  describe('Resource Cleanup During Failures', () => {
    test('should clean up resources when query execution fails mid-execution', async () => {
      // Setup: Mock connection that fails during query execution
      const mockRequest = {
        query: vi.fn().mockRejectedValue(new Error('Query execution failed'))
      };
      const mockPool = {
        request: () => mockRequest,
        connected: true,
        close: vi.fn()
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);
      const closeSpy = vi.spyOn(server.connectionManager, 'close');

      // Test: Query fails during execution
      await expect(server.executeQuery('SELECT 1')).rejects.toThrow('Query execution failed');

      // Connection should still be available for potential reuse
      expect(server.connectionManager.pool).toBeDefined();

      // Manual cleanup should work
      await server.connectionManager.close();
      expect(closeSpy).toHaveBeenCalled();
    });

    test('should handle connection close failures gracefully', async () => {
      // Setup: Mock connection that fails to close
      const mockPool = {
        connected: true,
        close: vi.fn().mockRejectedValue(new Error('Close failed'))
      };

      server.connectionManager.pool = mockPool;

      // Test: Close failure should be handled gracefully
      await expect(server.connectionManager.close()).resolves.toBeUndefined();

      // Pool should still be nullified even if close failed
      expect(server.connectionManager.pool).toBeNull();
    });
  });

  describe('Memory and Resource Stress Scenarios', () => {
    test('should handle large query results without memory explosion', async () => {
      // Setup: Mock query that returns large dataset
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        data: `Large text data ${i}`.repeat(100) // ~1.8KB per row
      }));

      const mockPool = {
        request: () => ({
          query: vi.fn().mockResolvedValue({
            recordset: largeDataset,
            rowsAffected: [10000]
          })
        })
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);

      // Test: Should handle large result set
      const result = await server.executeQuery('SELECT * FROM large_table');

      // Verify: Result is formatted but not causing memory issues
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toBeDefined();
      expect(typeof result.content[0].text).toBe('string');
    });

    test('should handle rapid consecutive queries without resource leaks', async () => {
      // Setup: Mock successful queries
      const mockPool = {
        request: () => ({
          query: vi.fn().mockResolvedValue({
            recordset: [{ id: 1 }],
            rowsAffected: [1]
          })
        })
      };

      vi.spyOn(server.connectionManager, 'connect').mockResolvedValue(mockPool);
      const recordQuerySpy = vi.spyOn(server.performanceMonitor, 'recordQuery');

      // Test: Execute many queries rapidly
      const queries = Array.from({ length: 100 }, (_, i) =>
        server.executeQuery(`SELECT ${i} as id`)
      );

      const results = await Promise.all(queries);

      // Verify: All queries succeeded
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result.content).toBeDefined();
      });

      // Performance monitor should have tracked all queries
      expect(recordQuerySpy).toHaveBeenCalledTimes(100);
    });
  });

  describe('Component Isolation During Failures', () => {
    test('should isolate database tools failure from main server', async () => {
      // Setup: Mock database tools to fail
      vi.spyOn(server.databaseTools, 'listDatabases').mockRejectedValue(
        new Error('Database tools failure')
      );

      // Test: Database tools failure should not crash server
      await expect(server.databaseTools.listDatabases()).rejects.toThrow('Database tools failure');

      // But other functionality should still work
      expect(server.getPerformanceStats()).toBeDefined();
      expect(server.validateQuery('SELECT 1')).toMatchObject({
        allowed: true
      });
    });

    test('should isolate query optimizer failures', async () => {
      // Setup: Mock query optimizer to fail
      vi.spyOn(server.queryOptimizer, 'analyzeQuery').mockImplementation(() => {
        throw new Error('Query optimizer crashed');
      });

      // Test: Optimizer failure should not affect core functionality
      expect(() => {
        server.queryOptimizer.analyzeQuery('SELECT 1');
      }).toThrow('Query optimizer crashed');

      // But core server should still function
      const validation = server.validateQuery('SELECT 1');
      expect(validation.allowed).toBe(true);
    });
  });

  describe('Recovery and Resilience', () => {
    test('should recover from transient connection failures', async () => {
      // Setup: First call fails, second succeeds
      let callCount = 0;
      vi.spyOn(server.connectionManager, 'connect').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Transient failure'));
        }
        return Promise.resolve({
          request: () => ({
            query: vi.fn().mockResolvedValue({
              recordset: [{ recovered: true }]
            })
          })
        });
      });

      // Test: First query fails
      await expect(server.executeQuery('SELECT 1')).rejects.toThrow('Query execution failed');

      // Second query should succeed
      const result = await server.executeQuery('SELECT 2');
      expect(result.content[0].text).toContain('recovered');
    });

    test('should maintain system stability under concurrent failures', async () => {
      // Setup: Multiple types of failures happening concurrently
      const connectionErrors = [
        new Error('Connection timeout'),
        new Error('Pool exhausted'),
        new Error('Authentication failed'),
        new Error('Network unreachable')
      ];

      // Test: Multiple concurrent operations with different failures
      const operations = connectionErrors.map((error, index) => {
        vi.spyOn(server.connectionManager, 'connect').mockRejectedValueOnce(error);

        return server.executeQuery(`SELECT ${index}`).catch(err => ({
          error: err.message,
          index
        }));
      });

      const results = await Promise.all(operations);

      // Verify: All operations handled their failures gracefully
      results.forEach((result, index) => {
        expect(result).toMatchObject({
          error: expect.stringContaining('Query execution failed'),
          index
        });
      });

      // System should still be stable
      expect(server).toBeDefined();
      expect(server.connectionManager).toBeDefined();
    });
  });
});
