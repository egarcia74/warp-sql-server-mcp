import { describe, it, expect } from 'vitest';
import {
  findForbiddenWhereClauseSyntax,
  stripWhereClauseLiterals,
  tokenizeWhereClause,
  WHERE_CLAUSE_FORBIDDEN_KEYWORDS,
  WHERE_CLAUSE_TOP_LEVEL_FORBIDDEN_KEYWORDS
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

  describe('bracketed identifiers that collide with keywords are allowed (not false-positives)', () => {
    // stripWhereClauseLiterals removes [..] before the keyword/depth scan, so a
    // column whose name collides with a keyword must not trip the guard. This
    // is the most likely real-world false positive.
    it.each([
      ['top-level-only keyword as identifier', '[Select] = 1'],
      ['top-level-only keyword as identifier', '[Order] = 1'],
      ['any-depth forbidden keyword as identifier', '[Delete] = 1'],
      ['bracketed keyword combined with a real predicate', 'id = 1 AND [Union] = 2']
    ])('allows %s (%s)', (_label, clause) => {
      expect(findForbiddenWhereClauseSyntax(clause)).toBeNull();
    });
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
    ])('rejects %s and names the token', (token, clause) => {
      const reason = findForbiddenWhereClauseSyntax(clause);
      expect(reason).toMatch(/batch separators and comments/);
      expect(reason).toContain(`found '${token}'`);
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

    // Data-driven guard against an accidental drop from the Set: every member
    // must be rejected wherever it appears in a clause.
    it.each([...WHERE_CLAUSE_FORBIDDEN_KEYWORDS])('rejects the forbidden keyword %s', keyword => {
      expect(findForbiddenWhereClauseSyntax(`1 = 1 ${keyword}`)).toMatch(
        new RegExp(`statement keyword '${keyword.toUpperCase()}'`)
      );
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

    // Data-driven guard against an accidental drop from the Set.
    it.each([...WHERE_CLAUSE_TOP_LEVEL_FORBIDDEN_KEYWORDS])(
      'rejects the top-level-only keyword %s at depth 0',
      keyword => {
        expect(findForbiddenWhereClauseSyntax(`1 = 1 ${keyword}`)).toMatch(
          /only allowed inside a parenthesised subquery/
        );
      }
    );
  });

  it('rejects unbalanced parentheses', () => {
    expect(findForbiddenWhereClauseSyntax('(id = 1')).toMatch(/unbalanced parentheses/);
  });
});
