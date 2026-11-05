import { describe, test, expect } from 'vitest';
import { findForbiddenBatchStatement as guard } from '../../lib/security/sql-batch-guard.js';
import { findForbiddenWhereClauseSyntax as where } from '../../lib/security/where-clause-guard.js';
import { parseCatalogColumns } from '../../lib/utils/sql-identifier.js';
import { QueryOptimizer } from '../../lib/analysis/query-optimizer.js';
const ro = { readOnlyMode: true, allowDestructiveOperations: false, allowSchemaChanges: false };
const dml = { ...ro, readOnlyMode: false, allowDestructiveOperations: true };
const full = { ...dml, allowSchemaChanges: true };
describe('scan security boundaries', () => {
  test.each(['[x', '[x],', '[x] garbage', 'x', '[]', '[x],  '])(
    'rejects malformed DMV list %s',
    text => {
      expect(() => parseCatalogColumns(text)).toThrow('Invalid catalog column list');
    }
  );
  test('preserves catalog names and null lists', () => {
    expect(parseCatalogColumns(null)).toEqual([]);
    expect(parseCatalogColumns('[Order Details], [select], [c]]d]')).toEqual([
      'Order Details',
      'select',
      'c]d'
    ]);
  });
  test('bracket escapes cannot hide a second statement', () => {
    expect(guard("SELECT 1 AS [a]]'] DELETE FROM dbo.Victim SELECT 1 AS [b']", ro)).not.toBeNull();
    expect(
      where("1=(SELECT 1 AS [a]]']) DELETE FROM dbo.Victim SELECT (SELECT 1 AS [b'])")
    ).not.toBeNull();
    expect(guard("SELECT [a]]'DELETE] FROM dbo.T", ro)).toBeNull();
    expect(where("[a]]'DELETE] = 1")).toBeNull();
    expect(guard('SELECT [a]]', ro)).not.toBeNull();
    expect(where('[a]] = 1')).not.toBeNull();
  });
  test.each([
    'BEGIN CONVERSATION TIMER (@h) TIMEOUT=1',
    "BEGIN DIALOG @h FROM SERVICE [s] TO SERVICE 't' ON CONTRACT [c]",
    'BEGIN /* comment */ CONVERSATION TIMER (@h) TIMEOUT=1',
    'RECEIVE message_body FROM dbo.Q',
    'RECEIVE [message_body] FROM dbo.Q',
    'SEND ON CONVERSATION @h MESSAGE TYPE [t] (0x01)',
    'END CONVERSATION @h',
    "BEGIN DIALOG CONVERSATION @h FROM SERVICE [s] TO SERVICE 't' ON CONTRACT [c]",
    'MOVE CONVERSATION @h TO @g',
    'GET CONVERSATION GROUP @g FROM dbo.Q'
  ])('blocks Broker mutation: %s', statement => {
    expect(guard(`SELECT 1 ${statement}`, ro)).not.toBeNull();
    expect(guard(`SELECT 1 ${statement}`, { ...ro, readOnlyMode: false })).not.toBeNull();
    expect(where(`1=1 ${statement}`)).not.toBeNull();
    expect(guard(`SELECT 1 ${statement}`, full)).toBeNull();
  });
  test.each([
    "EXEC(N'DROP TABLE dbo.T')",
    "EXECUTE sp_executesql N'DROP TABLE dbo.T'",
    'dbo.Proc',
    '[dbo].[Proc]',
    "SELECT * FROM OPENQUERY(s, 'DROP TABLE t')"
  ])('requires all capabilities for arbitrary execution: %s', sql => {
    expect(guard(sql, dml)).not.toBeNull();
    expect(guard(sql, full)).toBeNull();
  });
  test('provider execution cannot borrow BULK from a later statement', () => {
    const sql =
      "SELECT * FROM OPENROWSET('MSOLEDBSQL', 'connection', 'DROP TABLE dbo.T'); BULK INSERT dbo.Stage FROM 'file'";
    expect(guard(sql, dml)).not.toBeNull();
    expect(guard("SELECT * FROM OPENROWSET(BULK 'file', SINGLE_CLOB) AS x", dml)).toBeNull();
  });
  test.each([
    'β',
    'SELECTβ',
    'enable.UnsafeRoutine',
    'disable . UnsafeRoutine',
    'select . [Proc]',
    'select..Proc',
    'select . /* comment */ [Proc]',
    'show',
    'describe',
    'explain'
  ])('blocks bare procedure %s', name => {
    expect(guard(`${name}; SELECT 1`, ro)).not.toBeNull();
    expect(guard(`${name}; SELECT 1`, dml)).not.toBeNull();
    expect(guard(`${name}; SELECT 1`, full)).toBeNull();
  });
  test.each([
    'SELECT* FROM dbo.T',
    'SELECT+1',
    'SELECT-1',
    'SELECT~1',
    'SELECT[Id] FROM dbo.T',
    'SELECT(1)'
  ])('preserves compact query %s', sql => {
    expect(guard(sql, ro)).toBeNull();
  });
  test.each(['SELECT .5 AS fraction', 'SELECT .5 * Amount FROM dbo.Payments', 'SELECT.5'])(
    'preserves leading decimal expressions: %s',
    sql => {
      expect(guard(sql, ro)).toBeNull();
      expect(guard(sql, dml)).toBeNull();
      expect(guard(`${sql}; DELETE FROM dbo.Payments`, ro)).not.toBeNull();
      expect(guard(`${sql}; EXEC dbo.UnsafeRoutine`, dml)).not.toBeNull();
    }
  );
  test('preserves normal reads and DML', () => {
    expect(guard('SELECT [Receive], [Send], [Conversation] FROM dbo.T', ro)).toBeNull();
    expect(where('[Receive] = 1 AND [Conversation] IS NULL')).toBeNull();
    expect(guard('UPDATE dbo.T SET x = 1', dml)).toBeNull();
  });
  test('quotes every catalog-derived DDL identifier without splitting embedded commas', async () => {
    const row = {
      schema_name: 'dbo];--',
      table_name: 'T];--',
      equality_columns: '[x); DELETE FROM dbo.Victim;--], [a,b], [c]]d]',
      inequality_columns: null,
      included_columns: '[z]];--]',
      avg_user_impact: 90
    };
    const pool = { request: () => ({ query: async () => ({ recordset: [row] }) }) };
    const optimizer = new QueryOptimizer({ getPool: () => pool });
    const result = await optimizer.analyzeIndexUsage('Db');
    const r = result.recommendations[0];
    expect(r.columns).toEqual(['x); DELETE FROM dbo.Victim;--', 'a,b', 'c]d']);
    expect(r.suggestion).toContain('CREATE INDEX [IX_dbo]];--_T]];--_missing]');
    expect(r.suggestion).toContain('([x); DELETE FROM dbo.Victim;--], [a,b], [c]]d])');
    expect(r.suggestion).toContain('INCLUDE ([z]];--])');
  });
});
