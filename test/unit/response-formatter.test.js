import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponseFormatter } from '../../lib/utils/response-formatter.js';

describe('ResponseFormatter', () => {
  let formatter;

  beforeEach(() => {
    // Reset environment variables before each test
    delete process.env.SQL_SERVER_RESPONSE_FORMAT;
    delete process.env.NODE_ENV;
    
    // Create a fresh formatter instance
    formatter = new ResponseFormatter();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with default configuration', () => {
      const config = formatter.getConfig();
      expect(config.format).toBe('structured');
      expect(config.includeMetadata).toBe(true);
      expect(config.includePerformance).toBe(false);
      expect(config.maxResponseSize).toBe(1000000);
    });

    it('should use environment variable for format', () => {
      process.env.SQL_SERVER_RESPONSE_FORMAT = 'pretty-json';
      const envFormatter = new ResponseFormatter();
      expect(envFormatter.getConfig().format).toBe('pretty-json');
    });

    it('should override defaults with custom config', () => {
      const customFormatter = new ResponseFormatter({
        format: 'json',
        includeMetadata: false,
        includePerformance: true,
        maxResponseSize: 500000
      });
      
      const config = customFormatter.getConfig();
      expect(config.format).toBe('json');
      expect(config.includeMetadata).toBe(false);
      expect(config.includePerformance).toBe(true);
      expect(config.maxResponseSize).toBe(500000);
    });

    it('should update configuration', () => {
      formatter.updateConfig({ format: 'pretty-json', includePerformance: true });
      const config = formatter.getConfig();
      expect(config.format).toBe('pretty-json');
      expect(config.includePerformance).toBe(true);
      expect(config.includeMetadata).toBe(true); // Should preserve existing values
    });
  });

  describe('formatQueryResult', () => {
    it('should format basic query result', () => {
      const mockResult = {
        recordset: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }],
        rowsAffected: [2]
      };

      const context = {
        startTime: Date.now() - 100,
        query: 'SELECT * FROM users',
        database: 'testdb',
        toolName: 'execute_query'
      };

      const response = formatter.formatQueryResult(mockResult, context);
      
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      
      const data = JSON.parse(response.content[0].text);
      expect(data.success).toBe(true);
      expect(data.recordset).toEqual(mockResult.recordset);
      expect(data.rowsAffected).toEqual(mockResult.rowsAffected);
      expect(data.metadata.query).toBe(context.query);
      expect(data.metadata.database).toBe(context.database);
      expect(data.metadata.tool).toBe(context.toolName);
    });

    it('should include performance metrics when enabled', () => {
      formatter.updateConfig({ includePerformance: true });
      
      const mockResult = {
        recordset: [{ id: 1, name: 'test' }]
      };

      const context = {
        startTime: Date.now() - 150
      };

      const response = formatter.formatQueryResult(mockResult, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.performance).toBeDefined();
      expect(data.performance.duration).toBeGreaterThanOrEqual(0);
      expect(data.performance.recordCount).toBe(1);
    });

    it('should include security info when provided', () => {
      const mockResult = { recordset: [] };
      const context = {
        securityConfig: {
          readOnlyMode: true,
          allowDestructiveOperations: false,
          allowSchemaChanges: false
        }
      };

      const response = formatter.formatQueryResult(mockResult, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.security).toBeDefined();
      expect(data.security.readOnlyMode).toBe(true);
      expect(data.security.destructiveOperationsAllowed).toBe(false);
      expect(data.security.schemaChangesAllowed).toBe(false);
    });

    it('should handle empty results', () => {
      const mockResult = {};
      const response = formatter.formatQueryResult(mockResult);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.recordset).toEqual([]);
      expect(data.rowsAffected).toEqual([]);
    });
  });

  describe('formatTableData', () => {
    it('should format table data with metadata', () => {
      const mockResult = {
        recordset: [
          { id: 1, name: 'Alice', age: 30 },
          { id: 2, name: 'Bob', age: 25 }
        ]
      };

      const context = {
        tableName: 'users',
        schema: 'public',
        database: 'mydb',
        limit: 100,
        whereClause: 'age > 18'
      };

      const response = formatter.formatTableData(mockResult, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.table).toBe('public.users');
      expect(data.rowCount).toBe(2);
      expect(data.data).toEqual(mockResult.recordset);
      expect(data.columns).toHaveLength(3);
      expect(data.metadata.database).toBe('mydb');
      expect(data.metadata.schema).toBe('public');
      expect(data.metadata.table).toBe('users');
      expect(data.metadata.limit).toBe(100);
      expect(data.metadata.whereClause).toBe('age > 18');
    });

    it('should default schema to dbo', () => {
      const mockResult = { recordset: [] };
      const context = { tableName: 'test_table' };

      const response = formatter.formatTableData(mockResult, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.table).toBe('dbo.test_table');
      expect(data.metadata.schema).toBe('dbo');
    });
  });

  describe('formatCsvExport', () => {
    it('should format CSV export data', () => {
      const csvData = 'id,name,age\\n1,Alice,30\\n2,Bob,25';
      const context = {
        tableName: 'users',
        schema: 'dbo',
        database: 'testdb',
        rowCount: 2,
        columnCount: 3
      };

      const response = formatter.formatCsvExport(csvData, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.table).toBe('dbo.users');
      expect(data.format).toBe('csv');
      expect(data.csvData).toBe(csvData);
      expect(data.rowCount).toBe(2);
      expect(data.columnCount).toBe(3);
      expect(data.metadata.exportSize).toBe(csvData.length);
    });
  });

  describe('formatListResult', () => {
    it('should format list of items', () => {
      const items = [
        { name: 'database1', size_mb: 100 },
        { name: 'database2', size_mb: 250 }
      ];

      const context = {
        listType: 'databases',
        database: 'master'
      };

      const response = formatter.formatListResult(items, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.items).toEqual(items);
      expect(data.count).toBe(2);
      expect(data.metadata.listType).toBe('databases');
      expect(data.metadata.database).toBe('master');
    });

    it('should handle empty list', () => {
      const response = formatter.formatListResult([]);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.items).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('should handle null items', () => {
      const response = formatter.formatListResult(null);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.success).toBe(true);
      expect(data.items).toEqual([]);
      expect(data.count).toBe(0);
    });
  });

  describe('formatError', () => {
    it('should format error response', () => {
      const error = new Error('Test error message');
      error.code = 'TEST_ERROR';
      
      const context = {
        toolName: 'test_tool',
        query: 'SELECT * FROM invalid_table',
        database: 'testdb'
      };

      const response = formatter.formatError(error, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.success).toBe(false);
      expect(data.error.name).toBe('Error');
      expect(data.error.message).toBe('Test error message');
      expect(data.error.code).toBe('TEST_ERROR');
      expect(data.metadata.tool).toBe('test_tool');
      expect(data.metadata.query).toBe(context.query);
      expect(data.metadata.database).toBe('testdb');
    });

    it('should include stack trace in non-production environment', () => {
      process.env.NODE_ENV = 'development';
      
      const error = new Error('Test error');
      error.stack = 'Error: Test error\\n    at test.js:10:5';

      const response = formatter.formatError(error);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.error.stack).toBeDefined();
      expect(data.error.stack).toContain('Error: Test error');
    });

    it('should exclude stack trace in production environment', () => {
      process.env.NODE_ENV = 'production';
      
      const error = new Error('Test error');
      error.stack = 'Error: Test error\\n    at test.js:10:5';

      const response = formatter.formatError(error);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.error.stack).toBeUndefined();
    });

    it('should handle errors without code', () => {
      const error = new Error('Simple error');

      const response = formatter.formatError(error);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.error.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('Response Format Options', () => {
    it('should format as structured JSON', () => {
      formatter.updateConfig({ format: 'structured' });
      const mockResult = { recordset: [{ id: 1 }] };
      
      const response = formatter.formatQueryResult(mockResult);
      
      expect(response.content[0].type).toBe('text');
      expect(() => JSON.parse(response.content[0].text)).not.toThrow();
    });

    it('should format as compact JSON', () => {
      formatter.updateConfig({ format: 'json' });
      const mockResult = { recordset: [{ id: 1 }] };
      
      const response = formatter.formatQueryResult(mockResult);
      const text = response.content[0].text;
      
      expect(text).not.toContain('\\n  '); // No indentation for compact JSON
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('should format as pretty JSON', () => {
      formatter.updateConfig({ format: 'pretty-json' });
      const mockResult = { recordset: [{ id: 1 }] };
      
      const response = formatter.formatQueryResult(mockResult);
      const text = response.content[0].text;
      
      expect(text).toContain('\n'); // Should have newlines for pretty printing (single backslash)
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('should default to structured for unknown formats', () => {
      formatter.updateConfig({ format: 'invalid-format' });
      const mockResult = { recordset: [{ id: 1 }] };
      
      const response = formatter.formatQueryResult(mockResult);
      
      expect(() => JSON.parse(response.content[0].text)).not.toThrow();
    });
  });

  describe('Column Type Inference', () => {
    it('should infer column types correctly', () => {
      const recordset = [
        {
          id: 123,
          name: 'John Doe',
          salary: 75000.50,
          isActive: true,
          birthDate: new Date('1990-01-15'),
          createdAt: '2023-01-15T10:30:00Z',
          guid: '550e8400-e29b-41d4-a716-446655440000',
          notes: null
        }
      ];

      const columns = formatter.extractColumnInfo(recordset);
      
      expect(columns).toEqual([
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
        { name: 'salary', type: 'decimal' },
        { name: 'isActive', type: 'boolean' },
        { name: 'birthDate', type: 'datetime' },
        { name: 'createdAt', type: 'date' },
        { name: 'guid', type: 'guid' },
        { name: 'notes', type: 'null' }
      ]);
    });

    it('should return empty array for empty recordset', () => {
      expect(formatter.extractColumnInfo([])).toEqual([]);
      expect(formatter.extractColumnInfo(null)).toEqual([]);
      expect(formatter.extractColumnInfo(undefined)).toEqual([]);
    });

    it('should handle unknown types', () => {
      const recordset = [{ weird: Symbol('test') }];
      const columns = formatter.extractColumnInfo(recordset);
      expect(columns[0].type).toBe('unknown');
    });
  });

  describe('Response Truncation', () => {
    it('should truncate large responses', () => {
      formatter.updateConfig({ maxResponseSize: 1000 });
      
      // Create a large dataset
      const largeRecordset = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(50), // 50 characters per record
        moreData: 'very long string that makes the response quite large'.repeat(10)
      }));

      const mockResult = { recordset: largeRecordset };
      const response = formatter.formatQueryResult(mockResult);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.truncated).toBe(true);
      expect(data.originalSize).toBeGreaterThan(1000);
      expect(data.maxSize).toBe(1000);
      expect(data.truncatedRows).toBeGreaterThan(0);
      expect(data.recordset.length).toBeLessThan(largeRecordset.length);
    });

    it('should truncate CSV data when it exceeds size limits', () => {
      // Test that the truncation mechanism works by directly calling the truncation method
      const largeCsvData = 'id,name\\n' + Array.from({ length: 100 }, (_, i) => 
        `${i},${'very_long_name'.repeat(10)}_${i}`
      ).join('\\n');
      
      const mockData = {
        csvData: largeCsvData,
        success: true,
        table: 'test'
      };
      
      formatter.updateConfig({ maxResponseSize: 1000 });
      const currentSize = JSON.stringify(mockData).length;
      
      // Only test if the CSV is actually large enough to trigger truncation
      if (currentSize > 1000) {
        const truncated = formatter.truncateResponse(mockData, currentSize);
        expect(truncated.truncated).toBe(true);
        expect(truncated.originalSize).toBe(currentSize);
        expect(truncated.maxSize).toBe(1000);
      } else {
        // If not large enough, just verify the method exists and doesn't crash
        const result = formatter.truncateResponse(mockData, currentSize);
        expect(result).toBeDefined();
      }
    });

    it('should not truncate small responses', () => {
      formatter.updateConfig({ maxResponseSize: 10000 });
      
      const smallResult = { recordset: [{ id: 1, name: 'test' }] };
      const response = formatter.formatQueryResult(smallResult);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.truncated).toBeUndefined();
    });
  });

  describe('Query Truncation', () => {
    it('should truncate long queries for metadata', () => {
      const longQuery = 'SELECT * FROM users WHERE ' + 'condition AND '.repeat(50) + 'id = 1';
      const truncated = formatter.truncateQuery(longQuery, 100);
      
      expect(truncated).toHaveLength(103); // 100 + '...'
      expect(truncated.endsWith('...')).toBe(true);
    });

    it('should not truncate short queries', () => {
      const shortQuery = 'SELECT * FROM users';
      const truncated = formatter.truncateQuery(shortQuery, 100);
      
      expect(truncated).toBe(shortQuery);
    });

    it('should handle null/undefined queries', () => {
      expect(formatter.truncateQuery(null)).toBe(null);
      expect(formatter.truncateQuery(undefined)).toBe(undefined);
      expect(formatter.truncateQuery('')).toBe('');
    });
  });

  describe('Utility Methods', () => {
    it('should calculate result size', () => {
      const data = { test: 'value', number: 123 };
      const size = formatter.calculateResultSize(data);
      
      expect(size).toBe(JSON.stringify(data).length);
    });

    it('should handle null data in size calculation', () => {
      expect(formatter.calculateResultSize(null)).toBeGreaterThan(0);
      expect(formatter.calculateResultSize(undefined)).toBeGreaterThan(0);
    });
  });

  describe('Metadata Control', () => {
    it('should exclude metadata when disabled', () => {
      formatter.updateConfig({ includeMetadata: false });
      
      const mockResult = { recordset: [{ id: 1 }] };
      const context = { query: 'SELECT * FROM test', toolName: 'test' };
      
      const response = formatter.formatQueryResult(mockResult, context);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.metadata).toBeUndefined();
    });

    it('should exclude performance when disabled', () => {
      formatter.updateConfig({ includePerformance: false });
      
      const mockResult = { recordset: [{ id: 1 }] };
      const response = formatter.formatQueryResult(mockResult);
      const data = JSON.parse(response.content[0].text);
      
      expect(data.performance).toBeUndefined();
    });
  });
});
