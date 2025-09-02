import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  setupMssqlMock,
  setupStdioMock,
  setupMcpTest,
  resetEnvironment,
  createTestMcpServerV4,
  mockPool,
  mockRequest,
  testData
} from './mcp-shared-fixtures.js';

// Setup module mocks
setupMssqlMock();
setupStdioMock();

describe('Core SQL Tools', () => {
  let mcpServer;

  beforeEach(async () => {
    setupMcpTest();
    mcpServer = await createTestMcpServerV4();
    mcpServer.pool = mockPool;
  });

  afterEach(() => {
    resetEnvironment();
  });

  describe('executeQuery', () => {
    test('should execute query successfully', async () => {
      const mockResult = {
        recordset: [{ id: 1, name: 'test' }],
        recordsets: [[{ id: 1, name: 'test' }]],
        rowsAffected: [1]
      };
      mockRequest.query.mockResolvedValue(mockResult);

      const result = await mcpServer.executeQuery('SELECT * FROM test');

      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM test');
      expect(result.content[0].text).toContain('recordset');
      expect(result.content[0].text).toContain('rowsAffected');
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [],
        recordsets: [[]],
        rowsAffected: [0]
      });

      await mcpServer.executeQuery('SELECT 1', 'TestDB');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
      expect(mockRequest.query).toHaveBeenNthCalledWith(2, 'SELECT 1');
    });

    test('should handle query execution errors', async () => {
      const error = new Error('SQL syntax error');
      mockRequest.query.mockRejectedValue(error);

      await expect(mcpServer.executeQuery('SELECT * FROM nonexistent_table')).rejects.toThrow(
        'Query execution failed: SQL syntax error'
      );
    });

    test('should include safety info in successful query responses', async () => {
      // Configure for full access mode
      const fullAccessServer = await createTestMcpServerV4({
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true'
      });
      fullAccessServer.pool = mockPool;

      const mockResult = {
        recordset: [{ id: 1, name: 'test' }],
        recordsets: [[{ id: 1, name: 'test' }]],
        rowsAffected: [1]
      };
      mockRequest.query.mockResolvedValue(mockResult);

      const result = await fullAccessServer.executeQuery('SELECT * FROM test');
      const responseData = JSON.parse(result.content[0].text);

      expect(responseData.safetyInfo).toBeDefined();
      expect(responseData.safetyInfo.readOnlyMode).toBe(false);
      expect(responseData.safetyInfo.destructiveOperationsAllowed).toBe(true);
      expect(responseData.safetyInfo.schemaChangesAllowed).toBe(true);
    });

    test('should block unsafe queries with safety validation', async () => {
      // Test with default safe configuration
      const safeServer = await createTestMcpServerV4();
      safeServer.pool = mockPool;

      await expect(safeServer.executeQuery('DELETE FROM users')).rejects.toThrow(
        'Query blocked by safety policy: Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.'
      );

      // Verify the actual SQL query was never executed
      expect(mockRequest.query).not.toHaveBeenCalledWith('DELETE FROM users');
    });

    test('should allow safe queries in read-only mode', async () => {
      // Test with default safe configuration
      const safeServer = await createTestMcpServerV4();
      safeServer.pool = mockPool;

      const mockResult = {
        recordset: [{ id: 1, name: 'test' }],
        recordsets: [[{ id: 1, name: 'test' }]],
        rowsAffected: [1]
      };
      mockRequest.query.mockResolvedValue(mockResult);

      const result = await safeServer.executeQuery('SELECT * FROM test');
      const responseData = JSON.parse(result.content[0].text);

      expect(mockRequest.query).toHaveBeenCalledWith('SELECT * FROM test');
      expect(responseData.safetyInfo.readOnlyMode).toBe(true);
      expect(responseData.safetyInfo.destructiveOperationsAllowed).toBe(false);
      expect(responseData.safetyInfo.schemaChangesAllowed).toBe(false);
    });
  });

  describe('listDatabases', () => {
    test('should list databases successfully', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleDatabases
      });

      const result = await mcpServer.listDatabases();

      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('sys.databases'));

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toEqual(testData.sampleDatabases);
    });

    test('should exclude system databases', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleDatabases
      });

      await mcpServer.listDatabases();

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')")
      );
    });
  });

  describe('listTables', () => {
    test('should list tables with default schema', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTables
      });

      const result = await mcpServer.listTables();

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE t.TABLE_SCHEMA = 'dbo'")
      );

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toEqual(testData.sampleTables);
    });

    test('should switch database when specified', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      await mcpServer.listTables('TestDB', 'dbo');

      expect(mockRequest.query).toHaveBeenNthCalledWith(1, 'USE [TestDB]');
    });
  });

  describe('describeTable', () => {
    test('should describe table schema successfully', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTableSchema
      });

      const result = await mcpServer.describeTable('Users');

      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('INFORMATION_SCHEMA.COLUMNS')
      );
      expect(mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE c.TABLE_NAME = 'Users'")
      );

      const responseData = JSON.parse(result.content[0].text);
      expect(responseData).toEqual(testData.sampleTableSchema);
    });

    test('should include primary key information', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: testData.sampleTableSchema
      });

      await mcpServer.describeTable('Users');

      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('PRIMARY KEY'));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('is_primary_key'));
    });
  });
});
