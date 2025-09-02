import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockData,
  createMockConnectionManager,
  createMockPerformanceMonitor,
  createMockRequest,
  _expectToolSuccess,
  _expectToolError,
  cleanupMocks
} from './fixtures/modern-fixtures.js';

describe('DatabaseToolsHandler', () => {
  let handler;
  let mockConnectionManager;
  let mockPerformanceMonitor;
  let mockRequest;

  beforeEach(async () => {
    mockRequest = createMockRequest();
    const mockPool = {
      request: vi.fn(() => mockRequest),
      connected: true,
      close: vi.fn()
    };

    mockConnectionManager = createMockConnectionManager(mockPool);
    mockPerformanceMonitor = createMockPerformanceMonitor();

    // Import and create handler
    const { DatabaseToolsHandler } = await import('../../lib/tools/handlers/database-tools.js');
    handler = new DatabaseToolsHandler(mockConnectionManager, mockPerformanceMonitor);
  });

  afterEach(() => {
    cleanupMocks();
  });

  describe('listDatabases', () => {
    test('should list databases successfully', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.databases
      });

      const result = await handler.listDatabases();

      // Verify the query was called correctly
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('sys.databases'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('WHERE name NOT IN'));

      // Verify response structure
      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('database_name')
        }
      ]);
      expect(result[0].text).toContain('TestDB1');
      expect(result[0].text).toContain('TestDB2');
    });

    test('should handle database query errors', async () => {
      const error = new Error('Database connection failed');
      mockRequest.query.mockRejectedValue(error);

      await expect(handler.listDatabases()).rejects.toThrow('Database connection failed');
    });

    test('should record performance metrics', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await handler.listDatabases();

      expect(mockPerformanceMonitor.recordQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_databases',
          executionTime: expect.any(Number),
          success: true,
          query: expect.any(String),
          timestamp: expect.any(Date)
        })
      );
    });
  });

  describe('listTables', () => {
    test('should list tables with default schema', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.tables
      });

      const result = await handler.listTables();

      // Verify query structure
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('INFORMATION_SCHEMA.TABLES')
      );
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE t.TABLE_SCHEMA = 'dbo'")
      );

      // Verify response
      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('schema_name')
        }
      ]);
      expect(result[0].text).toContain('Users');
      expect(result[0].text).toContain('Orders');
    });

    test('should list tables with specific database', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.tables
      });

      const result = await handler.listTables('TestDB', 'custom');

      // Verify database-specific query
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('[TestDB].INFORMATION_SCHEMA.TABLES')
      );
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE t.TABLE_SCHEMA = 'custom'")
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('schema_name')
        }
      ]);
    });

    test('should handle empty results', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: []
      });

      const result = await handler.listTables();

      expect(result).toEqual([
        {
          type: 'text',
          text: 'No data returned'
        }
      ]);
    });
  });

  describe('describeTable', () => {
    test('should describe table schema', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.tableSchema
      });

      const result = await handler.describeTable('Users');

      // Verify query includes necessary joins for primary key info
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('INFORMATION_SCHEMA.COLUMNS')
      );
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('PRIMARY KEY'));
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE c.TABLE_NAME = 'Users'")
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('column_name')
        }
      ]);
      expect(result[0].text).toContain('id');
      expect(result[0].text).toContain('name');
    });

    test('should describe table in specific database', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.tableSchema
      });

      const result = await handler.describeTable('Users', 'TestDB', 'custom');

      // Verify database-specific query
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('[TestDB].INFORMATION_SCHEMA.COLUMNS')
      );
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("c.TABLE_SCHEMA = 'custom'")
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('column_name')
        }
      ]);
    });

    test('should handle non-existent tables', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: []
      });

      const result = await handler.describeTable('NonExistentTable');

      expect(result).toEqual([
        {
          type: 'text',
          text: 'No data returned'
        }
      ]);
    });
  });

  describe('listForeignKeys', () => {
    test('should list foreign keys with default schema', async () => {
      const mockForeignKeys = [
        {
          foreign_key_name: 'FK_Orders_Users',
          parent_table: 'Orders',
          parent_column: 'user_id',
          referenced_table: 'Users',
          referenced_column: 'id'
        }
      ];

      mockRequest.query.mockResolvedValue({
        recordset: mockForeignKeys
      });

      const result = await handler.listForeignKeys();

      // Verify sys.foreign_keys query
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('sys.foreign_keys'));
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE s.name = 'dbo'")
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('foreign_key_name')
        }
      ]);
      expect(result[0].text).toContain('FK_Orders_Users');
      expect(result[0].text).toContain('Orders');
    });

    test('should list foreign keys in specific database', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: []
      });

      const result = await handler.listForeignKeys('TestDB', 'custom');

      // Verify database-specific query
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('[TestDB].sys.foreign_keys')
      );
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE s.name = 'custom'")
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: 'No data returned'
        }
      ]);
    });
  });

  describe('getTableData', () => {
    test('should get table data with default pagination', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.tableData
      });

      const result = await handler.getTableData('Users');

      // Verify pagination query
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('SELECT *'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('[dbo].[Users]'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('OFFSET 0 ROWS'));
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('FETCH NEXT 100 ROWS ONLY')
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('id')
        }
      ]);
      expect(result[0].text).toContain('John Doe');
      expect(result[0].text).toContain('Jane Smith');
    });

    test('should get table data with custom pagination', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.tableData.slice(0, 2)
      });

      const result = await handler.getTableData('Users', null, 'dbo', 2, 1);

      // Verify custom pagination
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('OFFSET 1 ROWS'));
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('FETCH NEXT 2 ROWS ONLY')
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('id')
        }
      ]);
    });

    test('should get table data from specific database', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: mockData.tableData
      });

      const result = await handler.getTableData('Users', 'TestDB', 'custom');

      // Verify database-specific query
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('[TestDB].[custom].[Users]')
      );

      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('id')
        }
      ]);
    });
  });

  describe('error handling', () => {
    test('should handle connection manager errors', async () => {
      const error = new Error('Connection pool exhausted');
      mockConnectionManager.connect.mockRejectedValue(error);

      await expect(handler.listDatabases()).rejects.toThrow('Connection pool exhausted');
    });

    test('should handle SQL syntax errors', async () => {
      const sqlError = new Error('Invalid column name');
      sqlError.code = 'EREQUEST';
      mockRequest.query.mockRejectedValue(sqlError);

      await expect(handler.listTables()).rejects.toThrow('Invalid column name');
    });

    test('should record failed queries in performance monitor', async () => {
      const error = new Error('Query failed');
      mockRequest.query.mockRejectedValue(error);

      await expect(handler.listDatabases()).rejects.toThrow('Query failed');

      expect(mockPerformanceMonitor.recordQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_databases',
          success: false,
          error: 'Query failed',
          executionTime: expect.any(Number)
        })
      );
    });
  });

  describe('performance monitoring integration', () => {
    test('should record query metrics for successful operations', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await handler.listDatabases();
      await handler.listTables();
      await handler.describeTable('Users');

      expect(mockPerformanceMonitor.recordQuery).toHaveBeenCalledTimes(3);
      expect(mockPerformanceMonitor.recordQuery).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ tool: 'list_databases', success: true })
      );
      expect(mockPerformanceMonitor.recordQuery).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ tool: 'list_tables', success: true })
      );
      expect(mockPerformanceMonitor.recordQuery).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ tool: 'describe_table', success: true })
      );
    });

    test('should record timing information', async () => {
      mockRequest.query.mockImplementation(async () => {
        // Simulate query delay
        await new Promise(resolve => setTimeout(resolve, 10));
        return { recordset: [] };
      });

      await handler.listDatabases();

      expect(mockPerformanceMonitor.recordQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_databases',
          executionTime: expect.any(Number),
          success: true
        })
      );

      // Verify timing is reasonable (should be >= 8ms due to our delay, allowing some variance)
      const [queryParams] = mockPerformanceMonitor.recordQuery.mock.calls[0];
      expect(queryParams.executionTime).toBeGreaterThanOrEqual(8);
    });
  });
});
