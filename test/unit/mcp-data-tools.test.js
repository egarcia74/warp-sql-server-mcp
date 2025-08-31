import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupMssqlMock,
  setupStdioMock,
  setupMcpTest,
  resetEnvironment,
  createTestMcpServer,
  mockPool,
  mockRequest,
  testData
} from './mcp-shared-fixtures.js';

// Setup module mocks
setupMssqlMock();
setupStdioMock();

describe('Data Tools', () => {
  let mcpServer;

  beforeEach(async () => {
    setupMcpTest();
    mcpServer = await createTestMcpServer();
    mcpServer.pool = mockPool;
  });

  afterEach(() => {
    resetEnvironment();
  });

  describe('getTableData', () => {
    test('should get table data with default limit', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTableData
      });

      const result = await mcpServer.getTableData('Users');

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT TOP 100 * FROM [dbo].[Users]');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.table).toBe('dbo.Users');
      expect(responseData.rowCount).toBe(3);
      expect(responseData.data).toEqual(testData.sampleTableData);
    });

    test('should apply WHERE clause when provided', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, 'id > 10');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT TOP 100 * FROM [dbo].[Users] WHERE id > 10'
      );
    });

    test('should handle complex WHERE clauses with AND conditions', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData(
        'Users',
        null,
        'dbo',
        50,
        "status = 'active' AND created_date > '2023-01-01'"
      );

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 50 * FROM [dbo].[Users] WHERE status = 'active' AND created_date > '2023-01-01'"
      );
    });

    test('should handle LIKE pattern matching in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, "name LIKE '%john%'");

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE name LIKE '%john%'"
      );
    });

    test('should handle NULL checks in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, 'deleted_at IS NULL');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT TOP 100 * FROM [dbo].[Users] WHERE deleted_at IS NULL'
      );
    });

    test('should handle OR conditions in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData(
        'Users',
        null,
        'dbo',
        100,
        "status = 'active' OR status = 'pending'"
      );

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE status = 'active' OR status = 'pending'"
      );
    });

    test('should handle numeric comparisons in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, 'age >= 18 AND age <= 65');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT TOP 100 * FROM [dbo].[Users] WHERE age >= 18 AND age <= 65'
      );
    });

    test('should handle date comparisons in WHERE clause', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData('Users', null, 'dbo', 100, "created_date > '2023-01-01'");

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE created_date > '2023-01-01'"
      );
    });

    test('should handle IN clause filtering', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.getTableData(
        'Users',
        null,
        'dbo',
        100,
        "status IN ('active', 'pending', 'verified')"
      );

      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE status IN ('active', 'pending', 'verified')"
      );
    });

    test('should return filtered results correctly', async () => {
      const filteredData = [
        { id: 5, name: 'Alice', status: 'active' },
        { id: 8, name: 'Bob', status: 'active' }
      ];
      mockRequest.query.mockResolvedValue({ recordset: filteredData });

      const result = await mcpServer.getTableData('Users', null, 'dbo', 100, "status = 'active'");

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.table).toBe('dbo.Users');
      expect(responseData.rowCount).toBe(2);
      expect(responseData.data).toEqual(filteredData);
      expect(mockRequest.query).toHaveBeenCalledWith(
        "SELECT TOP 100 * FROM [dbo].[Users] WHERE status = 'active'"
      );
    });
  });

  describe('explainQuery', () => {
    test('should generate execution plan for query', async () => {
      const mockPlan = [
        {
          StmtText: 'SELECT * FROM Users',
          StmtId: 1,
          NodeId: 1,
          Parent: 0,
          PhysicalOp: 'Clustered Index Scan',
          LogicalOp: 'Clustered Index Scan',
          EstimateCPU: 0.001,
          EstimateIO: 0.003125,
          EstimateRows: 100
        }
      ];

      // Mock the sequence of queries for explain plan
      mockRequest.query
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL ON
        .mockResolvedValueOnce({ recordset: mockPlan, recordsets: [mockPlan] }) // The actual query plan
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }); // Cost query

      const result = await mcpServer.explainQuery('SELECT * FROM Users');

      expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_ALL ON');
      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM Users');
      expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_ALL OFF');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.query).toBe('SELECT * FROM Users');
      expect(responseData.execution_plan).toEqual(mockPlan);
      expect(responseData.plan_type).toBe('estimated');
    });

    test('should generate actual execution plan when requested', async () => {
      const mockPlan = [
        {
          StmtText: 'SELECT * FROM Users',
          ActualRows: 95,
          ActualExecutions: 1,
          ActualCPU: 0.002,
          ActualIO: 0.003
        }
      ];

      mockRequest.query
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS IO ON
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS TIME ON
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL ON
        .mockResolvedValueOnce({ recordset: mockPlan, recordsets: [mockPlan] }) // The actual query plan
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET SHOWPLAN_ALL OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS IO OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }) // SET STATISTICS TIME OFF
        .mockResolvedValueOnce({ recordset: [], recordsets: [[]] }); // Cost query

      const result = await mcpServer.explainQuery('SELECT * FROM Users', null, true);

      expect(mockRequest.query).toHaveBeenCalledWith('SET STATISTICS IO ON');
      expect(mockRequest.query).toHaveBeenCalledWith('SET STATISTICS TIME ON');
      expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_ALL ON');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.plan_type).toBe('actual');
      expect(responseData.execution_plan).toEqual(mockPlan);
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [], recordsets: [[]] });

      await mcpServer.explainQuery('SELECT 1', 'TestDB');

      expect(mockRequest.query).toHaveBeenCalledWith('USE [TestDB]');
    });

    test('should handle explain query errors', async () => {
      const error = new Error('Query plan generation failed');
      mockRequest.query.mockRejectedValue(error);

      await expect(mcpServer.explainQuery('INVALID SQL')).rejects.toThrow(
        'Failed to explain query: Query plan generation failed'
      );
    });
  });

  describe('listForeignKeys', () => {
    beforeEach(() => {
      // Mock performance monitoring for listForeignKeys
      mcpServer.performanceMonitor = {
        startQuery: vi.fn(() => 'query_id_123'),
        endQuery: vi.fn()
      };
    });

    test('should list foreign key relationships', async () => {
      const mockForeignKeys = [
        {
          constraint_name: 'FK_Orders_Users',
          parent_table: 'Orders',
          parent_column: 'user_id',
          referenced_table: 'Users',
          referenced_column: 'id',
          on_delete: 'CASCADE',
          on_update: 'NO ACTION',
          is_disabled: false
        },
        {
          constraint_name: 'FK_OrderItems_Orders',
          parent_table: 'OrderItems',
          parent_column: 'order_id',
          referenced_table: 'Orders',
          referenced_column: 'id',
          on_delete: 'CASCADE',
          on_update: 'NO ACTION',
          is_disabled: false
        }
      ];

      mockRequest.query.mockResolvedValue({
        recordset: mockForeignKeys
      });

      const result = await mcpServer.listForeignKeys();

      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('sys.foreign_keys'));
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE s.name = 'dbo'")
      );

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.schema).toBe('dbo');
      expect(responseData.foreign_keys).toEqual(mockForeignKeys);
      expect(responseData.count).toBe(2);
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.listForeignKeys('TestDB', 'custom');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
    });

    test('should handle custom schema', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.listForeignKeys(null, 'custom');

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE s.name = 'custom'")
      );
    });
  });

  describe('exportTableCsv', () => {
    beforeEach(() => {
      // Mock performance monitoring for exportTableCsv
      mcpServer.performanceMonitor = {
        startQuery: vi.fn(() => 'query_id_123'),
        endQuery: vi.fn()
      };
    });

    test('should export table data as CSV', async () => {
      const mockData = [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
      ];

      mockRequest.query.mockResolvedValue({
        recordset: mockData
      });

      const result = await mcpServer.exportTableCsv('Users');

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM [dbo].[Users]');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.table).toBe('dbo.Users');
      expect(responseData.format).toBe('csv');
      expect(responseData.row_count).toBe(2);
      expect(responseData.column_count).toBe(3);
      expect(responseData.csv_data).toContain('id,name,email');
      expect(responseData.csv_data).toContain('1,John Doe,john@example.com');
      expect(responseData.csv_data).toContain('2,Jane Smith,jane@example.com');
    });

    test('should apply limit when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.exportTableCsv('Users', null, 'dbo', 50);

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT TOP 50 * FROM [dbo].[Users]');
    });

    test('should apply WHERE clause when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.exportTableCsv('Users', null, 'dbo', null, 'active = 1');

      expect(mockRequest.query).toHaveBeenCalledWith(
        'SELECT * FROM [dbo].[Users] WHERE active = 1'
      );
    });

    test('should handle CSV escaping correctly', async () => {
      const mockData = [
        { id: 1, description: 'Text with, comma', notes: 'Text with "quotes"' },
        { id: 2, description: 'Text with\nnewline', notes: null }
      ];

      mockRequest.query.mockResolvedValue({
        recordset: mockData
      });

      const result = await mcpServer.exportTableCsv('TestTable');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.csv_data).toContain('"Text with, comma"');
      expect(responseData.csv_data).toContain('"Text with ""quotes"""');
      // The newline character should be handled by the CSV generation logic
      expect(responseData.csv_data).toContain('2,"Text with\nnewline",');
    });

    test('should handle empty table', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: []
      });

      const result = await mcpServer.exportTableCsv('EmptyTable');

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData.row_count).toBe(0);
      expect(responseData.csv_data).toBe('');
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.exportTableCsv('Users', 'TestDB');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
    });

    describe('CSV Export Filtering Tests', () => {
      test('should handle simple WHERE clause in CSV export', async () => {
        const mockData = [{ id: 5, name: 'Active User', status: 'active' }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        const result = await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "status = 'active'"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE status = 'active'"
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.row_count).toBe(1);
        expect(responseData.csv_data).toContain('5,Active User,active');
      });

      test('should handle complex AND/OR conditions in CSV export', async () => {
        const mockData = [
          { id: 1, name: 'Alice', status: 'active', age: 25 },
          { id: 2, name: 'Bob', status: 'active', age: 30 }
        ];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', 100, "status = 'active' AND age > 20");

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT TOP 100 * FROM [dbo].[Users] WHERE status = 'active' AND age > 20"
        );
      });

      test('should handle LIKE patterns in CSV export WHERE clause', async () => {
        const mockData = [{ id: 1, name: 'John Doe', email: 'john@example.com' }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', null, "email LIKE '%@example.com'");

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE email LIKE '%@example.com'"
        );
      });

      test('should handle NULL checks in CSV export WHERE clause', async () => {
        const mockData = [{ id: 1, name: 'Active User', deleted_at: null }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', null, 'deleted_at IS NULL');

        expect(mockRequest.query).toHaveBeenCalledWith(
          'SELECT * FROM [dbo].[Users] WHERE deleted_at IS NULL'
        );
      });

      test('should handle date range filtering in CSV export', async () => {
        const mockData = [{ id: 1, name: 'Recent User', created_date: '2023-06-15' }];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "created_date BETWEEN '2023-01-01' AND '2023-12-31'"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE created_date BETWEEN '2023-01-01' AND '2023-12-31'"
        );
      });

      test('should handle IN clause filtering in CSV export', async () => {
        const mockData = [
          { id: 1, name: 'Admin User', role: 'admin' },
          { id: 2, name: 'Manager User', role: 'manager' }
        ];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "role IN ('admin', 'manager', 'supervisor')"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE role IN ('admin', 'manager', 'supervisor')"
        );
      });

      test('should combine WHERE clause with LIMIT correctly in CSV export', async () => {
        const mockData = [
          { id: 10, name: 'User 10', status: 'active' },
          { id: 20, name: 'User 20', status: 'active' }
        ];
        mockRequest.query.mockResolvedValue({ recordset: mockData });

        await mcpServer.exportTableCsv('Users', null, 'dbo', 50, "status = 'active'");

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT TOP 50 * FROM [dbo].[Users] WHERE status = 'active'"
        );

        const result = await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          50,
          "status = 'active'"
        );
        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.row_count).toBe(2);
      });

      test('should handle empty results from filtered CSV export', async () => {
        mockRequest.query.mockResolvedValue({ recordset: [] });

        const result = await mcpServer.exportTableCsv(
          'Users',
          null,
          'dbo',
          null,
          "status = 'nonexistent'"
        );

        expect(mockRequest.query).toHaveBeenCalledWith(
          "SELECT * FROM [dbo].[Users] WHERE status = 'nonexistent'"
        );

        const responseData = JSON.parse(result.content[0].text);
        expect(responseData.row_count).toBe(0);
        expect(responseData.csv_data).toBe('');
      });
    });

    describe('CSV Export Error Handling', () => {
      test('should handle database connection errors during CSV export', async () => {
        // Simulate a database connection failure
        mockPool.request.mockImplementation(() => {
          throw new Error('Database connection lost');
        });
        mcpServer.pool = mockPool;

        await expect(mcpServer.exportTableCsv('Users', null, 'dbo', null, null)).rejects.toThrow(
          'Failed to export table as CSV: Database connection lost'
        );
      });

      test('should handle SQL query errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi.fn().mockRejectedValue(new Error("Invalid object name 'NonExistentTable'"))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('NonExistentTable', null, 'dbo', null, null)
        ).rejects.toThrow("Failed to export table as CSV: Invalid object name 'NonExistentTable'");
      });

      test('should handle permission errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi
            .fn()
            .mockRejectedValue(new Error("SELECT permission denied on object 'SecureTable'"))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('SecureTable', null, 'dbo', null, null)
        ).rejects.toThrow(
          "Failed to export table as CSV: SELECT permission denied on object 'SecureTable'"
        );
      });

      test('should handle timeout errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi.fn().mockRejectedValue(new Error('Timeout expired'))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('LargeTable', null, 'dbo', 1000000, null)
        ).rejects.toThrow('Failed to export table as CSV: Timeout expired');
      });

      test('should handle invalid WHERE clause syntax errors during CSV export', async () => {
        const mockRequestWithError = {
          ...mockRequest,
          timeout: 30000,
          query: vi.fn().mockRejectedValue(new Error("Incorrect syntax near 'INVALID'"))
        };
        mockPool.request.mockReturnValue(mockRequestWithError);
        mcpServer.pool = mockPool;

        await expect(
          mcpServer.exportTableCsv('Users', null, 'dbo', null, 'INVALID SYNTAX HERE')
        ).rejects.toThrow("Failed to export table as CSV: Incorrect syntax near 'INVALID'");
      });
    });
  });
});
