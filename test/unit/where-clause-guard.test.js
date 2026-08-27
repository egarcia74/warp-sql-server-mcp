import { describe, it, expect } from 'vitest';
import {
  findForbiddenWhereClauseSyntax,
  stripWhereClauseLiterals,
  tokenizeWhereClause
} from '../../lib/security/where-clause-guard.js';

/**
 * Direct unit tests for the WHERE-clause guard used by get_table_data /
 * export_table_csv. Previously exercised only indirectly via SqlServerMCP
 * (test/unit/index.test.js). These pin the exported functions:
 *   - stripWhereClauseLiterals (fail-closed lexer)
 *   - tokenizeWhereClause (depth tagging + paren balance)
 *   - findForbiddenWhereClauseSyntax (forbidden-syntax / top-level rules)
 */

describe('stripWhereClauseLiterals', () => {
  it('replaces string literals with an empty placeholder', () => {
    expect(stripWhereClauseLiterals("name = 'a;b'")).toBe("name = ''");
  });

  it('honours doubled-quote escapes inside literals', () => {
    expect(stripWhereClauseLiterals("name = 'a''b'")).toBe("name = ''");
  });

  it('replaces bracketed identifiers with an empty placeholder', () => {
    expect(stripWhereClauseLiterals('[Set] = 1')).toBe('[] = 1');
  });

  it('fails closed (null) on an unterminated literal', () => {
    expect(stripWhereClauseLiterals("name = 'abc")).toBeNull();
  });

  it('fails closed (null) on an unterminated bracketed identifier', () => {
    expect(stripWhereClauseLiterals('1=1 [ DROP TABLE t')).toBeNull();
  });
});

describe('tokenizeWhereClause', () => {
  it('tags words with their parenthesis depth', () => {
    const { words } = tokenizeWhereClause('a = 1 and (b in (2))');
    expect(words.find(w => w.word === 'a').depth).toBe(0);
    expect(words.find(w => w.word === 'b').depth).toBe(1);
    expect(words.find(w => w.word === '2').depth).toBe(2);
  });

  it('reports balanced for matched parentheses', () => {
    expect(tokenizeWhereClause('(a = 1) and (b = 2)').balanced).toBe(true);
  });

  it('reports unbalanced when a paren is left open', () => {
    expect(tokenizeWhereClause('(a = 1').balanced).toBe(false);
  });

  it('reports unbalanced when a close precedes its open (negative depth)', () => {
    expect(tokenizeWhereClause('a = 1) or (b = 2').balanced).toBe(false);
  });
});

describe('findForbiddenWhereClauseSyntax', () => {
  it('allows a plain single predicate', () => {
    expect(findForbiddenWhereClauseSyntax('id = 1')).toBeNull();
  });

  it('allows a subquery predicate (keyword legal inside parentheses)', () => {
    expect(findForbiddenWhereClauseSyntax('id IN (SELECT id FROM other)')).toBeNull();
  });

  it('fails closed on an unterminated literal', () => {
    expect(findForbiddenWhereClauseSyntax("name = 'abc")).toMatch(/unterminated string literal/);
  });

  describe('forbidden batch separators and comments', () => {
    it.each([
      [';', '1=1; DELETE FROM t'],
      ['--', '1=1 -- comment'],
      ['/*', '1=1 /* c */'],
      ['*/', '1=1 */']
    ])('rejects %s', (token, clause) => {
      expect(findForbiddenWhereClauseSyntax(clause)).toMatch(/batch separators and comments/);
    });
  });

  describe('forbidden statement keywords (at any depth)', () => {
    it('rejects a statement keyword even inside parentheses', () => {
      expect(findForbiddenWhereClauseSyntax('id = 1 AND (1=1 DELETE FROM t)')).toMatch(
        /statement keyword 'DELETE'/
      );
    });

    it('rejects xp_/sp_ procedure names', () => {
      expect(findForbiddenWhereClauseSyntax("1=1 AND xp_cmdshell 'dir'")).toMatch(
        /statement keyword 'XP_CMDSHELL'/
      );
    });

    it('rejects INTO', () => {
      expect(findForbiddenWhereClauseSyntax('1=1 INTO dumped')).toMatch(/statement keyword 'INTO'/);
    });
  });

  describe('top-level-only forbidden keywords', () => {
    it('rejects a top-level UNION', () => {
      expect(findForbiddenWhereClauseSyntax('1=1 UNION SELECT * FROM secrets')).toMatch(
        /only allowed inside a parenthesised subquery/
      );
    });

    it('rejects a top-level ORDER (BY)', () => {
      expect(findForbiddenWhereClauseSyntax('1=1 ORDER BY 1')).toMatch(
        /only allowed inside a parenthesised subquery/
      );
    });

    it('allows the same set operator when nested inside a subquery', () => {
      expect(
        findForbiddenWhereClauseSyntax('id IN (SELECT id FROM a UNION SELECT id FROM b)')
      ).toBeNull();
    });
  });

  it('rejects unbalanced parentheses', () => {
    expect(findForbiddenWhereClauseSyntax('(id = 1')).toMatch(/unbalanced parentheses/);
  });
});
