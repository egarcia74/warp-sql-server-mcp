import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import sql from 'mssql';

// Mock mssql module
vi.mock('mssql', () => {
  const mockRequest = {
    parent: {},
    query: vi.fn(),
    on: vi.fn(),
    stream: false
  };

  return {
    default: {
      Request: vi.fn(() => mockRequest)
    }
  };
});

import { StreamingHandler } from '../../lib/utils/streaming-handler.js';

describe('StreamingHandler', () => {
  let handler;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Create a fresh handler instance
    handler = new StreamingHandler();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with default configuration', () => {
      const config = handler.getConfig();
      expect(config.batchSize).toBe(1000);
      expect(config.maxMemoryMB).toBe(50);
      expect(config.maxResponseSize).toBe(1000000);
      expect(config.enableStreaming).toBe(true);
    });

    it('should override defaults with custom config', () => {
      const customHandler = new StreamingHandler({
        batchSize: 500,
        maxMemoryMB: 100,
        maxResponseSize: 2000000,
        enableStreaming: false
      });
      
      const config = customHandler.getConfig();
      expect(config.batchSize).toBe(500);
      expect(config.maxMemoryMB).toBe(100);
      expect(config.maxResponseSize).toBe(2000000);
      expect(config.enableStreaming).toBe(false);
    });

    it('should update configuration', () => {
      handler.updateConfig({ batchSize: 2000, enableStreaming: false });
      const config = handler.getConfig();
      expect(config.batchSize).toBe(2000);
      expect(config.enableStreaming).toBe(false);
      expect(config.maxMemoryMB).toBe(50); // Should preserve existing values
    });
  });

  describe('shouldStreamQuery', () => {
    let mockSqlRequest;

    beforeEach(() => {
      mockSqlRequest = {
        query: vi.fn()
      };
    });

    it('should return false when streaming is disabled', async () => {
      handler.updateConfig({ enableStreaming: false });
      const result = await handler.shouldStreamQuery(mockSqlRequest, 'SELECT * FROM users');
      expect(result).toBe(false);
    });

    it('should return true when forceStreaming is set', async () => {
      const context = { forceStreaming: true };
      const result = await handler.shouldStreamQuery(mockSqlRequest, 'SELECT id FROM users', context);
      expect(result).toBe(true);
    });

    it('should return true for SELECT * without WHERE clause', async () => {
      const result = await handler.shouldStreamQuery(mockSqlRequest, 'SELECT * FROM large_table');
      expect(result).toBe(true);
    });

    it('should return true for queries with BULK operations', async () => {
      const result = await handler.shouldStreamQuery(mockSqlRequest, 'BULK INSERT data FROM file');
      expect(result).toBe(true);
    });

    it('should return true for EXPORT operations', async () => {
      const result = await handler.shouldStreamQuery(mockSqlRequest, 'EXPORT TABLE users TO csv');
      expect(result).toBe(true);
    });

    it('should return true for BACKUP operations', async () => {
      const result = await handler.shouldStreamQuery(mockSqlRequest, 'BACKUP DATABASE test TO disk');
      expect(result).toBe(true);
    });

    it('should check table size and stream for large tables', async () => {
      const context = { tableName: 'large_table', schema: 'dbo' };
      
      // Mock table size query result - large table
      mockSqlRequest.query.mockResolvedValue({
        recordset: [{ estimated_rows: 50000, estimated_size_mb: 25 }]
      });

      const result = await handler.shouldStreamQuery(mockSqlRequest, 'SELECT * FROM large_table', context);
      expect(result).toBe(true);
      expect(mockSqlRequest.query).toHaveBeenCalledWith(expect.stringContaining('sys.tables'));
    });

    it('should not stream for small tables', async () => {
      const context = { tableName: 'small_table', schema: 'dbo' };
      
      // Mock table size query result - small table
      mockSqlRequest.query.mockResolvedValue({
        recordset: [{ estimated_rows: 100, estimated_size_mb: 1 }]
      });

      const result = await handler.shouldStreamQuery(mockSqlRequest, 'SELECT * FROM small_table', context);
      expect(result).toBe(false);
    });

    it('should handle errors in table size estimation gracefully', async () => {
      const context = { tableName: 'unknown_table', schema: 'dbo' };
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Mock query failure
      mockSqlRequest.query.mockRejectedValue(new Error('Table not found'));

      const result = await handler.shouldStreamQuery(mockSqlRequest, 'SELECT * FROM unknown_table', context);
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not determine table size'), expect.any(String));
      
      consoleSpy.mockRestore();
    });

    it('should return false for regular SELECT queries with conditions', async () => {
      const result = await handler.shouldStreamQuery(mockSqlRequest, 'SELECT id, name FROM users WHERE active = 1');
      expect(result).toBe(false);
    });
  });

  describe('executeRegularQuery', () => {
    it('should execute regular query and return formatted result', async () => {
      const mockSqlRequest = {
        query: vi.fn().mockResolvedValue({
          recordset: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }],
          recordsets: [[{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }]],
          rowsAffected: [2]
        })
      };

      const startTime = Date.now() - 100;
      const result = await handler.executeRegularQuery(
        mockSqlRequest, 
        'SELECT * FROM users', 
        {}, 
        startTime
      );

      expect(result.success).toBe(true);
      expect(result.recordset).toHaveLength(2);
      expect(result.streaming).toBe(false);
      expect(result.performance.duration).toBeGreaterThanOrEqual(0);
      expect(result.performance.rowCount).toBe(2);
      expect(result.performance.memoryUsed).toBeGreaterThan(0);
    });

    it('should handle empty results', async () => {
      const mockSqlRequest = {
        query: vi.fn().mockResolvedValue({
          recordset: [],
          recordsets: [[]],
          rowsAffected: [0]
        })
      };

      const result = await handler.executeRegularQuery(mockSqlRequest, 'SELECT * FROM empty_table');
      
      expect(result.success).toBe(true);
      expect(result.recordset).toEqual([]);
      expect(result.performance.rowCount).toBe(0);
    });
  });

  describe('executeStreamingQuery', () => {
    it('should execute streaming query with event-based processing', async () => {
      const mockColumns = { id: { name: 'id' }, name: { name: 'name' } };
      const mockRows = [
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' },
        { id: 3, name: 'Bob' }
      ];

      const mockStreamRequest = {
        on: vi.fn(),
        query: vi.fn(),
        stream: false
      };
      
      sql.Request.mockReturnValue(mockStreamRequest);

      // Mock event handlers
      let recordsetHandler, rowHandler, doneHandler;
      mockStreamRequest.on.mockImplementation((event, handler) => {
        if (event === 'recordset') recordsetHandler = handler;
        if (event === 'row') rowHandler = handler;
        if (event === 'done') doneHandler = handler;
      });

      const queryPromise = handler.executeStreamingQuery(
        { parent: {} },
        'SELECT * FROM large_table',
        { outputFormat: 'json' },
        Date.now() - 50
      );

      // Simulate streaming events
      recordsetHandler(mockColumns);
      mockRows.forEach(row => rowHandler(row));
      doneHandler({ rowsAffected: [3] });

      const result = await queryPromise;

      expect(result.success).toBe(true);
      expect(result.streaming).toBe(true);
      expect(result.totalRows).toBe(3);
      expect(result.chunkCount).toBe(1);
      expect(result.chunks).toHaveLength(1);
      expect(result.performance.memoryEfficient).toBe(true);
      expect(mockStreamRequest.stream).toBe(true);
    });

    it('should process multiple batches', async () => {
      handler.updateConfig({ batchSize: 2 });
      
      const mockStreamRequest = {
        on: vi.fn(),
        query: vi.fn(),
        stream: false
      };
      
      sql.Request.mockReturnValue(mockStreamRequest);

      let rowHandler, doneHandler;
      mockStreamRequest.on.mockImplementation((event, handler) => {
        if (event === 'row') rowHandler = handler;
        if (event === 'done') doneHandler = handler;
      });

      const queryPromise = handler.executeStreamingQuery(
        { parent: {} },
        'SELECT * FROM large_table',
        {},
        Date.now()
      );

      // Simulate 5 rows (should create 3 batches: 2+2+1)
      for (let i = 1; i <= 5; i++) {
        rowHandler({ id: i, name: `User${i}` });
      }
      doneHandler({ rowsAffected: [5] });

      const result = await queryPromise;

      expect(result.totalRows).toBe(5);
      expect(result.chunkCount).toBe(3); // 2 full batches + 1 partial
      expect(result.chunks).toHaveLength(3);
      expect(result.performance.avgBatchSize).toBeCloseTo(5/3, 1);
    });

    it('should handle streaming errors', async () => {
      const mockStreamRequest = {
        on: vi.fn(),
        query: vi.fn(),
        stream: false
      };
      
      sql.Request.mockReturnValue(mockStreamRequest);

      let errorHandler;
      mockStreamRequest.on.mockImplementation((event, handler) => {
        if (event === 'error') errorHandler = handler;
      });

      const queryPromise = handler.executeStreamingQuery(
        { parent: {} },
        'SELECT * FROM nonexistent_table',
        {},
        Date.now()
      );

      // Simulate error
      const testError = new Error('Table does not exist');
      errorHandler(testError);

      await expect(queryPromise).rejects.toThrow('Table does not exist');
    });
  });

  describe('executeQueryWithStreaming', () => {
    it('should choose streaming for queries that should stream', async () => {
      const mockSqlRequest = { parent: {}, query: vi.fn() };
      
      // Mock shouldStreamQuery to return true
      const shouldStreamSpy = vi.spyOn(handler, 'shouldStreamQuery').mockResolvedValue(true);
      const executeStreamingSpy = vi.spyOn(handler, 'executeStreamingQuery').mockResolvedValue({
        success: true,
        streaming: true,
        chunks: []
      });

      await handler.executeQueryWithStreaming(mockSqlRequest, 'SELECT * FROM large_table');

      expect(shouldStreamSpy).toHaveBeenCalled();
      expect(executeStreamingSpy).toHaveBeenCalled();
    });

    it('should choose regular execution for queries that should not stream', async () => {
      const mockSqlRequest = { 
        parent: {}, 
        query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] })
      };
      
      // Mock shouldStreamQuery to return false
      const shouldStreamSpy = vi.spyOn(handler, 'shouldStreamQuery').mockResolvedValue(false);
      const executeRegularSpy = vi.spyOn(handler, 'executeRegularQuery');

      await handler.executeQueryWithStreaming(mockSqlRequest, 'SELECT id FROM users WHERE id = 1');

      expect(shouldStreamSpy).toHaveBeenCalled();
      expect(executeRegularSpy).toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    it('should process batch in default format', () => {
      const batch = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];
      const chunks = [];
      const context = {};

      handler.processBatch(batch, chunks, 1, context);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkNumber).toBe(1);
      expect(chunks[0].data).toEqual(batch);
      expect(chunks[0].rowCount).toBe(2);
      expect(chunks[0].size).toBeGreaterThan(0);
    });

    it('should process batch in CSV format', () => {
      const batch = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];
      const chunks = [];
      const context = { outputFormat: 'csv' };

      // Mock batchToCsv method
      const csvSpy = vi.spyOn(handler, 'batchToCsv').mockReturnValue('1,John\\n2,Jane\\n');

      handler.processBatch(batch, chunks, 1, context);

      expect(csvSpy).toHaveBeenCalledWith(batch, context);
      expect(chunks[0].data).toBe('1,John\\n2,Jane\\n');
    });

    it('should process batch in JSON format', () => {
      const batch = [{ id: 1, name: 'John' }];
      const chunks = [];
      const context = { outputFormat: 'json' };

      // Mock batchToJson method
      const jsonSpy = vi.spyOn(handler, 'batchToJson').mockReturnValue('[{"id":1,"name":"John"}]');

      handler.processBatch(batch, chunks, 1, context);

      expect(jsonSpy).toHaveBeenCalledWith(batch, context);
      expect(chunks[0].data).toBe('[{"id":1,"name":"John"}]');
    });
  });

  describe('batchToCsv', () => {
    it('should convert batch to CSV format', () => {
      const batch = [
        { id: 1, name: 'John', age: 30 },
        { id: 2, name: 'Jane', age: 25 }
      ];
      const context = {};

      const csvData = handler.batchToCsv(batch, context);

      expect(csvData).toContain('id,name,age\\n');
      expect(csvData).toContain('1,John,30\\n');
      expect(csvData).toContain('2,Jane,25\\n');
      expect(context.csvHeaderAdded).toBe(true);
    });

    it('should not add header for subsequent batches', () => {
      const batch = [{ id: 3, name: 'Bob', age: 35 }];
      const context = { csvHeaderAdded: true };

      const csvData = handler.batchToCsv(batch, context);

      expect(csvData).not.toContain('id,name,age');
      expect(csvData).toBe('3,Bob,35\\n');
    });

    it('should handle null and undefined values', () => {
      const batch = [{ id: 1, name: null, description: undefined, active: true }];
      const context = {};

      const csvData = handler.batchToCsv(batch, context);

      expect(csvData).toContain('1,,true\\n');
    });

    it('should escape CSV special characters', () => {
      const batch = [{ 
        id: 1, 
        name: 'John, Jr.', 
        note: 'Has "quotes" and\\nnewlines',
        simple: 'no-escaping-needed'
      }];
      const context = {};

      const csvData = handler.batchToCsv(batch, context);

      expect(csvData).toContain('"John, Jr."');
      expect(csvData).toContain('"Has ""quotes"" and\\\\nnewlines"');
      expect(csvData).toContain('no-escaping-needed');
    });

    it('should return empty string for empty batch', () => {
      const csvData = handler.batchToCsv([], {});
      expect(csvData).toBe('');
    });
  });

  describe('batchToJson', () => {
    it('should convert batch to compact JSON', () => {
      const batch = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];
      const context = {};

      const jsonData = handler.batchToJson(batch, context);

      expect(jsonData).toBe('[{"id":1,"name":"John"},{"id":2,"name":"Jane"}]');
      expect(jsonData).not.toContain('\\n'); // No pretty printing
    });

    it('should convert batch to pretty JSON when requested', () => {
      const batch = [{ id: 1, name: 'John' }];
      const context = { prettyPrint: true };

      const jsonData = handler.batchToJson(batch, context);

      expect(jsonData).toContain('\\n'); // Should have newlines
      expect(jsonData).toContain('  '); // Should have indentation
    });
  });

  describe('streamTableExport', () => {
    it('should export table with streaming', async () => {
      const mockSqlRequest = { 
        query: vi.fn().mockResolvedValue({}),
        parent: {}
      };

      // Mock executeQueryWithStreaming
      const executeStreamingSpy = vi.spyOn(handler, 'executeQueryWithStreaming')
        .mockResolvedValue({ success: true, streaming: true });

      const result = await handler.streamTableExport(mockSqlRequest, 'users', {
        schema: 'dbo',
        database: 'testdb',
        limit: 1000,
        whereClause: 'active = 1',
        outputFormat: 'csv'
      });

      expect(mockSqlRequest.query).toHaveBeenCalledWith('USE [testdb]');
      expect(executeStreamingSpy).toHaveBeenCalledWith(
        mockSqlRequest,
        'SELECT TOP 1000 * FROM [dbo].[users] WHERE active = 1',
        expect.objectContaining({
          tableName: 'users',
          schema: 'dbo',
          database: 'testdb',
          outputFormat: 'csv',
          forceStreaming: true
        })
      );
      expect(result.success).toBe(true);
    });

    it('should export table without database switching', async () => {
      const mockSqlRequest = { 
        query: vi.fn(),
        parent: {}
      };

      const executeStreamingSpy = vi.spyOn(handler, 'executeQueryWithStreaming')
        .mockResolvedValue({ success: true });

      await handler.streamTableExport(mockSqlRequest, 'products');

      expect(mockSqlRequest.query).not.toHaveBeenCalledWith(expect.stringContaining('USE'));
      expect(executeStreamingSpy).toHaveBeenCalledWith(
        mockSqlRequest,
        'SELECT * FROM [dbo].[products]',
        expect.any(Object)
      );
    });

    it('should handle table export without WHERE clause', async () => {
      const mockSqlRequest = { query: vi.fn(), parent: {} };
      const executeStreamingSpy = vi.spyOn(handler, 'executeQueryWithStreaming')
        .mockResolvedValue({ success: true });

      await handler.streamTableExport(mockSqlRequest, 'orders', { schema: 'sales' });

      expect(executeStreamingSpy).toHaveBeenCalledWith(
        mockSqlRequest,
        'SELECT * FROM [sales].[orders]',
        expect.any(Object)
      );
    });
  });

  describe('estimateMemoryUsage', () => {
    it('should estimate memory usage for recordset', () => {
      const recordset = [
        { id: 1, name: 'John', email: 'john@example.com' },
        { id: 2, name: 'Jane', email: 'jane@example.com' },
        { id: 3, name: 'Bob', email: 'bob@example.com' }
      ];

      const memoryMB = handler.estimateMemoryUsage(recordset);
      
      expect(memoryMB).toBeGreaterThan(0);
      expect(typeof memoryMB).toBe('number');
    });

    it('should return 0 for empty recordset', () => {
      expect(handler.estimateMemoryUsage([])).toBe(0);
      expect(handler.estimateMemoryUsage(null)).toBe(0);
      expect(handler.estimateMemoryUsage(undefined)).toBe(0);
    });

    it('should use sampling for large recordsets', () => {
      // Create a large recordset (>100 rows)
      const largeRecordset = Array.from({ length: 1000 }, (_, i) => ({ 
        id: i, 
        data: `record_${i}` 
      }));

      const memoryMB = handler.estimateMemoryUsage(largeRecordset);
      
      expect(memoryMB).toBeGreaterThan(0);
      // Memory estimate should be reasonable for 1000 records
      expect(memoryMB).toBeLessThan(100); // Should be much less than 100MB for simple records
    });
  });

  describe('reconstructFromChunks', () => {
    it('should reconstruct JSON data from chunks', () => {
      const chunks = [
        { data: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }] },
        { data: [{ id: 3, name: 'Bob' }, { id: 4, name: 'Alice' }] }
      ];

      const reconstructed = handler.reconstructFromChunks(chunks, 'json');
      
      expect(reconstructed).toHaveLength(4);
      expect(reconstructed[0]).toEqual({ id: 1, name: 'John' });
      expect(reconstructed[3]).toEqual({ id: 4, name: 'Alice' });
    });

    it('should reconstruct CSV data from chunks', () => {
      const chunks = [
        { data: 'id,name\\n1,John\\n2,Jane\\n' },
        { data: '3,Bob\\n4,Alice\\n' }
      ];

      const reconstructed = handler.reconstructFromChunks(chunks, 'csv');
      
      expect(reconstructed).toBe('id,name\\n1,John\\n2,Jane\\n3,Bob\\n4,Alice\\n');
    });

    it('should reconstruct raw data from chunks', () => {
      const chunks = [
        { data: [{ id: 1 }, { id: 2 }] },
        { data: [{ id: 3 }] }
      ];

      const reconstructed = handler.reconstructFromChunks(chunks, 'raw');
      
      expect(reconstructed).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it('should handle JSON string chunks', () => {
      const chunks = [
        { data: '[{"id":1}]' },
        { data: '[{"id":2}]' }
      ];

      const reconstructed = handler.reconstructFromChunks(chunks, 'json');
      
      expect(reconstructed).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should return empty result for empty chunks', () => {
      expect(handler.reconstructFromChunks([], 'json')).toEqual([]);
      expect(handler.reconstructFromChunks([], 'csv')).toBe('');
      expect(handler.reconstructFromChunks(null, 'json')).toEqual([]);
    });
  });

  describe('getStreamingStats', () => {
    it('should return non-streaming stats', () => {
      const result = { streaming: false, rowCount: 100 };
      const stats = handler.getStreamingStats(result);
      
      expect(stats.streaming).toBe(false);
      expect(stats.memoryEfficient).toBe(false);
      expect(stats.totalRows).toBe(100);
    });

    it('should return streaming stats', () => {
      const result = {
        streaming: true,
        totalRows: 10000,
        chunkCount: 10,
        performance: { duration: 5000 }
      };
      
      const stats = handler.getStreamingStats(result);
      
      expect(stats.streaming).toBe(true);
      expect(stats.memoryEfficient).toBe(true);
      expect(stats.totalRows).toBe(10000);
      expect(stats.chunkCount).toBe(10);
      expect(stats.avgChunkSize).toBe(1000);
      expect(stats.performance).toEqual({ duration: 5000 });
    });

    it('should handle streaming result without row count', () => {
      const result = { streaming: false };
      const stats = handler.getStreamingStats(result);
      
      expect(stats.totalRows).toBe(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle configuration edge cases', () => {
      const edgeHandler = new StreamingHandler({
        batchSize: 0,
        maxMemoryMB: -1,
        enableStreaming: null
      });
      
      const config = edgeHandler.getConfig();
      expect(config.batchSize).toBe(0); // Should accept 0 even if not practical
      expect(config.maxMemoryMB).toBe(-1); // Should accept negative values
      expect(config.enableStreaming).toBe(null); // Should accept null
    });

    it('should handle malformed SQL in streaming detection', async () => {
      const mockSqlRequest = { query: vi.fn() };
      const result = await handler.shouldStreamQuery(mockSqlRequest, '');
      expect(result).toBe(false);
    });
  });
});
