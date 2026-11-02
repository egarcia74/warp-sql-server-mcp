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

// Meter logical character inspections rather than elapsed time: CI runner
// speed varies, but repeatedly searching a remaining SQL suffix is quadratic
// on a dense set of comments regardless of the machine.
function meteredSql(text) {
  let inspected = 0;
  return {
    length: text.length,
    charAt(i) {
      inspected++;
      return text.charAt(i);
    },
    substring(start, end) {
      inspected += Math.max(0, Math.min(end ?? text.length, text.length) - start);
      return text.substring(start, end);
    },
    indexOf(needle, start = 0) {
      const found = text.indexOf(needle, start);
      inspected += found === -1 ? text.length - start : found - start + needle.length;
      return found;
    },
    get inspected() {
      return inspected;
    }
  };
}

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

  it.each([
    ['LF', '\n', 'SELECT NEXT VALUE'],
    ['CR', '\r', 'SELECT NEXT VALUE'],
    ['CRLF', '\r\n', 'SELECT NEXT \nVALUE']
  ])('ends a line comment at %s without changing its lexical output', (_name, ending, expected) => {
    expect(stripSqlLiteralsAndComments(`SELECT NEXT-- comment${ending}VALUE`)).toBe(expected);
  });

  it('preserves EOF and mixed line-ending behavior', () => {
    expect(stripSqlLiteralsAndComments('SELECT 1-- comment')).toBe('SELECT 1 ');
    expect(stripSqlLiteralsAndComments('SELECT NEXT-- a\rVALUE-- b\nFOR')).toBe(
      'SELECT NEXT VALUE FOR'
    );
  });

  it.each([
    ['LF', '\n'],
    ['CR', '\r']
  ])('scans many %s line comments with linear character inspections', (_name, ending) => {
    const query = `SELECT 1${ending}${`--x${ending}`.repeat(20_000)}SELECT NEXT VALUE FOR dbo.Seq AS n`;
    const metered = meteredSql(query);
    const lexical = stripSqlLiteralsAndComments(metered);

    expect(lexical.endsWith('SELECT NEXT VALUE FOR dbo.Seq AS n')).toBe(true);
    expect(metered.inspected).toBeLessThan(query.length * 8);
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
    it.each([
      'SELECT NEXT VALUE FOR dbo.Seq AS n',
      'WITH q AS (SELECT NEXT VALUE FOR dbo.Seq AS n) SELECT n FROM q',
      'SELECT 1; SELECT NeXt\nVaLuE\tFoR [dbo].[Seq] AS n',
      'SELECT NEXT/**/VALUE/* nested /* comment */ */FOR dbo.Seq AS n',
      'SELECT NEXT-- comment\nVALUE FOR dbo.Seq AS n',
      'SELECT NEXT-- comment\rVALUE FOR dbo.Seq AS n',
      'SELECT NEXT-- comment\r\nVALUE FOR dbo.Seq AS n',
      'SELECT NEXT-- a\rVALUE-- b\nFOR dbo.Seq AS n'
    ])('blocks sequence consumption in read-only mode: %s', query => {
      const result = findForbiddenBatchStatement(query, READ_ONLY);
      expect(result?.queryType).toBe('non-select');
      expect(result?.keyword).toBe('NEXT VALUE FOR');
    });

    it('gates sequence consumption on destructive operations, not schema changes', () => {
      const query = 'SELECT NEXT VALUE FOR dbo.Seq AS n';
      expect(findForbiddenBatchStatement(query, DENY_ALL)?.queryType).toBe('destructive');
      expect(
        findForbiddenBatchStatement('SELECT NEXT-- comment\rVALUE FOR dbo.Seq AS n', DENY_ALL)
          ?.queryType
      ).toBe('destructive');
      expect(findForbiddenBatchStatement(query, DML_ALLOWED)).toBeNull();
      expect(findForbiddenBatchStatement(query, DDL_ALLOWED)).toBeNull();
    });

    it.each(['\n', '\r', '\r\n'])('does not hide DELETE after a %j line comment', ending => {
      const result = findForbiddenBatchStatement(
        `SELECT 1-- comment${ending}DELETE FROM Users`,
        READ_ONLY
      );
      expect(result?.keyword).toBe('DELETE');
    });

    it.each([
      "SELECT 'NEXT VALUE FOR' AS note",
      "SELECT N'NEXT VALUE FOR' AS note",
      'SELECT "NEXT VALUE FOR" AS note',
      'SELECT [NEXT VALUE FOR] FROM dbo.Events',
      'SELECT 1 -- NEXT VALUE FOR dbo.Seq',
      'SELECT 1 /* outer /* NEXT VALUE FOR */ tail */',
      'SELECT @next + @value + @for',
      'SELECT [next], [value], [for] FROM dbo.Events',
      'SELECT NEXT_VALUE_FOR FROM dbo.Events'
    ])('keeps nonexecuting text or identifiers allowed: %s', query => {
      expect(findForbiddenBatchStatement(query, READ_ONLY)).toBeNull();
    });

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

    it('classifyReceive: RECEIVE in statement position (i===0, next===top) is destructive', () => {
      const result = findForbiddenBatchStatement('RECEIVE TOP (1) * FROM dbo.Q', DENY_ALL);
      expect(result.keyword).toBe('RECEIVE');
      expect(result.queryType).toBe('destructive');
    });

    it('classifyReceive: RECEIVE in statement position (next===*) is destructive', () => {
      const result = findForbiddenBatchStatement('SELECT 1 RECEIVE * FROM dbo.Q', DENY_ALL);
      expect(result.keyword).toBe('RECEIVE');
      expect(result.queryType).toBe('destructive');
    });

    it('classifyReceive: the WAITFOR-preceding branch alone marks RECEIVE as a statement', () => {
      // Isolates the `words.at(i - 1) === 'waitfor'` disjunct: the RECEIVE is
      // mid-batch (i !== 0) and is followed by an explicit column list, so
      // neither next==='top' nor next==='*' fires — only the preceding WAITFOR
      // makes it a statement. DENY_ALL is required so WAITFOR itself (a
      // non-read-only keyword) is permitted while RECEIVE-as-destructive is
      // still blocked; under READ_ONLY the leading WAITFOR would be caught
      // first, and under any DML-allowing tier RECEIVE would not be blocked.
      const result = findForbiddenBatchStatement(
        'WAITFOR (RECEIVE col1, col2 FROM dbo.Queue)',
        DENY_ALL
      );
      expect(result.keyword).toBe('RECEIVE');
      expect(result.queryType).toBe('destructive');
      expect(result.reason).toMatch(/Destructive operations/);
    });

    it('classifyReceive: RECEIVE used as an ordinary identifier is allowed', () => {
      expect(findForbiddenBatchStatement('SELECT Receive FROM dbo.Config', READ_ONLY)).toBeNull();
      // Mid-batch RECEIVE with a column list and no preceding WAITFOR is
      // lexically a SELECT of a column named "receive" — deliberately allowed.
      expect(
        findForbiddenBatchStatement('SELECT receive, col2 FROM dbo.Queue', READ_ONLY)
      ).toBeNull();
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
