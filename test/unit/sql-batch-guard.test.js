import { describe, it, expect } from 'vitest';
import {
  findForbiddenBatchStatement,
  stripSqlLiteralsAndComments
} from '../../lib/security/sql-batch-guard.js';

/**
 * Direct unit tests for the whole-batch keyword guard. Previously this module
 * was only exercised indirectly through SqlServerMCP.validateQuery
 * (test/unit/index.test.js). These tests pin the exported functions:
 *   - stripSqlLiteralsAndComments (the fail-closed lexer)
 *   - findForbiddenBatchStatement (tier classification + leading-statement rule)
 */

const READ_ONLY = {
  readOnlyMode: true,
  allowDestructiveOperations: false,
  allowSchemaChanges: false
};
const DML_ALLOWED = {
  readOnlyMode: false,
  allowDestructiveOperations: true,
  allowSchemaChanges: false
};
const DDL_ALLOWED = {
  readOnlyMode: false,
  allowDestructiveOperations: true,
  allowSchemaChanges: true
};
const DENY_ALL = {
  readOnlyMode: false,
  allowDestructiveOperations: false,
  allowSchemaChanges: false
};

describe('stripSqlLiteralsAndComments', () => {
  it('replaces string literals with an empty placeholder', () => {
    expect(stripSqlLiteralsAndComments("SELECT 'DELETE FROM x'")).toBe("SELECT ''");
  });

  it('honours doubled-quote escapes inside string literals', () => {
    expect(stripSqlLiteralsAndComments("SELECT 'a''b' , c")).toBe("SELECT '' , c");
  });

  it('replaces bracketed identifiers with an empty placeholder', () => {
    expect(stripSqlLiteralsAndComments('SELECT [delete], [into]')).toBe('SELECT [], []');
  });

  it('replaces double-quoted identifiers with an empty placeholder', () => {
    expect(stripSqlLiteralsAndComments('SELECT "drop"')).toBe('SELECT ""');
  });

  it('strips line comments to a space', () => {
    expect(stripSqlLiteralsAndComments('SELECT 1 -- DROP TABLE Users')).toBe('SELECT 1  ');
  });

  it('strips block comments, including nested ones', () => {
    expect(stripSqlLiteralsAndComments('SELECT 1 /* a /* DELETE */ b */ 2')).toBe('SELECT 1   2');
  });

  it('fails closed (returns null) on an unterminated string literal', () => {
    expect(stripSqlLiteralsAndComments("SELECT 'abc")).toBeNull();
  });

  it('fails closed (returns null) on an unterminated bracketed identifier', () => {
    expect(stripSqlLiteralsAndComments('SELECT [abc')).toBeNull();
  });

  it('fails closed (returns null) on an unterminated block comment', () => {
    expect(stripSqlLiteralsAndComments('SELECT 1 /* DELETE FROM Users')).toBeNull();
  });
});

describe('findForbiddenBatchStatement', () => {
  it('returns null immediately in full-destruction mode (all restrictions off)', () => {
    expect(findForbiddenBatchStatement('SELECT 1 DROP TABLE Users', DDL_ALLOWED)).toBeNull();
  });

  it('allows a plain SELECT in read-only mode', () => {
    expect(findForbiddenBatchStatement('SELECT 1', READ_ONLY)).toBeNull();
  });

  describe('fail-closed on unterminated input', () => {
    it('reports non-select queryType in read-only mode', () => {
      const result = findForbiddenBatchStatement("SELECT 'abc", READ_ONLY);
      expect(result.queryType).toBe('non-select');
      expect(result.reason).toMatch(/Unterminated string literal/);
      expect(result.reason).toMatch(/^Read-only mode is enabled\./);
    });

    it('reports invalid queryType when not in read-only mode', () => {
      const result = findForbiddenBatchStatement('SELECT 1 /* DELETE', DML_ALLOWED);
      expect(result.queryType).toBe('invalid');
      expect(result.reason).toMatch(/Unterminated string literal/);
    });
  });

  describe('keyword classification per tier', () => {
    it('read-only mode blocks a hidden DELETE with non-select type', () => {
      const result = findForbiddenBatchStatement('SELECT 1 DELETE FROM Users', READ_ONLY);
      expect(result.queryType).toBe('non-select');
      expect(result.keyword).toBe('DELETE');
      expect(result.reason).toMatch(/Read-only mode is enabled/);
    });

    it('destructive tier blocks a schema keyword with schema type', () => {
      const result = findForbiddenBatchStatement('SELECT 1 CREATE TABLE T (a int)', DML_ALLOWED);
      expect(result.queryType).toBe('schema');
      expect(result.keyword).toBe('CREATE');
      expect(result.reason).toMatch(/Schema changes/);
    });

    it('destructive keyword is allowed once the destructive tier is enabled', () => {
      expect(findForbiddenBatchStatement('SELECT 1 DELETE FROM Users', DML_ALLOWED)).toBeNull();
    });

    it('administrative keywords are gated by the destructive tier', () => {
      const denied = findForbiddenBatchStatement('SELECT 1 SHUTDOWN', DENY_ALL);
      expect(denied.queryType).toBe('destructive');
      expect(denied.reason).toMatch(/Administrative operations/);
      expect(denied.keyword).toBe('SHUTDOWN');
      expect(findForbiddenBatchStatement('SELECT 1 SHUTDOWN', DML_ALLOWED)).toBeNull();
    });

    it('xp_/sp_ procedure prefixes are classified as administrative', () => {
      const result = findForbiddenBatchStatement("SELECT 1 sp_who 'x'", DENY_ALL);
      expect(result.keyword).toBe('SP_WHO');
      expect(result.reason).toMatch(/Administrative operations/);
    });

    it('WAITFOR is only forbidden in read-only mode', () => {
      expect(
        findForbiddenBatchStatement("SELECT 1 WAITFOR DELAY '00:00:05'", READ_ONLY)
      ).not.toBeNull();
      expect(
        findForbiddenBatchStatement("SELECT 1 WAITFOR DELAY '00:00:05'", DML_ALLOWED)
      ).toBeNull();
    });
  });

  describe('contextual classifiers', () => {
    it('classifyInto: SELECT ... INTO is a schema change', () => {
      const result = findForbiddenBatchStatement(
        'SELECT * INTO Users_copy FROM Users',
        DML_ALLOWED
      );
      expect(result.queryType).toBe('schema');
      expect(result.keyword).toBe('INTO');
    });

    it('classifyInto: INSERT ... INTO is not treated as a schema change', () => {
      // INSERT governs the INTO, so it is destructive (allowed under DML tier),
      // not a schema change.
      expect(
        findForbiddenBatchStatement('INSERT INTO Users (id) VALUES (1)', DML_ALLOWED)
      ).toBeNull();
    });

    it('classifyOpenrowset: OPENROWSET(BULK ...) is non-read-only (blocked only in read-only)', () => {
      const bulk = "SELECT * FROM OPENROWSET(BULK 'c:\\f.txt', SINGLE_CLOB) AS x";
      expect(findForbiddenBatchStatement(bulk, READ_ONLY).queryType).toBe('non-select');
      expect(findForbiddenBatchStatement(bulk, DML_ALLOWED)).toBeNull();
    });

    it('classifyOpenrowset: non-BULK OPENROWSET is administrative', () => {
      const provider = "SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1')";
      const result = findForbiddenBatchStatement(provider, DENY_ALL);
      expect(result.reason).toMatch(/Administrative operations/);
    });

    it('classifyReceive: RECEIVE in statement position is destructive', () => {
      expect(findForbiddenBatchStatement('RECEIVE TOP (1) * FROM dbo.Q', DENY_ALL)).not.toBeNull();
      expect(findForbiddenBatchStatement('SELECT 1 RECEIVE * FROM dbo.Q', DENY_ALL)).not.toBeNull();
    });

    it('classifyReceive: RECEIVE used as an ordinary identifier is allowed', () => {
      expect(findForbiddenBatchStatement('SELECT Receive FROM dbo.Config', READ_ONLY)).toBeNull();
    });
  });

  describe('leading-statement rule', () => {
    it('treats a bare procedure call as a forbidden leading statement', () => {
      const result = findForbiddenBatchStatement('dbo.PurgeUsers', DENY_ALL);
      expect(result.reason).toMatch(/Unrecognised leading statement/);
    });

    it('treats a batch that opens with a quoted token as a bare procedure call', () => {
      const result = findForbiddenBatchStatement("[xp_cmdshell] 'dir'; SELECT 1", DENY_ALL);
      expect(result.reason).toMatch(/Unrecognised leading statement/);
    });

    it('accepts a batch that opens with a recognised statement keyword', () => {
      expect(findForbiddenBatchStatement('SELECT 1; SELECT 2', READ_ONLY)).toBeNull();
    });
  });
});
