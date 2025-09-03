import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import {
  setupMcpTest,
  _addSecurityPropertyOverrides,
  resetEnvironment,
  createTestMcpServer
} from './mcp-shared-fixtures.js';

/**
 * Security Validation Tests - Performance and Architecture Notes
 *
 * ⚠️ PERFORMANCE WARNING: This test suite is intentionally slower (~533ms for 38 tests)
 *
 * WHY THIS TEST IS SLOWER:
 * - Each test group calls createTestMcpServer() with different environment configurations
 * - createTestMcpServer() performs expensive operations for configuration isolation:
 *   1. setupTestEnvironment() - Modifies global process.env
 *   2. vi.resetModules() - Clears entire module cache (EXPENSIVE!)
 *   3. Dynamic re-imports of config and main modules (EXPENSIVE!)
 *   4. serverConfig.reload() - Forces config to re-read environment
 *   5. new SqlServerMCP() - Creates fresh server instance
 *
 * WHY WE CAN'T OPTIMIZE BY REUSING SERVER INSTANCES:
 *
 * The SqlServerMCP class reads configuration through a SINGLETON pattern:
 * - serverConfig is a singleton instance created on first import
 * - Configuration is cached in instance properties (readOnlyMode, etc.)
 * - Server property getters (lines 581-590 in index.js) read from this singleton
 *
 * CONFIGURATION CORRUPTION SCENARIO:
 * ```javascript
 * // Test 1: Creates server with default env (READ_ONLY=true)
 * const server1 = await createTestMcpServer();
 * expect(server1.readOnlyMode).toBe(true); // ✅ Works
 *
 * // Test 2: Changes environment but reuses server1
 * setupTestEnvironment({ SQL_SERVER_READ_ONLY: 'false' });
 * expect(server1.readOnlyMode).toBe(false); // ❌ FAILS - still returns true!
 * // server1.readOnlyMode reads from stale singleton config
 * ```
 *
 * THE MODULE RESET IS ESSENTIAL:
 * - Without vi.resetModules(), the serverConfig singleton retains old values
 * - Tests would have corrupted/stale configuration leading to false positives
 * - Environment changes wouldn't be reflected in server behavior
 * - Test isolation would be completely broken
 *
 * PERFORMANCE IS ACCEPTABLE:
 * - 533ms for 38 comprehensive security tests = ~14ms per test
 * - This covers critical security validation that must be bulletproof
 * - The cost is justified to prevent configuration corruption bugs
 *
 * 🚫 DO NOT OPTIMIZE BY:
 * - Reusing server instances across tests with different configs
 * - Skipping vi.resetModules() calls
 * - Caching servers between test groups
 * - Mocking the configuration reload process
 *
 * ✅ SAFE OPTIMIZATIONS (if needed):
 * - Group tests with identical configurations together
 * - Reduce redundant createTestMcpServer() calls within same config
 * - Use describe.sequential() for tests that must run in sequence
 * - Mock expensive parts that don't affect security validation
 */

const _originalEnv = process.env;
describe('Safety Mechanisms', () => {
  let mcpServer;

  describe('Constructor Safety Configuration', () => {
    beforeEach(() => {
      setupMcpTest();
    });

    afterEach(() => {
      resetEnvironment();
    });

    test('should enable read-only mode by default', async () => {
      const safeMcpServer = await createTestMcpServer();
      expect(safeMcpServer.readOnlyMode).toBe(true);
      expect(safeMcpServer.allowDestructiveOperations).toBe(false);
      expect(safeMcpServer.allowSchemaChanges).toBe(false);
    });

    test('should allow overriding safety settings via environment variables', async () => {
      const unsafeMcpServer = await createTestMcpServer({
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true'
      });
      expect(unsafeMcpServer.readOnlyMode).toBe(false);
      expect(unsafeMcpServer.allowDestructiveOperations).toBe(true);
      expect(unsafeMcpServer.allowSchemaChanges).toBe(true);
    });

    test('should handle mixed safety configurations', async () => {
      const mixedMcpServer = await createTestMcpServer({
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false'
      });
      expect(mixedMcpServer.readOnlyMode).toBe(false);
      expect(mixedMcpServer.allowDestructiveOperations).toBe(true);
      expect(mixedMcpServer.allowSchemaChanges).toBe(false);
    });
  });

  describe('Query Validation', () => {
    beforeEach(async () => {
      setupMcpTest();
      // Test with default safe configuration (read-only mode enabled)
      mcpServer = await createTestMcpServer();
    });

    afterEach(() => {
      resetEnvironment();
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
    beforeEach(async () => {
      setupMcpTest();
      // Test with read-only disabled but destructive operations disabled
      mcpServer = await createTestMcpServer({
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'false',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false'
      });
    });

    afterEach(() => {
      resetEnvironment();
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
    beforeEach(async () => {
      setupMcpTest();
      // Test with destructive operations enabled but schema changes disabled
      mcpServer = await createTestMcpServer({
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false'
      });
    });

    afterEach(() => {
      resetEnvironment();
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
      const validation = mcpServer.validateQuery('SELECT 1; CREATE INDEX idx_name ON users(name)');
      expect(validation.allowed).toBe(false);
      expect(validation.queryType).toBe('schema');
    });
  });

  describe('Full Access Mode', () => {
    beforeEach(async () => {
      setupMcpTest();
      // Test with all safety features disabled
      mcpServer = await createTestMcpServer({
        SQL_SERVER_READ_ONLY: 'false',
        SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'true',
        SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true'
      });
    });

    afterEach(() => {
      resetEnvironment();
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
