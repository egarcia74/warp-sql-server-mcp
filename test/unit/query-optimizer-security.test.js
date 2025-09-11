/**
 * Security enhancement tests for Query Optimizer
 * Tests null safety and input validation improvements
 */

import { describe, it, expect } from 'vitest';
import { QueryOptimizer } from '../../lib/analysis/query-optimizer.js';

describe('QueryOptimizer - Security Enhancements', () => {
  const optimizer = new QueryOptimizer();

  describe('Null Input Protection', () => {
    it('should handle null query in analyzeQuery', () => {
      expect(() => optimizer.analyzeQuery(null)).toThrow('Query must be a non-empty string');
    });

    it('should handle undefined query in analyzeQuery', () => {
      expect(() => optimizer.analyzeQuery(undefined)).toThrow('Query must be a non-empty string');
    });

    it('should handle empty string in analyzeQuery', () => {
      expect(() => optimizer.analyzeQuery('')).toThrow('Query must be a non-empty string');
    });

    it('should handle non-string input in analyzeQuery', () => {
      expect(() => optimizer.analyzeQuery(123)).toThrow('Query must be a non-empty string');
      expect(() => optimizer.analyzeQuery({})).toThrow('Query must be a non-empty string');
      expect(() => optimizer.analyzeQuery([])).toThrow('Query must be a non-empty string');
    });
  });

  describe('Method Null Safety', () => {
    it('should handle null input in determineQueryType', () => {
      expect(optimizer.determineQueryType(null)).toBe('UNKNOWN');
      expect(optimizer.determineQueryType(undefined)).toBe('UNKNOWN');
      expect(optimizer.determineQueryType('')).toBe('UNKNOWN');
    });

    it('should handle null input in calculateComplexityScore', () => {
      expect(optimizer.calculateComplexityScore(null)).toBe(0);
      expect(optimizer.calculateComplexityScore(undefined)).toBe(0);
      expect(optimizer.calculateComplexityScore('')).toBe(0);
    });

    it('should handle null input in generatePerformanceWarnings', () => {
      expect(optimizer.generatePerformanceWarnings(null)).toEqual([]);
      expect(optimizer.generatePerformanceWarnings(undefined)).toEqual([]);
      expect(optimizer.generatePerformanceWarnings('')).toEqual([]);
    });

    it('should handle null input in hasTableScans', () => {
      expect(optimizer.hasTableScans(null)).toBe(false);
      expect(optimizer.hasTableScans(undefined)).toBe(false);
      expect(optimizer.hasTableScans('')).toBe(false);
    });

    it('should handle null input in canUseExists', () => {
      expect(optimizer.canUseExists(null)).toBe(false);
      expect(optimizer.canUseExists(undefined)).toBe(false);
      expect(optimizer.canUseExists('')).toBe(false);
    });
  });

  describe('ReDoS Protection', () => {
    it('should handle very large queries in extractWhereColumns', () => {
      const largeQuery = 'SELECT * FROM table WHERE ' + 'a = 1 AND '.repeat(5000) + 'b = 2';

      // Should not hang or crash, but return empty array due to size limit
      const result = optimizer.extractWhereColumns(largeQuery);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle very large queries in extractJoinColumns', () => {
      const largeQuery =
        'SELECT * FROM table1 ' +
        'JOIN table2 ON t1.id = t2.id AND '.repeat(5000) +
        't1.id = t2.id';

      // Should not hang or crash, but return empty array due to size limit
      const result = optimizer.extractJoinColumns(largeQuery);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should provide valid analysis even for valid queries', () => {
      const query = 'SELECT id, name FROM users WHERE active = 1';
      const result = optimizer.analyzeQuery(query);

      expect(result).toBeDefined();
      expect(result.query).toBe(query);
      expect(result.query_type).toBeDefined();
      expect(typeof result.complexity_score).toBe('number');
      expect(Array.isArray(result.performance_warnings)).toBe(true);
      expect(Array.isArray(result.optimization_suggestions)).toBe(true);
    });

    it('should handle queries that might cause analysis errors gracefully', () => {
      // Create a query that might cause issues in analysis but is still a valid string
      const problematicQuery = "SELECT * FROM table WHERE column LIKE '%([{*+?}])%'";

      const result = optimizer.analyzeQuery(problematicQuery);

      // Should get either a successful analysis or a safe fallback
      expect(result).toBeDefined();
      expect(result.query).toBe(problematicQuery);
      expect(result.query_type).toBeDefined();

      // If there was an error, it should be in error recovery mode
      if (result.error) {
        expect(result.query_type).toBe('UNKNOWN');
        expect(result.complexity_score).toBe(0);
        expect(result.performance_warnings).toContain('Query analysis failed due to parsing error');
      }
    });
  });
});
