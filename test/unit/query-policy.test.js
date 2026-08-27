import { describe, it, expect, vi } from 'vitest';
import {
  validateQuery,
  getQueryType,
  getSingleQueryType,
  allowUnlessBatchViolation
} from '../../lib/security/query-policy.js';

/**
 * Focused unit tests for the query-safety policy extracted from index.js.
 * SqlServerMCP.validateQuery is now a thin delegator to validateQuery() here,
 * so these lock in the pure behaviour (mode gating, type classification, the
 * full-destruction short-circuit and the batch-guard backstop).
 */

// Mirrors lib/config/server-config.js securityPatterns.
const PATTERNS = {
  destructive: [
    /^\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i,
    /^\s*EXEC(UTE)?\s+/i,
    /^\s*CALL\s+/i,
    /;\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i
  ],
  schemaChanges: [
    /^\s*(CREATE|DROP|ALTER)\s+/i,
    /^\s*(GRANT|REVOKE)\s+/i,
    /;\s*(CREATE|DROP|ALTER|GRANT|REVOKE)\s+/i
  ],
  readOnly: [
    /^\s*SELECT\s+/i,
    /^\s*SHOW\s+/i,
    /^\s*DESCRIBE\s+/i,
    /^\s*DESC\s+/i,
    /^\s*EXPLAIN\s+/i,
    /^\s*WITH\s+[\s\S]*?\bSELECT\s+/i
  ]
};
const securityConfig = { patterns: PATTERNS };

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

describe('getSingleQueryType', () => {
  it('classifies SELECT as select', () => {
    expect(getSingleQueryType('SELECT 1', securityConfig)).toBe('select');
  });

  it('classifies DELETE as destructive', () => {
    expect(getSingleQueryType('DELETE FROM t', securityConfig)).toBe('destructive');
  });

  it('classifies CREATE as schema', () => {
    expect(getSingleQueryType('CREATE TABLE t (a int)', securityConfig)).toBe('schema');
  });

  it('classifies an unrecognised statement as unknown', () => {
    expect(getSingleQueryType('FOOBAR t', securityConfig)).toBe('unknown');
  });

  it('warns and returns unknown when patterns are corrupted', () => {
    const logger = { warn: vi.fn() };
    expect(getSingleQueryType('SELECT 1', { patterns: null }, logger)).toBe('unknown');
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('does not throw when no logger is supplied and patterns are corrupted', () => {
    expect(() => getSingleQueryType('SELECT 1', {})).not.toThrow();
    expect(getSingleQueryType('SELECT 1', {})).toBe('unknown');
  });
});

describe('getQueryType', () => {
  it('takes the most restrictive type across ;-separated statements', () => {
    expect(getQueryType('SELECT 1; CREATE TABLE t (a int)', securityConfig)).toBe('schema');
    expect(getQueryType('SELECT 1; DELETE FROM t', securityConfig)).toBe('destructive');
    expect(getQueryType('SELECT 1; SELECT 2', securityConfig)).toBe('select');
  });

  it('only inspects statement prefixes (whitespace-joined statements are not split)', () => {
    // This is exactly why the batch guard exists: prefix classification alone
    // sees only the leading SELECT.
    expect(getQueryType('SELECT 1 DELETE FROM t', securityConfig)).toBe('select');
  });
});

describe('allowUnlessBatchViolation', () => {
  it('allows a clean SELECT', () => {
    const result = allowUnlessBatchViolation('SELECT 1', 'select', READ_ONLY);
    expect(result).toEqual({
      allowed: true,
      reason: 'Query validation passed',
      queryType: 'select'
    });
  });

  it('blocks a hidden statement via the batch guard and surfaces its fields', () => {
    const result = allowUnlessBatchViolation('SELECT 1 DELETE FROM t', 'select', READ_ONLY);
    expect(result.allowed).toBe(false);
    expect(result.keyword).toBe('DELETE');
    expect(result.queryType).toBe('non-select');
  });
});

describe('validateQuery', () => {
  it('allows an empty query', () => {
    expect(validateQuery('   ', READ_ONLY, securityConfig)).toEqual({
      allowed: true,
      reason: 'Empty query'
    });
  });

  it('short-circuits in full-destruction mode without consulting patterns', () => {
    const logger = { warn: vi.fn() };
    // Pass deliberately corrupted config to prove it is never read here.
    const result = validateQuery('DROP TABLE t', DDL_ALLOWED, { patterns: null }, logger);
    expect(result).toEqual({
      allowed: true,
      reason: 'Full destruction mode - all restrictions disabled, query validation bypassed',
      queryType: 'unrestricted',
      optimized: true
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  describe('read-only mode', () => {
    it('allows a SELECT', () => {
      expect(validateQuery('SELECT 1', READ_ONLY, securityConfig).allowed).toBe(true);
    });

    it('blocks a non-SELECT with non-select type', () => {
      const result = validateQuery('DELETE FROM t', READ_ONLY, securityConfig);
      expect(result.allowed).toBe(false);
      expect(result.queryType).toBe('non-select');
      expect(result.reason).toMatch(/Read-only mode is enabled/);
    });

    it('blocks a batch that hides a DELETE behind a SELECT prefix', () => {
      const result = validateQuery('SELECT 1 DELETE FROM t', READ_ONLY, securityConfig);
      expect(result.allowed).toBe(false);
      expect(result.queryType).toBe('non-select');
    });
  });

  describe('destructive tier', () => {
    it('blocks a destructive query when not allowed', () => {
      const result = validateQuery(
        'DELETE FROM t',
        {
          readOnlyMode: false,
          allowDestructiveOperations: false,
          allowSchemaChanges: false
        },
        securityConfig
      );
      expect(result.allowed).toBe(false);
      expect(result.queryType).toBe('destructive');
    });

    it('allows a destructive query once the tier is enabled', () => {
      expect(validateQuery('DELETE FROM t', DML_ALLOWED, securityConfig).allowed).toBe(true);
    });
  });

  describe('schema tier', () => {
    it('blocks a schema change when not allowed', () => {
      const result = validateQuery('CREATE TABLE t (a int)', DML_ALLOWED, securityConfig);
      expect(result.allowed).toBe(false);
      expect(result.queryType).toBe('schema');
    });

    it('allows a schema change once the tier is enabled', () => {
      expect(validateQuery('CREATE TABLE t (a int)', DDL_ALLOWED, securityConfig).allowed).toBe(
        true
      );
    });
  });
});
