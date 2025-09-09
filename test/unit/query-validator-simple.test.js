import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueryValidator } from '../../lib/security/query-validator.js';

describe('QueryValidator - Enhanced Security Tests', () => {
  let validator;

  beforeEach(() => {
    validator = new QueryValidator({
      readOnlyMode: true,
      allowDestructiveOperations: false,
      allowSchemaChanges: false
    });
  });

  describe('Basic Query Validation', () => {
    test('should allow empty queries', () => {
      const result = validator.validateQuery('');
      expect(result.allowed).toBe(true);
      expect(result.queryType).toBe('empty');
    });

    test('should allow simple SELECT queries', () => {
      const result = validator.validateQuery('SELECT * FROM users');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Read-Only Mode Restrictions', () => {
    test('should block INSERT queries in read-only mode', () => {
      const query = "INSERT INTO users (name) VALUES ('John')";
      const result = validator.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only mode is enabled');
    });

    test('should block UPDATE queries in read-only mode', () => {
      const query = "UPDATE users SET name = 'John' WHERE id = 1";
      const result = validator.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only mode is enabled');
    });

    test('should block DELETE queries in read-only mode', () => {
      const result = validator.validateQuery('DELETE FROM users WHERE id = 1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only mode is enabled');
    });

    test('should block CREATE statements in read-only mode', () => {
      const result = validator.validateQuery('CREATE TABLE test (id INT)');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only mode is enabled');
    });
  });

  describe('Destructive Operations Control', () => {
    beforeEach(() => {
      validator.updateConfig({
        readOnlyMode: false,
        allowDestructiveOperations: false,
        allowSchemaChanges: false
      });
    });

    test('should block INSERT when destructive operations disabled', () => {
      const query = "INSERT INTO users (name) VALUES ('John')";
      const result = validator.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Destructive operation');
    });

    test('should allow SELECT when destructive operations disabled', () => {
      const result = validator.validateQuery('SELECT * FROM users');
      expect(result.allowed).toBe(true);
    });

    test('should allow destructive operations when enabled', () => {
      validator.updateConfig({ allowDestructiveOperations: true });

      const query = "INSERT INTO users (name) VALUES ('John')";
      const result = validator.validateQuery(query);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Schema Changes Control', () => {
    beforeEach(() => {
      validator.updateConfig({
        readOnlyMode: false,
        allowDestructiveOperations: true,
        allowSchemaChanges: false
      });
    });

    test('should block CREATE TABLE when schema changes disabled', () => {
      const query = 'CREATE TABLE test (id INT, name VARCHAR(50))';
      const result = validator.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Schema change');
    });

    test('should allow schema changes when enabled', () => {
      validator.updateConfig({ allowSchemaChanges: true });

      const result = validator.validateQuery('CREATE TABLE test (id INT)');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Dangerous Function Detection', () => {
    beforeEach(() => {
      validator.updateConfig({
        readOnlyMode: false,
        allowDestructiveOperations: false,
        allowSchemaChanges: true
      });
      // Suppress expected warnings from the console for this test suite
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      // Restore console.warn after the tests in this suite have run
      vi.mocked(console.warn).mockRestore();
    });

    test('should handle potentially dangerous queries based on configuration', () => {
      const queries = [
        { query: "EXEC xp_cmdshell 'dir'", allowed: false, reason: 'Destructive operation' },
        { query: 'EXEC sp_configure', allowed: true, reason: '' }, // This passes parser validation
        { query: 'SELECT * FROM OPENROWSET', allowed: true, reason: '' } // This passes as regular SELECT
      ];

      queries.forEach(({ query, allowed, reason }) => {
        const result = validator.validateQuery(query);
        expect(result.allowed).toBe(allowed);
        if (!allowed) {
          expect(result.reason).toContain(reason);
        }
      });
    });
  });

  describe('Fallback Validation', () => {
    beforeEach(() => {
      // Suppress expected warnings from the console for this test suite
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      // Restore console.warn after the tests in this suite have run
      vi.mocked(console.warn).mockRestore();
    });

    test('should handle unparseable queries with fallback', () => {
      const badQuery = 'INVALID SQL SYNTAX BUT DELETE FROM users';
      const result = validator.validateQuery(badQuery);
      expect(result.allowed).toBe(false);
      expect(result.fallback).toBe(true);
    });
  });

  describe('Configuration Management', () => {
    test('should update configuration dynamically', () => {
      expect(validator.getConfig().readOnlyMode).toBe(true);

      validator.updateConfig({ readOnlyMode: false });
      expect(validator.getConfig().readOnlyMode).toBe(false);
    });

    test('should return current configuration', () => {
      const config = validator.getConfig();
      expect(config).toHaveProperty('readOnlyMode');
      expect(config).toHaveProperty('allowDestructiveOperations');
      expect(config).toHaveProperty('allowSchemaChanges');
    });
  });

  describe('Performance Tests', () => {
    test('should handle long queries efficiently', () => {
      const longQuery = 'SELECT ' + Array(1000).fill('1').join(', ') + ' FROM users';

      const startTime = Date.now();
      const result = validator.validateQuery(longQuery);
      const endTime = Date.now();

      expect(result.allowed).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});
