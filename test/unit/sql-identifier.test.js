import { describe, test, expect } from 'vitest';
import {
  sanitizeDbName,
  escapeBracketIdentifier,
  escapeSqlStringLiteral,
  parseRowCount
} from '../../lib/utils/sql-identifier.js';

describe('sanitizeDbName', () => {
  test('returns null for null/undefined', () => {
    expect(sanitizeDbName(null)).toBeNull();
    expect(sanitizeDbName(undefined)).toBeNull();
  });

  test('passes through a normal database name', () => {
    expect(sanitizeDbName('McpToolingTestDb')).toBe('McpToolingTestDb');
  });

  test('doubles single quotes to prevent breaking out of the literal', () => {
    expect(sanitizeDbName("O'Brien")).toBe("O''Brien");
  });

  test('throws on square brackets', () => {
    expect(() => sanitizeDbName('bad]name')).toThrow(/invalid database name/i);
    expect(() => sanitizeDbName('[bad')).toThrow(/invalid database name/i);
  });

  test('throws on non-string input', () => {
    expect(() => sanitizeDbName(123)).toThrow(/invalid database name/i);
  });
});

describe('escapeBracketIdentifier', () => {
  test('passes through a normal identifier', () => {
    expect(escapeBracketIdentifier('Users')).toBe('Users');
  });

  test('doubles closing brackets to prevent breaking out of [...] quoting', () => {
    expect(escapeBracketIdentifier('x]; DROP TABLE Users--')).toBe('x]]; DROP TABLE Users--');
    expect(escapeBracketIdentifier('a]b]c')).toBe('a]]b]]c');
  });

  test('throws on non-string input', () => {
    expect(() => escapeBracketIdentifier(123)).toThrow(/invalid sql identifier/i);
  });
});

describe('escapeSqlStringLiteral', () => {
  test('passes through a normal value', () => {
    expect(escapeSqlStringLiteral('dbo')).toBe('dbo');
  });

  test('doubles single quotes to prevent breaking out of the literal', () => {
    expect(escapeSqlStringLiteral("x' OR '1'='1")).toBe("x'' OR ''1''=''1");
    expect(escapeSqlStringLiteral("a'--")).toBe("a''--");
  });

  test('leaves brackets untouched (ordinary chars inside a string literal)', () => {
    expect(escapeSqlStringLiteral('a]b[c')).toBe('a]b[c');
  });

  test('throws on non-string input', () => {
    expect(() => escapeSqlStringLiteral(123)).toThrow(TypeError);
  });
});

describe('parseRowCount', () => {
  test('returns the fallback when value is null/undefined', () => {
    expect(parseRowCount(null, { name: 'limit', min: 1, fallback: 100 })).toBe(100);
    expect(parseRowCount(undefined, { name: 'limit', min: 1, fallback: 100 })).toBe(100);
    expect(parseRowCount(null, { name: 'limit', min: 1, fallback: null })).toBeNull();
  });

  test('accepts valid integers', () => {
    expect(parseRowCount(50, { name: 'limit', min: 1, fallback: 100 })).toBe(50);
    expect(parseRowCount('25', { name: 'limit', min: 1, fallback: 100 })).toBe(25);
    expect(parseRowCount(0, { name: 'offset', min: 0, fallback: 0 })).toBe(0);
  });

  test('throws a TypeError naming the param on non-integers', () => {
    expect(() => parseRowCount('1; DROP', { name: 'limit', min: 1, fallback: 100 })).toThrow(
      /invalid limit/i
    );
    expect(() => parseRowCount(1.5, { name: 'limit', min: 1, fallback: 100 })).toThrow(TypeError);
    expect(() => parseRowCount({}, { name: 'offset', min: 0, fallback: 0 })).toThrow(
      /invalid offset/i
    );
  });

  test('throws when below the minimum', () => {
    expect(() => parseRowCount(-1, { name: 'offset', min: 0, fallback: 0 })).toThrow(
      /invalid offset/i
    );
    expect(() => parseRowCount(0, { name: 'limit', min: 1, fallback: 100 })).toThrow(
      /invalid limit/i
    );
  });
});
