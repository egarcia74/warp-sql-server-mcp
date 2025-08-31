import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the mssql module first
vi.mock('mssql', () => ({
  default: {
    connect: vi.fn(),
    ConnectionPool: vi.fn()
  },
  connect: vi.fn(),
  ConnectionPool: vi.fn()
}));

// Mock StdioServerTransport
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(() => ({
    connect: vi.fn()
  }))
}));

import { SqlServerMCP } from '../../index.js';

const originalEnv = process.env;

describe('Safety Mechanisms', () => {
  let mcpServer;

  describe('Constructor Safety Configuration', () => {
    afterEach(() => {
      // Clean up environment variables after each test in this suite
      process.env = originalEnv;
    });

    test('should enable read-only mode by default', () => {
      const safeMcpServer = new SqlServerMCP();
      expect(safeMcpServer.readOnlyMode).toBe(true);
      expect(safeMcpServer.allowDestructiveOperations).toBe(false);
      expect(safeMcpServer.allowSchemaChanges).toBe(false);
    });

    test('should allow overriding safety settings via environment variables', () => {
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';

      const unsafeMcpServer = new SqlServerMCP();
      expect(unsafeMcpServer.readOnlyMode).toBe(false);
      expect(unsafeMcpServer.allowDestructiveOperations).toBe(true);
      expect(unsafeMcpServer.allowSchemaChanges).toBe(true);
    });

    test('should handle mixed safety configurations', () => {
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';

      const mixedMcpServer = new SqlServerMCP();
      expect(mixedMcpServer.readOnlyMode).toBe(false);
      expect(mixedMcpServer.allowDestructiveOperations).toBe(true);
      expect(mixedMcpServer.allowSchemaChanges).toBe(false);
    });
  });

  describe('Query Validation', () => {
    beforeEach(() => {
      // Reset environment to remove any safety overrides
      process.env = {
        ...originalEnv,
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'master',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass'
      };
      
      // Explicitly delete safety environment variables to ensure defaults
      delete process.env.SQL_SERVER_READ_ONLY;
      delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
      delete process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES;
      
      vi.clearAllMocks();
      vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
      
      // Test with default safe configuration
      mcpServer = new SqlServerMCP();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('should allow SELECT queries in read-only mode', () => {
      const validation = mcpServer.validateQuery('SELECT * FROM users');
      expect(validation.allowed).toBe(true);
      expect(validation.reason).toBe('Query validation passed');
    });

    test('should allow SELECT with JOIN in read-only mode', () => {
      const validation = mcpServer.validateQuery(`
        SELECT u.name, o.total 
        FROM users u 
        JOIN orders o ON u.id = o.user_id
      `);
      expect(validation.allowed).toBe(true);
    });

    test('should allow CTE queries in read-only mode', () => {
      const validation = mcpServer.validateQuery(`
        WITH UserStats AS (
          SELECT user_id, COUNT(*) as order_count
          FROM orders
          GROUP BY user_id
        )
        SELECT * FROM UserStats
      `);
      expect(validation.allowed).toBe(true);
    });

    test('should block INSERT queries in read-only mode', () => {
      const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('John')");
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain('Read-only mode is enabled');
      expect(validation.queryType).toBe('non-select');
    });

    test('should block UPDATE queries in read-only mode', () => {
      const validation = mcpServer.validateQuery("UPDATE users SET name = 'Jane' WHERE id = 1");
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain('Read-only mode is enabled');
      expect(validation.queryType).toBe('non-select');
    });

    test('should block DELETE queries in read-only mode', () => {
      const validation = mcpServer.validateQuery('DELETE FROM users WHERE id = 1');
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain('Read-only mode is enabled');
      expect(validation.queryType).toBe('non-select');
    });

    test('should block TRUNCATE queries in read-only mode', () => {
      const validation = mcpServer.validateQuery('TRUNCATE TABLE users');
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain('Read-only mode is enabled');
      expect(validation.queryType).toBe('non-select');
    });

    test('should block stored procedure execution in read-only mode', () => {
      const validation = mcpServer.validateQuery('EXEC UpdateUserStats');
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain('Read-only mode is enabled');
      expect(validation.queryType).toBe('non-select');
    });

    test('should block CREATE statements in read-only mode', () => {
      const validation = mcpServer.validateQuery('CREATE TABLE test (id INT)');
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain('Read-only mode is enabled');
      expect(validation.queryType).toBe('non-select');
    });

    test('should handle case-insensitive queries', () => {
      const validation = mcpServer.validateQuery("insert into users (name) values ('test')");
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('non-select');
    });

    test('should handle queries with leading whitespace', () => {
      const validation = mcpServer.validateQuery('   DELETE FROM users');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('non-select');
    });

    test('should allow empty queries', () => {
      const validation = mcpServer.validateQuery('');
      expect(validation.allowed).toBe(true);
      expect(validation.reason).toBe('Empty query');
    });

    test('should allow whitespace-only queries', () => {
      const validation = mcpServer.validateQuery('   \n\t  ');
      expect(validation.allowed).toBe(true);
      expect(validation.reason).toBe('Empty query');
    });
  });

  describe('Destructive Operations Control', () => {
    beforeEach(() => {
      // Test with read-only disabled but destructive operations disabled
      process.env = {
        ...originalEnv,
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'master',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass',
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'false',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false'
      };
      
      vi.clearAllMocks();
      vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
      
      mcpServer = new SqlServerMCP();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('should allow SELECT queries when read-only is disabled', () => {
      const validation = mcpServer.validateQuery('SELECT * FROM users');
      expect(validation.allowed).toBe(true);
    });

    test('should block INSERT when destructive operations disabled', () => {
      const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('test')");
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain(
        'Destructive operations (INSERT/UPDATE/DELETE) are disabled'
      );
      expect(validation.queryType).toBe('destructive');
    });

    test('should block UPDATE when destructive operations disabled', () => {
      const validation = mcpServer.validateQuery("UPDATE users SET name = 'test'");
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('destructive');
    });

    test('should block DELETE when destructive operations disabled', () => {
      const validation = mcpServer.validateQuery('DELETE FROM users');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('destructive');
    });

    test('should block TRUNCATE when destructive operations disabled', () => {
      const validation = mcpServer.validateQuery('TRUNCATE TABLE users');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('destructive');
    });

    test('should block EXECUTE/EXEC when destructive operations disabled', () => {
      const validation = mcpServer.validateQuery('EXECUTE sp_updatestats');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('destructive');
    });

    test('should detect multi-statement destructive queries', () => {
      const validation = mcpServer.validateQuery('SELECT 1; DELETE FROM users');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('destructive');
    });
  });

  describe('Schema Changes Control', () => {
    beforeEach(() => {
      // Test with destructive operations enabled but schema changes disabled
      process.env = {
        ...originalEnv,
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'master',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass',
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false'
      };
      
      vi.clearAllMocks();
      vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
      
      mcpServer = new SqlServerMCP();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('should allow data operations when schema changes disabled', () => {
      const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('test')");
      expect(validation.allowed).toBe(true);
    });

    test('should block CREATE TABLE when schema changes disabled', () => {
      const validation = mcpServer.validateQuery('CREATE TABLE test (id INT)');
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain('Schema changes (CREATE/DROP/ALTER) are disabled');
      expect(validation.queryType).toBe('schema');
    });

    test('should block DROP TABLE when schema changes disabled', () => {
      const validation = mcpServer.validateQuery('DROP TABLE users');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('schema');
    });

    test('should block ALTER TABLE when schema changes disabled', () => {
      const validation = mcpServer.validateQuery('ALTER TABLE users ADD COLUMN age INT');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('schema');
    });

    test('should block GRANT statements when schema changes disabled', () => {
      const validation = mcpServer.validateQuery('GRANT SELECT ON users TO testuser');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('schema');
    });

    test('should block REVOKE statements when schema changes disabled', () => {
      const validation = mcpServer.validateQuery('REVOKE SELECT ON users FROM testuser');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('schema');
    });

    test('should detect multi-statement schema changes', () => {
      const validation = mcpServer.validateQuery(
        'SELECT 1; CREATE INDEX idx_name ON users(name)'
      );
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('schema');
    });
  });

  describe('Full Access Mode', () => {
    beforeEach(() => {
      // Test with all safety features disabled
      process.env = {
        ...originalEnv,
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PORT: '1433',
        SQL_SERVER_DATABASE: 'master',
        SQL_SERVER_USER: 'testuser',
        SQL_SERVER_PASSWORD: 'testpass',
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true'
      };
      
      vi.clearAllMocks();
      vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
      
      mcpServer = new SqlServerMCP();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('should allow SELECT queries in full access mode', () => {
      const validation = mcpServer.validateQuery('SELECT * FROM users');
      expect(validation.allowed).toBe(true);
    });

    test('should allow INSERT queries in full access mode', () => {
      const validation = mcpServer.validateQuery("INSERT INTO users (name) VALUES ('test')");
      expect(validation.allowed).toBe(true);
    });

    test('should allow UPDATE queries in full access mode', () => {
      const validation = mcpServer.validateQuery("UPDATE users SET name = 'test'");
      expect(validation.allowed).toBe(true);
    });

    test('should allow DELETE queries in full access mode', () => {
      const validation = mcpServer.validateQuery('DELETE FROM users WHERE id = 1');
      expect(validation.allowed).toBe(true);
    });

    test('should allow CREATE TABLE in full access mode', () => {
      const validation = mcpServer.validateQuery('CREATE TABLE test (id INT, name VARCHAR(100))');
      expect(validation.allowed).toBe(true);
    });

    test('should allow DROP TABLE in full access mode', () => {
      const validation = mcpServer.validateQuery('DROP TABLE test');
      expect(validation.allowed).toBe(true);
    });

    test('should allow ALTER TABLE in full access mode', () => {
      const validation = mcpServer.validateQuery('ALTER TABLE users ADD COLUMN age INT');
      expect(validation.allowed).toBe(true);
    });

    test('should allow GRANT/REVOKE in full access mode', () => {
      expect(mcpServer.validateQuery('GRANT SELECT ON users TO testuser').allowed).toBe(true);
      expect(mcpServer.validateQuery('REVOKE SELECT ON users FROM testuser').allowed).toBe(true);
    });
  });
});
