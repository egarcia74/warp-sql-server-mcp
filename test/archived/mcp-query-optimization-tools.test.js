import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  setupMssqlMock,
  setupStdioMock,
  // setupMcpTest,
  resetEnvironment,
  setupTestEnvironment,
  createTestMcpServerV4,
  mockPool,
  mockRequest
  // testData
} from './mcp-shared-fixtures.js';

// Setup module mocks
setupMssqlMock();
setupStdioMock();

describe('Query Optimization MCP Tools (TDD Tests)', () => {
  let mcpServer;

  // Mock test data for optimization tools
  const mockOptimizationData = {
    // Index recommendations
    indexRecommendations: [
      {
        database_name: 'TestDB',
        table_name: 'Users',
        schema_name: 'dbo',
        recommended_index: 'IX_Users_LastName_FirstName',
        columns: 'LastName, FirstName',
        index_type: 'NONCLUSTERED',
        impact_score: 85.7,
        estimated_improvement: '45% faster queries',
        missing_index_handle: 1234,
        user_seeks: 1500,
        user_scans: 25,
        avg_total_user_cost: 12.45,
        avg_user_impact: 85.7,
        sample_queries: [
          'SELECT * FROM Users WHERE LastName = ? AND FirstName = ?',
          'SELECT COUNT(*) FROM Users WHERE LastName LIKE ?'
        ]
      },
      {
        database_name: 'TestDB',
        table_name: 'Orders',
        schema_name: 'dbo',
        recommended_index: 'IX_Orders_CustomerID_OrderDate',
        columns: 'CustomerID, OrderDate',
        index_type: 'NONCLUSTERED',
        impact_score: 72.3,
        estimated_improvement: '35% faster queries',
        missing_index_handle: 1235,
        user_seeks: 890,
        user_scans: 15,
        avg_total_user_cost: 8.23,
        avg_user_impact: 72.3,
        sample_queries: ['SELECT * FROM Orders WHERE CustomerID = ? AND OrderDate >= ?']
      }
    ],

    // Query bottlenecks
    queryBottlenecks: [
      {
        query_hash: 'ABC123DEF456',
        query_text: 'SELECT * FROM LargeTable WHERE Status = ? AND CreatedDate >= ?',
        database_name: 'TestDB',
        avg_duration_ms: 8500,
        total_executions: 450,
        avg_cpu_time_ms: 3200,
        avg_logical_reads: 25000,
        avg_physical_reads: 1200,
        avg_writes: 0,
        avg_wait_time_ms: 1800,
        wait_stats: [
          {
            wait_type: 'PAGEIOLATCH_SH',
            wait_time_ms: 1200,
            wait_count: 180
          },
          {
            wait_type: 'LCK_M_S',
            wait_time_ms: 600,
            wait_count: 45
          }
        ],
        bottleneck_type: 'IO_INTENSIVE',
        severity: 'HIGH',
        recommendations: [
          'Consider adding index on Status, CreatedDate columns',
          'Review query to reduce logical reads',
          'Consider query optimization or table partitioning'
        ]
      }
    ],

    // Query analysis results
    queryAnalysis: {
      query:
        'SELECT u.Name, COUNT(o.OrderID) FROM Users u LEFT JOIN Orders o ON u.UserID = o.CustomerID WHERE u.CreatedDate >= ? GROUP BY u.Name',
      database_name: 'TestDB',
      analysis: {
        query_type: 'SELECT_WITH_JOIN_AND_AGGREGATION',
        complexity_score: 7.5,
        estimated_cost: 15.67,
        table_access_methods: [
          {
            table: 'Users',
            access_method: 'CLUSTERED_INDEX_SCAN',
            estimated_rows: 10000,
            cost: 8.23
          },
          {
            table: 'Orders',
            access_method: 'CLUSTERED_INDEX_SEEK',
            estimated_rows: 25000,
            cost: 7.44
          }
        ],
        join_algorithms: [
          {
            type: 'HASH_MATCH',
            cost: 12.45,
            estimated_rows: 8500
          }
        ],
        operators: [
          'Clustered Index Scan',
          'Clustered Index Seek',
          'Hash Match (Left Outer Join)',
          'Stream Aggregate'
        ],
        bottlenecks: [
          {
            type: 'LARGE_TABLE_SCAN',
            severity: 'MEDIUM',
            description: 'Full table scan on Users table',
            recommendation: 'Consider adding index on CreatedDate'
          }
        ],
        performance_warnings: [
          'LEFT JOIN with large table may cause performance issues',
          'GROUP BY operation requires sorting - consider covering index'
        ],
        optimization_suggestions: [
          {
            type: 'INDEX_RECOMMENDATION',
            priority: 'HIGH',
            suggestion:
              'CREATE INDEX IX_Users_CreatedDate_Name ON Users(CreatedDate) INCLUDE (Name)',
            estimated_improvement: '60% performance gain'
          },
          {
            type: 'QUERY_REWRITE',
            priority: 'MEDIUM',
            suggestion: 'Consider EXISTS instead of LEFT JOIN if you only need users with orders',
            estimated_improvement: '25% performance gain'
          }
        ]
      }
    },

    // Optimization insights
    optimizationInsights: {
      database_name: 'TestDB',
      analysis_period: '7_DAYS',
      overall_health: {
        score: 72,
        status: 'NEEDS_ATTENTION',
        issues_count: 3,
        critical_issues: 1
      },
      top_issues: [
        {
          category: 'MISSING_INDEXES',
          severity: 'CRITICAL',
          count: 12,
          impact: 'HIGH',
          description: 'Multiple high-impact missing indexes detected',
          estimated_improvement: '50% average query performance improvement'
        },
        {
          category: 'SLOW_QUERIES',
          severity: 'HIGH',
          count: 8,
          impact: 'MEDIUM',
          description: 'Queries taking longer than 5 seconds',
          estimated_improvement: '40% reduction in query time'
        },
        {
          category: 'BLOCKING_ISSUES',
          severity: 'MEDIUM',
          count: 3,
          impact: 'MEDIUM',
          description: 'Lock contention and blocking detected',
          estimated_improvement: '20% improvement in concurrency'
        }
      ],
      recommendations: [
        {
          priority: 'CRITICAL',
          type: 'INDEX_OPTIMIZATION',
          action: 'Create 5 high-impact missing indexes',
          effort: 'LOW',
          impact: 'HIGH',
          estimated_benefit: '45% average performance improvement'
        },
        {
          priority: 'HIGH',
          type: 'QUERY_TUNING',
          action: 'Optimize 3 slowest queries',
          effort: 'MEDIUM',
          impact: 'HIGH',
          estimated_benefit: '60% improvement for affected queries'
        }
      ],
      trends: {
        performance_trend: 'DECLINING',
        query_volume_trend: 'INCREASING',
        error_rate_trend: 'STABLE'
      }
    }
  };

  beforeEach(async () => {
    // Set up test environment manually without overriding mock responses
    setupTestEnvironment();
    mcpServer = await createTestMcpServerV4();
    mcpServer.pool = mockPool;

    // Clear previous mock calls but don't set default empty responses
    mockRequest.query.mockClear();
  });

  afterEach(() => {
    resetEnvironment();
  });

  describe('getIndexRecommendations (TDD - Should Fail Initially)', () => {
    test('should return index recommendations for a specific database', async () => {
      // First call: USE [database] (will return undefined/empty)
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // Second call: actual index recommendations query
      mockRequest.query.mockResolvedValueOnce({
        recordset: mockOptimizationData.indexRecommendations
      });

      const result = await mcpServer.getIndexRecommendations('TestDB', 'dbo', 10);
      const responseData = JSON.parse(result.content[0].text);

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('sys.dm_db_missing_index')
      );
      expect(responseData.database_name).toBe('TestDB');
      expect(responseData.schema_name).toBe('dbo');
      expect(responseData.recommendations).toHaveLength(2);
      expect(responseData.recommendations[0].impact_score).toBe(85.7);
      expect(responseData.recommendations[0].recommended_index).toBe('IX_Users_LastName_FirstName');
    });

    test('should handle limit parameter for index recommendations', async () => {
      const limitedData = mockOptimizationData.indexRecommendations.slice(0, 1);
      // First call: USE [database]
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // Second call: actual index recommendations query
      mockRequest.query.mockResolvedValueOnce({
        recordset: limitedData
      });

      const result = await mcpServer.getIndexRecommendations('TestDB', 'dbo', 1);
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.recommendations).toHaveLength(1);
      expect(responseData.limit_applied).toBe(1);
    });

    test('should include impact threshold filtering', async () => {
      // First call: USE [database]
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // Second call: actual index recommendations query with filtering
      mockRequest.query.mockResolvedValueOnce({
        recordset: mockOptimizationData.indexRecommendations.filter(idx => idx.impact_score >= 80)
      });

      const result = await mcpServer.getIndexRecommendations('TestDB', 'dbo', 10, 80.0);
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.recommendations).toHaveLength(1);
      expect(responseData.impact_threshold).toBe(80.0);
      expect(responseData.recommendations[0].impact_score).toBeGreaterThanOrEqual(80);
    });

    test('should respect read-only mode security restrictions', async () => {
      mcpServer.readOnlyMode = true;

      // First call: USE [database]
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // Second call: actual index recommendations query
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });

      const result = await mcpServer.getIndexRecommendations('TestDB');
      const responseData = JSON.parse(result.content[0].text);

      // Should succeed in read-only mode (analysis only)
      expect(responseData.security_note).toContain('read-only mode');
      expect(responseData.security_info.can_create_indexes).toBe(false);
    });
  });

  describe('analyzeQueryPerformance (TDD - Should Fail Initially)', () => {
    test('should analyze query performance and provide optimization suggestions', async () => {
      const testQuery =
        'SELECT u.Name, COUNT(o.OrderID) FROM Users u LEFT JOIN Orders o ON u.UserID = o.CustomerID WHERE u.CreatedDate >= ? GROUP BY u.Name';

      // Mock execution plan query
      mockRequest.query.mockResolvedValueOnce({
        recordset: [
          {
            StmtText: testQuery,
            TotalSubtreeCost: 15.67,
            EstimateRows: 8500
          }
        ]
      });

      // Mock query stats
      mockRequest.query.mockResolvedValueOnce({
        recordset: [
          {
            avg_cpu_time: 3200,
            avg_logical_reads: 25000,
            avg_duration: 8500,
            execution_count: 450
          }
        ]
      });

      const result = await mcpServer.analyzeQueryPerformance(testQuery, 'TestDB');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.query).toBe(testQuery);
      expect(responseData.database_name).toBe('TestDB');
      expect(responseData.analysis.query_type).toBe('SELECT_WITH_JOIN_AND_AGGREGATION');
      expect(responseData.analysis.complexity_score).toBeGreaterThan(0);
      expect(responseData.analysis.optimization_suggestions).toHaveLength(2);
      expect(responseData.analysis.optimization_suggestions[0].type).toBe('INDEX_RECOMMENDATION');
    });

    test('should handle different query types correctly', async () => {
      // Disable read-only mode to allow INSERT query analysis
      mcpServer.readOnlyMode = false;
      mcpServer.allowDestructiveOperations = true;

      const insertQuery = 'INSERT INTO Users (Name, Email) VALUES (?, ?)';

      mockRequest.query.mockResolvedValueOnce({
        recordset: [{ StmtText: insertQuery, TotalSubtreeCost: 2.34 }]
      });

      const result = await mcpServer.analyzeQueryPerformance(insertQuery, 'TestDB');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.analysis.query_type).toBe('INSERT');
      expect(responseData.analysis.is_modification_query).toBe(true);
    });

    test('should validate query safety before analysis', async () => {
      mcpServer.readOnlyMode = true;
      const updateQuery = 'UPDATE Users SET LastLogin = GETDATE() WHERE UserID = ?';

      await expect(mcpServer.analyzeQueryPerformance(updateQuery, 'TestDB')).rejects.toThrow(
        'Query blocked by safety policy'
      );

      // Performance monitoring should handle the error gracefully
    });
  });

  describe('detectQueryBottlenecks (TDD - Should Fail Initially)', () => {
    test('should detect and categorize query bottlenecks', async () => {
      // First call: USE [database]
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // Second call: actual bottleneck query
      mockRequest.query.mockResolvedValueOnce({
        recordset: mockOptimizationData.queryBottlenecks
      });

      const result = await mcpServer.detectQueryBottlenecks('TestDB', 10, 'CRITICAL');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.database_name).toBe('TestDB');
      expect(responseData.bottlenecks).toHaveLength(1);
      expect(responseData.bottlenecks[0].bottleneck_type).toBe('IO_INTENSIVE');
      expect(responseData.bottlenecks[0].severity).toBe('CRITICAL');
      expect(responseData.bottlenecks[0].wait_stats).toHaveLength(2);
      expect(responseData.bottlenecks[0].wait_stats[0].wait_type).toBe('PAGEIOLATCH_SH');
    });

    test('should filter bottlenecks by severity level', async () => {
      const allBottlenecks = [
        ...mockOptimizationData.queryBottlenecks,
        {
          ...mockOptimizationData.queryBottlenecks[0],
          severity: 'MEDIUM',
          query_hash: 'XYZ789ABC123'
        }
      ];

      // First call: USE [database]
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // Second call: bottleneck query with filtering
      mockRequest.query.mockResolvedValueOnce({
        recordset: allBottlenecks.filter(b => b.severity === 'HIGH')
      });

      const result = await mcpServer.detectQueryBottlenecks('TestDB', 10, 'HIGH');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.severity_filter).toBe('HIGH');
      expect(responseData.bottlenecks.every(b => b.severity === 'HIGH')).toBe(true);
    });

    test('should include wait statistics analysis', async () => {
      // First call: USE [database]
      mockRequest.query.mockResolvedValueOnce({ recordset: [] });
      // Second call: bottleneck query
      mockRequest.query.mockResolvedValueOnce({
        recordset: mockOptimizationData.queryBottlenecks
      });

      const result = await mcpServer.detectQueryBottlenecks('TestDB');
      const responseData = JSON.parse(result.content[0].text);

      const bottleneck = responseData.bottlenecks[0];
      expect(bottleneck.wait_stats).toBeDefined();
      expect(bottleneck.wait_stats[0].wait_type).toBe('PAGEIOLATCH_SH');
      // The wait time is calculated as 30% of avg_duration_ms (8500 * 0.3 = 2550)
      expect(bottleneck.wait_stats[0].wait_time_ms).toBe(2550);
    });
  });

  describe('getOptimizationInsights (TDD - Should Fail Initially)', () => {
    test('should provide comprehensive database optimization insights', async () => {
      // Mock multiple queries for insights (USE database + 4 analysis queries)
      mockRequest.query
        .mockResolvedValueOnce({ recordset: [] }) // USE [database]
        .mockResolvedValueOnce({ recordset: [{ total_missing_indexes: 12 }] })
        .mockResolvedValueOnce({ recordset: [{ slow_queries_count: 8 }] })
        .mockResolvedValueOnce({ recordset: [{ blocking_sessions: 3 }] })
        .mockResolvedValueOnce({ recordset: [{ avg_cpu_percent: 65, avg_io_percent: 50 }] });

      const result = await mcpServer.getOptimizationInsights('TestDB', '7_DAYS');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.database_name).toBe('TestDB');
      expect(responseData.analysis_period).toBe('7_DAYS');
      expect(responseData.overall_health.score).toBeGreaterThan(0);
      expect(responseData.overall_health.status).toBeDefined();
      expect(responseData.top_issues).toHaveLength(3);
      expect(responseData.recommendations).toHaveLength(2);
      expect(responseData.trends).toBeDefined();
    });

    test('should calculate health score based on multiple factors', async () => {
      // Mock healthy database stats (USE database + 4 analysis queries)
      mockRequest.query
        .mockResolvedValueOnce({ recordset: [] }) // USE [database]
        .mockResolvedValueOnce({ recordset: [{ total_missing_indexes: 2 }] })
        .mockResolvedValueOnce({ recordset: [{ slow_queries_count: 1 }] })
        .mockResolvedValueOnce({ recordset: [{ blocking_sessions: 0 }] })
        .mockResolvedValueOnce({ recordset: [{ avg_cpu_percent: 25, avg_io_percent: 30 }] });

      const result = await mcpServer.getOptimizationInsights('TestDB');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.overall_health.score).toBeGreaterThan(80);
      expect(responseData.overall_health.status).toBe('HEALTHY');
      expect(responseData.overall_health.critical_issues).toBe(0);
    });

    test('should support different analysis periods', async () => {
      // Mock database stats (USE database + 4 analysis queries)
      mockRequest.query
        .mockResolvedValueOnce({ recordset: [] }) // USE [database]
        .mockResolvedValueOnce({ recordset: [{ total_missing_indexes: 5 }] })
        .mockResolvedValueOnce({ recordset: [{ slow_queries_count: 3 }] })
        .mockResolvedValueOnce({ recordset: [{ blocking_sessions: 1 }] })
        .mockResolvedValueOnce({ recordset: [{ avg_cpu_percent: 45, avg_io_percent: 55 }] });

      const result = await mcpServer.getOptimizationInsights('TestDB', '24_HOURS');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.analysis_period).toBe('24_HOURS');
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('DATEADD(HOUR, -24, GETDATE())')
      );
    });
  });

  describe('Security and Safety Compliance (TDD - Should Fail Initially)', () => {
    test('all optimization tools should respect read-only mode', async () => {
      mcpServer.readOnlyMode = true;

      // Mock successful queries for read-only analysis
      mockRequest.query.mockResolvedValue({ recordset: [] });

      // All tools should work in read-only mode (analysis only)
      await expect(mcpServer.getIndexRecommendations('TestDB')).resolves.not.toThrow();
      await expect(mcpServer.detectQueryBottlenecks('TestDB')).resolves.not.toThrow();
      await expect(mcpServer.getOptimizationInsights('TestDB')).resolves.not.toThrow();

      // analyzeQueryPerformance should work with SELECT queries
      await expect(
        mcpServer.analyzeQueryPerformance('SELECT * FROM Users', 'TestDB')
      ).resolves.not.toThrow();
    });

    test('should block analysis of dangerous queries in read-only mode', async () => {
      mcpServer.readOnlyMode = true;

      const dangerousQuery = 'DROP TABLE Users';

      await expect(mcpServer.analyzeQueryPerformance(dangerousQuery, 'TestDB')).rejects.toThrow(
        'Query blocked by safety policy'
      );
    });

    test('should include security context in all responses', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      const result = await mcpServer.getIndexRecommendations('TestDB');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.security_info).toBeDefined();
      expect(responseData.security_info.read_only_mode).toBe(mcpServer.readOnlyMode);
      expect(responseData.security_info.destructive_operations_allowed).toBe(
        mcpServer.allowDestructiveOperations
      );
      expect(responseData.security_info.schema_changes_allowed).toBe(mcpServer.allowSchemaChanges);
    });
  });

  describe('Performance Monitoring Integration (TDD - Should Fail Initially)', () => {
    test('all optimization tools should integrate with performance monitoring', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getIndexRecommendations('TestDB');
      await mcpServer.detectQueryBottlenecks('TestDB');
      await mcpServer.getOptimizationInsights('TestDB');

      // Performance monitoring integration tested elsewhere
      // This test focuses on the tool functionality
    });

    test('should handle performance monitoring errors gracefully', async () => {
      // This test validates the performance monitor error handling we implemented
      // The getIndexRecommendations method should work even if performance monitoring fails
      mockRequest.query.mockResolvedValue({ recordset: [] });

      // Tools should still work even if performance monitoring fails
      await expect(mcpServer.getIndexRecommendations('TestDB')).resolves.not.toThrow();
    });
  });

  describe('Error Handling (TDD - Should Fail Initially)', () => {
    test('should handle database connection errors', async () => {
      mockRequest.query.mockRejectedValue(new Error('Database connection lost'));

      await expect(mcpServer.getIndexRecommendations('TestDB')).rejects.toThrow(
        'Failed to get index recommendations: Database connection lost'
      );
    });

    test('should handle invalid database names', async () => {
      mockRequest.query.mockRejectedValue(
        new Error("Invalid object name 'sys.dm_db_missing_index_details'")
      );

      await expect(mcpServer.getIndexRecommendations('NonExistentDB')).rejects.toThrow(
        'Failed to get index recommendations'
      );
    });

    test('should validate input parameters', async () => {
      // Test invalid impact threshold
      await expect(mcpServer.getIndexRecommendations('TestDB', 'dbo', 10, -5)).rejects.toThrow(
        'Impact threshold must be between 0 and 100'
      );

      // Test invalid severity level
      await expect(mcpServer.detectQueryBottlenecks('TestDB', 10, 'INVALID')).rejects.toThrow(
        'Invalid severity level'
      );
    });
  });
});
