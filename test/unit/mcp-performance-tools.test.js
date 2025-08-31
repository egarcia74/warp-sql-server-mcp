import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the mssql module to avoid any real DB interactions
vi.mock('mssql', () => ({
  default: {
    connect: vi.fn(),
    ConnectionPool: vi.fn()
  },
  connect: vi.fn(),
  ConnectionPool: vi.fn()
}));

// Mock StdioServerTransport to avoid importing actual MCP SDK transport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(() => ({
    connect: vi.fn()
  }))
}));

import { SqlServerMCP } from '../../index.js';

describe('Performance Monitoring MCP Tools', () => {
  let mcpServer;
  let mockPool;
  let mockPerformanceMonitor;
  let originalConsoleError;

  beforeEach(async () => {
    // Reset environment variables for clean defaults
    delete process.env.SQL_SERVER_READ_ONLY;
    delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
    delete process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES;

    // Mock console.error to prevent performance monitoring output during tests
    originalConsoleError = console.error;
    console.error = vi.fn();

    // Create server instance
    mcpServer = new SqlServerMCP();

    // Mock SQL pool
    mockPool = {
      request: vi.fn().mockReturnValue({
        query: vi.fn()
      }),
      close: vi.fn()
    };

    mcpServer.pool = mockPool;

    // Mock performance monitor instance and methods
    mockPerformanceMonitor = {
      getStats: vi.fn(),
      getQueryStats: vi.fn(),
      getPoolStats: vi.fn(),
      startQuery: vi.fn(() => 'query_id_123'),
      endQuery: vi.fn(),
      recordPoolMetrics: vi.fn()
    };

    // Assign mock performance monitor to the server instance
    mcpServer.performanceMonitor = mockPerformanceMonitor;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    // Clean up environment variables
    delete process.env.SQL_SERVER_READ_ONLY;
    delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
    delete process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES;
  });

  describe('getPerformanceStats', () => {
    test('should return overall performance statistics (default timeframe)', async () => {
      const mockStats = {
        enabled: true,
        uptime: 3600000,
        overall: {
          totalQueries: 150,
          avgQueryTime: 234,
          slowQueries: 5,
          errorRate: 2.3
        },
        recent: {
          count: 25,
          avgDuration: 180,
          errorRate: 1.2
        },
        pool: {
          totalConnections: 10,
          activeConnections: 3,
          errors: 0
        }
      };

      mockPerformanceMonitor.getStats.mockReturnValue(mockStats);

      const result = await mcpServer.getPerformanceStats();
      const responseData = JSON.parse(result.content[0].text);

      expect(mockPerformanceMonitor.getStats).toHaveBeenCalledWith();
      expect(responseData.enabled).toBe(true);
      expect(responseData.uptime).toBe(3600000);
      expect(responseData.overall.totalQueries).toBe(150);
      expect(responseData.recent.avgDuration).toBe(180);
    });

    test('should handle timeframe parameter - recent', async () => {
      const mockRecentStats = {
        enabled: true,
        recent: {
          count: 10,
          avgDuration: 150,
          errorRate: 0.5
        }
      };

      mockPerformanceMonitor.getStats.mockReturnValue(mockRecentStats);

      const result = await mcpServer.getPerformanceStats('recent');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.timeframe).toBe('recent');
      expect(responseData.recent.count).toBe(10);
    });

    test('should handle disabled performance monitoring', async () => {
      mockPerformanceMonitor.getStats.mockReturnValue({ enabled: false });

      const result = await mcpServer.getPerformanceStats();
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.enabled).toBe(false);
      expect(responseData.message).toBe('Performance monitoring is disabled');
    });

    test('should handle performance monitoring errors', async () => {
      mockPerformanceMonitor.getStats.mockImplementation(() => {
        throw new Error('Performance monitoring error');
      });

      await expect(mcpServer.getPerformanceStats()).rejects.toThrow(
        'Failed to get performance statistics: Performance monitoring error'
      );
    });
  });

  describe('getQueryPerformance', () => {
    test('should return detailed query performance breakdown', async () => {
      const mockQueryStats = {
        enabled: true,
        queries: [
          {
            tool: 'execute_query',
            duration: 450,
            status: 'completed',
            rowCount: 25,
            streaming: false,
            timestamp: 1640995200000
          },
          {
            tool: 'get_table_data',
            duration: 120,
            status: 'completed',
            rowCount: 100,
            streaming: true,
            timestamp: 1640995260000
          }
        ],
        byTool: {
          execute_query: {
            count: 10,
            avgTime: 340,
            errors: 1,
            slowQueries: 2,
            errorRate: 10,
            slowQueryRate: 20
          },
          get_table_data: {
            count: 15,
            avgTime: 180,
            errors: 0,
            slowQueries: 0,
            errorRate: 0,
            slowQueryRate: 0
          }
        },
        slowQueries: [
          {
            tool: 'execute_query',
            duration: 6000,
            status: 'completed',
            rowCount: 50000,
            streaming: true,
            timestamp: 1640995300000
          }
        ]
      };

      mockPerformanceMonitor.getQueryStats.mockReturnValue(mockQueryStats);

      const result = await mcpServer.getQueryPerformance();
      const responseData = JSON.parse(result.content[0].text);

      expect(mockPerformanceMonitor.getQueryStats).toHaveBeenCalledWith(50);
      expect(responseData.enabled).toBe(true);
      expect(responseData.queries).toHaveLength(2);
      expect(responseData.byTool.execute_query.count).toBe(10);
      expect(responseData.slowQueries).toHaveLength(1);
    });

    test('should handle limit parameter', async () => {
      mockPerformanceMonitor.getQueryStats.mockReturnValue({ enabled: true, queries: [] });

      await mcpServer.getQueryPerformance(100);

      expect(mockPerformanceMonitor.getQueryStats).toHaveBeenCalledWith(100);
    });

    test('should handle tool_filter parameter', async () => {
      const mockQueryStats = {
        enabled: true,
        queries: [
          {
            tool: 'execute_query',
            duration: 450,
            status: 'completed'
          }
        ],
        byTool: {}
      };

      mockPerformanceMonitor.getQueryStats.mockReturnValue(mockQueryStats);

      const result = await mcpServer.getQueryPerformance(50, 'execute_query');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.tool_filter).toBe('execute_query');
      expect(responseData.queries.every(q => q.tool === 'execute_query')).toBe(true);
    });

    test('should handle slow_only parameter', async () => {
      const mockQueryStats = {
        enabled: true,
        queries: [],
        byTool: {},
        slowQueries: [
          {
            tool: 'list_tables',
            duration: 7500,
            status: 'completed'
          }
        ]
      };

      mockPerformanceMonitor.getQueryStats.mockReturnValue(mockQueryStats);

      const result = await mcpServer.getQueryPerformance(50, null, true);
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.slow_only).toBe(true);
      expect(responseData.queries).toEqual(mockQueryStats.slowQueries);
    });

    test('should handle disabled performance monitoring', async () => {
      mockPerformanceMonitor.getQueryStats.mockReturnValue({ enabled: false });

      const result = await mcpServer.getQueryPerformance();
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.enabled).toBe(false);
      expect(responseData.message).toBe('Performance monitoring is disabled');
    });

    test('should handle query performance errors', async () => {
      mockPerformanceMonitor.getQueryStats.mockImplementation(() => {
        throw new Error('Query stats error');
      });

      await expect(mcpServer.getQueryPerformance()).rejects.toThrow(
        'Failed to get query performance: Query stats error'
      );
    });
  });

  describe('getConnectionHealth', () => {
    test('should return connection pool health metrics', async () => {
      const mockPoolStats = {
        enabled: true,
        current: {
          totalConnections: 10,
          activeConnections: 4,
          idleConnections: 6,
          pendingRequests: 1,
          errors: 2,
          timestamp: 1640995200000,
          uptime: 7200000
        },
        recent: {
          connectionRate: 0.5,
          errorRate: 0.1,
          retryRate: 0.05,
          totalEvents: 25
        },
        health: {
          status: 'healthy',
          issues: [],
          score: 95
        }
      };

      mockPerformanceMonitor.getPoolStats.mockReturnValue(mockPoolStats);

      const result = await mcpServer.getConnectionHealth();
      const responseData = JSON.parse(result.content[0].text);

      expect(mockPerformanceMonitor.getPoolStats).toHaveBeenCalled();
      expect(responseData.enabled).toBe(true);
      expect(responseData.current.totalConnections).toBe(10);
      expect(responseData.recent.connectionRate).toBe(0.5);
      expect(responseData.health.status).toBe('healthy');
      expect(responseData.health.score).toBe(95);
    });

    test('should return warning health status', async () => {
      const mockPoolStats = {
        enabled: true,
        current: {
          totalConnections: 10,
          activeConnections: 9,
          errors: 12
        },
        health: {
          status: 'warning',
          issues: ['High error count detected', 'Connection pool near capacity'],
          score: 65
        }
      };

      mockPerformanceMonitor.getPoolStats.mockReturnValue(mockPoolStats);

      const result = await mcpServer.getConnectionHealth();
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.health.status).toBe('warning');
      expect(responseData.health.issues).toContain('High error count detected');
      expect(responseData.health.score).toBe(65);
    });

    test('should return critical health status', async () => {
      const mockPoolStats = {
        enabled: true,
        current: {
          totalConnections: 10,
          activeConnections: 0,
          errors: 25
        },
        health: {
          status: 'critical',
          issues: ['No active connections available'],
          score: 15
        }
      };

      mockPerformanceMonitor.getPoolStats.mockReturnValue(mockPoolStats);

      const result = await mcpServer.getConnectionHealth();
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.health.status).toBe('critical');
      expect(responseData.health.issues).toContain('No active connections available');
      expect(responseData.health.score).toBe(15);
    });

    test('should handle disabled pool monitoring', async () => {
      mockPerformanceMonitor.getPoolStats.mockReturnValue({ enabled: false });

      const result = await mcpServer.getConnectionHealth();
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.enabled).toBe(false);
      expect(responseData.message).toBe('Connection pool monitoring is disabled');
    });

    test('should handle connection health errors', async () => {
      mockPerformanceMonitor.getPoolStats.mockImplementation(() => {
        throw new Error('Pool stats error');
      });

      await expect(mcpServer.getConnectionHealth()).rejects.toThrow(
        'Failed to get connection health: Pool stats error'
      );
    });
  });

  describe('Security Validation for Performance Tools', () => {
    test('should respect read-only mode for performance stats', async () => {
      mcpServer.readOnlyMode = true;
      mockPerformanceMonitor.getStats.mockReturnValue({ enabled: true });

      const result = await mcpServer.getPerformanceStats();
      const responseData = JSON.parse(result.content[0].text);

      // Performance monitoring tools should work in read-only mode
      expect(responseData.enabled).toBe(true);
      expect(mockPerformanceMonitor.getStats).toHaveBeenCalled();
    });

    test('should work with destructive operations disabled', async () => {
      mcpServer.allowDestructiveOperations = false;
      mockPerformanceMonitor.getQueryStats.mockReturnValue({ enabled: true, queries: [] });

      const result = await mcpServer.getQueryPerformance();
      const responseData = JSON.parse(result.content[0].text);

      // Performance monitoring tools should work regardless of destructive operations setting
      expect(responseData.enabled).toBe(true);
      expect(mockPerformanceMonitor.getQueryStats).toHaveBeenCalled();
    });

    test('should work with schema changes disabled', async () => {
      mcpServer.allowSchemaChanges = false;
      mockPerformanceMonitor.getPoolStats.mockReturnValue({ enabled: true });

      const result = await mcpServer.getConnectionHealth();
      const responseData = JSON.parse(result.content[0].text);

      // Performance monitoring tools should work regardless of schema changes setting
      expect(responseData.enabled).toBe(true);
      expect(mockPerformanceMonitor.getPoolStats).toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    test('should handle performance monitor not initialized', async () => {
      mcpServer.performanceMonitor = null;

      await expect(mcpServer.getPerformanceStats()).rejects.toThrow(
        'Performance monitoring is not initialized'
      );
    });

    test('should handle invalid timeframe parameter', async () => {
      // Set up mock stats for the invalid timeframe test
      const mockStats = {
        enabled: true,
        uptime: 3600000,
        overall: { totalQueries: 100 },
        recent: { count: 10 },
        pool: { totalConnections: 5 }
      };
      mockPerformanceMonitor.getStats.mockReturnValue(mockStats);

      const result = await mcpServer.getPerformanceStats('invalid');
      const responseData = JSON.parse(result.content[0].text);

      // Should default to 'all' timeframe
      expect(responseData.timeframe).toBe('all');
      expect(responseData.enabled).toBe(true);
    });

    test('should handle negative limit parameter', async () => {
      mockPerformanceMonitor.getQueryStats.mockReturnValue({ enabled: true, queries: [] });

      await mcpServer.getQueryPerformance(-10);

      // Should use default limit (50) when negative value provided
      expect(mockPerformanceMonitor.getQueryStats).toHaveBeenCalledWith(50);
    });

    test('should handle empty query performance results', async () => {
      mockPerformanceMonitor.getQueryStats.mockReturnValue({
        enabled: true,
        queries: [],
        byTool: {},
        slowQueries: []
      });

      const result = await mcpServer.getQueryPerformance();
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.queries).toHaveLength(0);
      expect(responseData.slowQueries).toHaveLength(0);
      expect(Object.keys(responseData.byTool)).toHaveLength(0);
    });
  });
});
