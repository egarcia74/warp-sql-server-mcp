import { describe, test, expect } from 'vitest';
import { sanitizeDbName } from '../../lib/utils/sql-identifier.js';

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
