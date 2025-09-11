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

    // Mock the StreamingHandler methods for testing
    if (handler.streamingHandler) {
      handler.streamingHandler.streamTableExport = vi.fn();
      handler.streamingHandler.reconstructFromChunks = vi.fn();
      // Ensure getStreamingStats always returns a valid object with required properties
      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: false,
        memoryEfficient: false,
        totalRows: 0
      });
    }
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
      // Mock getPool to simulate a connection failure
      mockConnectionManager.getPool.mockRejectedValue(error);

      await expect(handler.listDatabases()).rejects.toThrow('Connection pool exhausted');

      // Reset mock to default for other tests
      const mockPool = {
        request: vi.fn(() => mockRequest),
        connected: true,
        close: vi.fn()
      };
      mockConnectionManager.getPool.mockReturnValue(mockPool);
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

  describe('exportTableCsv', () => {
    test('should export small table data as CSV without streaming', async () => {
      const mockData = [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
      ];

      // Mock the streaming handler to return non-streaming result
      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({
        success: true,
        streaming: false,
        recordset: mockData,
        totalRows: 2,
        performance: {
          duration: 50,
          rowCount: 2,
          memoryEfficient: false
        }
      });

      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: false,
        memoryEfficient: false,
        totalRows: 2
      });

      const result = await handler.exportTableCsv('Users');

      // Verify streamTableExport was called with correct parameters
      expect(handler.streamingHandler.streamTableExport).toHaveBeenCalledWith(
        expect.any(Object),
        'Users',
        {
          schema: 'dbo',
          database: null,
          limit: null,
          outputFormat: 'csv'
        }
      );

      // Verify CSV output format
      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('id,name,email')
        }
      ]);
      expect(result[0].text).toContain('1,John Doe,john@example.com');
      expect(result[0].text).toContain('2,Jane Smith,jane@example.com');
    });

    test('should export large table data with streaming', async () => {
      // Mock streaming response with chunks
      const mockChunks = [
        {
          chunkNumber: 1,
          data: 'id,name,email\\n1,John Doe,john@example.com\\n2,Jane Smith,jane@example.com\\n',
          rowCount: 2,
          size: 65
        },
        {
          chunkNumber: 2,
          data: '3,Bob Wilson,bob@example.com\\n4,Alice Brown,alice@example.com\\n',
          rowCount: 2,
          size: 60
        }
      ];

      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({
        success: true,
        streaming: true,
        chunks: mockChunks,
        chunkCount: 2,
        totalRows: 4,
        performance: {
          duration: 120,
          rowCount: 4,
          avgBatchSize: 2,
          memoryEfficient: true
        }
      });

      // Mock getStreamingStats specifically for this test
      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: true,
        memoryEfficient: true,
        totalRows: 4,
        chunkCount: 2,
        avgChunkSize: 2
      });

      // Mock reconstructFromChunks
      handler.streamingHandler.reconstructFromChunks = vi
        .fn()
        .mockReturnValue(
          'id,name,email\\n1,John Doe,john@example.com\\n2,Jane Smith,jane@example.com\\n3,Bob Wilson,bob@example.com\\n4,Alice Brown,alice@example.com\\n'
        );

      const result = await handler.exportTableCsv('LargeTable', 'TestDB');

      // Verify streaming was used
      expect(handler.streamingHandler.streamTableExport).toHaveBeenCalledWith(
        expect.any(Object),
        'LargeTable',
        {
          schema: 'dbo',
          database: 'TestDB',
          limit: null,
          outputFormat: 'csv'
        }
      );

      expect(handler.streamingHandler.reconstructFromChunks).toHaveBeenCalledWith(
        mockChunks,
        'csv'
      );

      // Verify result structure
      expect(result).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('id,name,email')
        }
      ]);
    });

    test('should handle empty table results', async () => {
      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({
        success: true,
        streaming: false,
        totalRows: 0,
        performance: {
          duration: 10,
          rowCount: 0,
          memoryEfficient: false
        }
      });

      // Mock getStreamingStats specifically for this test
      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: false,
        memoryEfficient: false,
        totalRows: 0
      });

      const result = await handler.exportTableCsv('EmptyTable');

      expect(result).toEqual([
        {
          type: 'text',
          text: 'No data found in table'
        }
      ]);
    });

    test('should handle CSV escaping correctly', async () => {
      const mockData = [
        { id: 1, description: 'Text with, comma', notes: 'Text with "quotes"' },
        { id: 2, description: 'Text with\nnewline', notes: null }
      ];

      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({
        success: true,
        streaming: false,
        recordset: mockData,
        totalRows: 2,
        performance: { duration: 30, rowCount: 2, memoryEfficient: false }
      });

      // Mock getStreamingStats specifically for this test
      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: false,
        memoryEfficient: false,
        totalRows: 2
      });

      const result = await handler.exportTableCsv('TestTable');

      const csvText = result[0].text;
      expect(csvText).toContain('"Text with, comma"');
      expect(csvText).toContain('"Text with ""quotes"""');
      expect(csvText).toContain('"Text with\nnewline"');
      expect(csvText).toContain('2,"Text with\nnewline",'); // null becomes empty
    });

    test('should handle database switching', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });
      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({
        success: true,
        streaming: false,
        totalRows: 0,
        performance: { duration: 10, rowCount: 0, memoryEfficient: false }
      });

      // Mock getStreamingStats specifically for this test
      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: false,
        memoryEfficient: false,
        totalRows: 0
      });

      await handler.exportTableCsv('Users', 'TestDB', 'custom');

      // Verify database switch was attempted
      expect(mockRequest.query).toHaveBeenCalledWith('USE [TestDB]');

      // Verify streaming handler was called with correct parameters
      expect(handler.streamingHandler.streamTableExport).toHaveBeenCalledWith(
        expect.any(Object),
        'Users',
        {
          schema: 'custom',
          database: 'TestDB',
          limit: null,
          outputFormat: 'csv'
        }
      );
    });

    test('should apply limit when specified', async () => {
      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({
        success: true,
        streaming: false,
        totalRows: 0,
        performance: { duration: 10, rowCount: 0, memoryEfficient: false }
      });

      // Mock getStreamingStats specifically for this test
      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: false,
        memoryEfficient: false,
        totalRows: 0
      });

      await handler.exportTableCsv('Users', null, 'dbo', 100);

      expect(handler.streamingHandler.streamTableExport).toHaveBeenCalledWith(
        expect.any(Object),
        'Users',
        {
          schema: 'dbo',
          database: null,
          limit: 100,
          outputFormat: 'csv'
        }
      );
    });

    test('should record performance metrics for successful export', async () => {
      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({
        success: true,
        streaming: true,
        totalRows: 1000,
        performance: {
          duration: 250,
          rowCount: 1000,
          avgBatchSize: 100,
          memoryEfficient: true
        }
      });

      handler.streamingHandler.getStreamingStats = vi.fn().mockReturnValue({
        streaming: true,
        memoryEfficient: true,
        totalRows: 1000
      });

      await handler.exportTableCsv('LargeTable');

      expect(mockPerformanceMonitor.recordQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'export_table_csv',
          success: true,
          streaming: true,
          totalRows: 1000,
          memoryEfficient: true,
          executionTime: 250
        })
      );
    });

    test('should handle streaming export errors', async () => {
      const error = new Error('Streaming failed');
      handler.streamingHandler.streamTableExport = vi.fn().mockRejectedValue(error);

      await expect(handler.exportTableCsv('Users')).rejects.toThrow('Streaming failed');

      expect(mockPerformanceMonitor.recordQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'export_table_csv',
          success: false,
          error: 'Streaming failed',
          executionTime: 0
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
