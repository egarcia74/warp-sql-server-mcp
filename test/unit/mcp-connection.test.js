import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupMssqlMock,
  setupStdioMock,
  setupMcpTest,
  resetEnvironment,
  createTestMcpServer,
  mockPool,
  sql
} from './mcp-shared-fixtures.js';

// Setup module mocks
setupMssqlMock();
setupStdioMock();

describe('Database Connection', () => {
  let mcpServer;

  beforeEach(async () => {
    setupMcpTest();
    mcpServer = await createTestMcpServer();
  });

  afterEach(() => {
    resetEnvironment();
  });

  test('should connect to database with correct configuration', async () => {
    sql.connect.mockResolvedValue(mockPool);

    const pool = await mcpServer.connectToDatabase();

    expect(sql.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        server: 'localhost',
        port: 1433,
        database: 'master',
        user: 'testuser',
        password: 'testpass',
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          requestTimeout: 30000
        }
      })
    );
    expect(pool).toBe(mockPool);
  });

  test('should handle Windows authentication when no user/password provided', async () => {
    const mcpServerWithWindowsAuth = await createTestMcpServer({
      SQL_SERVER_USER: '',
      SQL_SERVER_PASSWORD: '',
      SQL_SERVER_DOMAIN: 'TESTDOMAIN'
    });

    sql.connect.mockResolvedValue(mockPool);

    await mcpServerWithWindowsAuth.connectToDatabase();

    expect(sql.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        authentication: {
          type: 'ntlm',
          options: {
            domain: 'TESTDOMAIN'
          }
        }
      })
    );
  });

  test('should reuse existing connection if already connected', async () => {
    mcpServer.pool = { connected: true };

    const result = await mcpServer.connectToDatabase();

    expect(sql.connect).not.toHaveBeenCalled();
    expect(result).toBe(mcpServer.pool);
  });

  test('should handle connection errors', async () => {
    const error = new Error('Connection failed');
    sql.connect.mockRejectedValue(error);

    await expect(mcpServer.connectToDatabase()).rejects.toThrow(
      'Failed to connect to SQL Server after 3 attempts: Connection failed'
    );
  });
});
