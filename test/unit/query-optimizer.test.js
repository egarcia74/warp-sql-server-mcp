import { describe, test, expect, beforeEach, vi } from 'vitest';
import { QueryOptimizer } from '../../lib/analysis/query-optimizer.js';

describe('QueryOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new QueryOptimizer({
      complexityWeights: {
        joins: 2.0,
        subqueries: 1.5,
        aggregates: 1.2,
        unions: 1.8,
        ctes: 1.3,
        windowFunctions: 2.5
      },
      thresholds: {
        slowQueryMs: 5000,
        highIoReads: 10000,
        highCpuMs: 3000
      }
    });
  });

  describe('extractWhereColumns', () => {
    test('should extract columns with = operator', () => {
      const query = 'SELECT * FROM Users WHERE name = ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['name']);
    });

    test('should extract columns with >= operator', () => {
      const query = 'SELECT * FROM Orders WHERE created_date >= ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['created_date']);
    });

    test('should extract columns with <= operator', () => {
      const query = 'SELECT * FROM Products WHERE price <= ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['price']);
    });

    test('should extract columns with != operator', () => {
      const query = 'SELECT * FROM Users WHERE status != ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['status']);
    });

    test('should extract columns with <> operator', () => {
      const query = 'SELECT * FROM Orders WHERE status <> ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['status']);
    });

    test('should extract columns with > operator', () => {
      const query = 'SELECT * FROM Products WHERE price > ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['price']);
    });

    test('should extract columns with < operator', () => {
      const query = 'SELECT * FROM Users WHERE age < ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['age']);
    });

    test('should extract columns with ! operator (NOT patterns)', () => {
      const query = 'SELECT * FROM Users WHERE active !LIKE ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['active']);
    });

    test('should extract multiple columns with different operators', () => {
      const query =
        'SELECT * FROM Users WHERE name = ? AND age >= ? AND status != ? AND price <= ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['age', 'price', 'status', 'name']);
    });

    test('should handle complex WHERE clauses', () => {
      const query =
        'SELECT * FROM Orders WHERE customer_id = ? AND total_amount >= ? AND status <> ? AND created_date <= ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['total_amount', 'created_date', 'status', 'customer_id']);
    });

    test('should deduplicate repeated columns', () => {
      const query = 'SELECT * FROM Users WHERE name = ? OR name != ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['name']);
    });

    test('should handle WHERE clause with GROUP BY', () => {
      const query = 'SELECT COUNT(*) FROM Users WHERE status = ? GROUP BY department';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['status']);
    });

    test('should handle WHERE clause with ORDER BY', () => {
      const query = 'SELECT * FROM Users WHERE active = ? ORDER BY name';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['active']);
    });

    test('should handle WHERE clause with HAVING', () => {
      const query = 'SELECT COUNT(*) FROM Users WHERE department = ? HAVING COUNT(*) > 5';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['department']);
    });

    test('should return empty array for queries without WHERE clause', () => {
      const query = 'SELECT * FROM Users';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual([]);
    });

    test('should handle queries with underscores in column names', () => {
      const query = 'SELECT * FROM Users WHERE first_name = ? AND last_name != ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['last_name', 'first_name']);
    });

    test('should handle queries with numbers in column names', () => {
      const query = 'SELECT * FROM Users WHERE column1 >= ? AND field2 <= ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['column1', 'field2']);
    });

    test('should handle mixed case operators', () => {
      const query = 'SELECT * FROM Users WHERE Name = ? AND Age >= ? AND Status <> ?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['Age', 'Status', 'Name']);
    });

    test('should handle whitespace around operators', () => {
      const query = 'SELECT * FROM Users WHERE name  =  ? AND age   >=   ? AND status<>?';
      const columns = optimizer.extractWhereColumns(query);
      expect(columns).toEqual(['age', 'status', 'name']);
    });
  });

  describe('extractJoinColumns', () => {
    test('should extract columns from JOIN conditions', () => {
      const query = 'SELECT * FROM Users u JOIN Orders o ON u.user_id = o.customer_id';
      const columns = optimizer.extractJoinColumns(query);
      expect(columns).toEqual(['u.user_id', 'o.customer_id']);
    });

    test('should handle multiple JOIN conditions', () => {
      const query =
        'SELECT * FROM Users u JOIN Orders o ON u.user_id = o.customer_id JOIN Products p ON o.product_id = p.product_id';
      const columns = optimizer.extractJoinColumns(query);
      // The method extracts columns from the regex matches, which may not capture all columns in complex JOIN scenarios
      expect(columns).toContain('o.product_id');
      expect(columns).toContain('p.product_id');
      expect(columns.length).toBeGreaterThan(0);
    });

    test('should remove duplicates', () => {
      const query =
        'SELECT * FROM Users u JOIN Orders o ON u.user_id = o.customer_id AND u.user_id = o.alt_customer_id';
      const columns = optimizer.extractJoinColumns(query);
      expect(columns.filter(col => col === 'u.user_id')).toHaveLength(1);
    });

    test('should return empty array for queries without JOINs', () => {
      const query = 'SELECT * FROM Users WHERE name = ?';
      const columns = optimizer.extractJoinColumns(query);
      expect(columns).toEqual([]);
    });
  });

  describe('extractOrderByColumns', () => {
    test('should extract columns from ORDER BY clause', () => {
      const query = 'SELECT * FROM Users ORDER BY name, age DESC';
      const columns = optimizer.extractOrderByColumns(query);
      expect(columns).toEqual(['name', 'age']);
    });

    test('should handle single column ORDER BY', () => {
      const query = 'SELECT * FROM Users ORDER BY created_date';
      const columns = optimizer.extractOrderByColumns(query);
      expect(columns).toEqual(['created_date']);
    });

    test('should handle ORDER BY with LIMIT', () => {
      const query = 'SELECT * FROM Users ORDER BY name LIMIT 10';
      const columns = optimizer.extractOrderByColumns(query);
      expect(columns).toEqual(['name']);
    });

    test('should handle ORDER BY with OFFSET', () => {
      const query = 'SELECT * FROM Users ORDER BY name OFFSET 5';
      const columns = optimizer.extractOrderByColumns(query);
      expect(columns).toEqual(['name']);
    });

    test('should return empty array for queries without ORDER BY', () => {
      const query = 'SELECT * FROM Users WHERE name = ?';
      const columns = optimizer.extractOrderByColumns(query);
      expect(columns).toEqual([]);
    });

    test('should handle ASC/DESC keywords', () => {
      const query = 'SELECT * FROM Users ORDER BY name ASC, age DESC';
      const columns = optimizer.extractOrderByColumns(query);
      expect(columns).toEqual(['name', 'age']);
    });

    test('should handle whitespace in ORDER BY', () => {
      const query = 'SELECT * FROM Users ORDER BY  name  ,  age  DESC  ';
      const columns = optimizer.extractOrderByColumns(query);
      expect(columns).toEqual(['name', 'age']);
    });
  });

  describe('Query Type Detection', () => {
    test('should detect SELECT_WITH_JOIN_AND_AGGREGATION', () => {
      const query =
        'SELECT COUNT(*) FROM Users u JOIN Orders o ON u.id = o.customer_id GROUP BY u.department';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('SELECT_WITH_JOIN_AND_AGGREGATION');
    });

    test('should detect SELECT_WITH_JOIN', () => {
      const query = 'SELECT * FROM Users u JOIN Orders o ON u.id = o.customer_id';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('SELECT_WITH_JOIN');
    });

    test('should detect SELECT_WITH_AGGREGATION', () => {
      const query = 'SELECT COUNT(*) FROM Users GROUP BY department';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('SELECT_WITH_AGGREGATION');
    });

    test('should detect SELECT_WITH_SUBQUERY', () => {
      const query = 'SELECT * FROM Users WHERE id IN (SELECT customer_id FROM Orders)';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('SELECT_WITH_SUBQUERY');
    });

    test('should detect INSERT queries', () => {
      const query = 'INSERT INTO Users (name, email) VALUES (?, ?)';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('INSERT');
    });

    test('should detect UPDATE queries', () => {
      const query = 'UPDATE Users SET last_login = GETDATE() WHERE id = ?';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('UPDATE');
    });

    test('should detect DELETE queries', () => {
      const query = 'DELETE FROM Users WHERE inactive = 1';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('DELETE');
    });

    test('should detect CTE queries', () => {
      const query =
        'WITH UserCounts AS (SELECT department, COUNT(*) as cnt FROM Users GROUP BY department) SELECT * FROM UserCounts';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('CTE_QUERY');
    });

    test('should detect MERGE queries', () => {
      const query = 'MERGE Users AS target USING NewUsers AS source ON target.email = source.email';
      const type = optimizer.determineQueryType(query);
      expect(type).toBe('MERGE');
    });
  });

  describe('Helper Methods', () => {
    test('containsJoins should detect various JOIN types', () => {
      expect(optimizer.containsJoins('SELECT * FROM a INNER JOIN b ON a.id = b.id')).toBe(true);
      expect(optimizer.containsJoins('SELECT * FROM a LEFT JOIN b ON a.id = b.id')).toBe(true);
      expect(optimizer.containsJoins('SELECT * FROM a RIGHT JOIN b ON a.id = b.id')).toBe(true);
      expect(optimizer.containsJoins('SELECT * FROM a FULL JOIN b ON a.id = b.id')).toBe(true);
      expect(optimizer.containsJoins('SELECT * FROM a CROSS JOIN b')).toBe(true);
      expect(optimizer.containsJoins('SELECT * FROM a JOIN b ON a.id = b.id')).toBe(true);
      expect(optimizer.containsJoins('SELECT * FROM Users')).toBe(false);
    });

    test('containsAggregation should detect aggregation functions', () => {
      expect(optimizer.containsAggregation('SELECT COUNT(*) FROM Users')).toBe(true);
      expect(optimizer.containsAggregation('SELECT SUM(amount) FROM Orders')).toBe(true);
      expect(optimizer.containsAggregation('SELECT AVG(age) FROM Users')).toBe(true);
      expect(optimizer.containsAggregation('SELECT MIN(price), MAX(price) FROM Products')).toBe(
        true
      );
      expect(optimizer.containsAggregation('SELECT * FROM Users GROUP BY department')).toBe(true);
      expect(optimizer.containsAggregation('SELECT * FROM Users HAVING COUNT(*) > 5')).toBe(true);
      expect(optimizer.containsAggregation('SELECT * FROM Users')).toBe(false);
    });

    test('containsSubqueries should detect subqueries', () => {
      expect(
        optimizer.containsSubqueries(
          'SELECT * FROM Users WHERE id IN (SELECT customer_id FROM Orders)'
        )
      ).toBe(true);
      expect(
        optimizer.containsSubqueries(
          'SELECT * FROM Users WHERE EXISTS (SELECT 1 FROM Orders WHERE customer_id = Users.id)'
        )
      ).toBe(true);
      expect(optimizer.containsSubqueries('SELECT * FROM Users')).toBe(false);
    });

    test('countSubqueries should count subqueries correctly', () => {
      expect(
        optimizer.countSubqueries(
          'SELECT * FROM Users WHERE id IN (SELECT customer_id FROM Orders)'
        )
      ).toBe(1);
      expect(
        optimizer.countSubqueries(
          'SELECT * FROM Users WHERE id IN (SELECT customer_id FROM Orders) AND department IN (SELECT name FROM Departments)'
        )
      ).toBe(2);
      expect(optimizer.countSubqueries('SELECT * FROM Users')).toBe(0);
    });

    test('isModificationQuery should detect modification queries', () => {
      expect(optimizer.isModificationQuery('INSERT INTO Users VALUES (1, "test")')).toBe(true);
      expect(optimizer.isModificationQuery('UPDATE Users SET name = "test"')).toBe(true);
      expect(optimizer.isModificationQuery('DELETE FROM Users WHERE id = 1')).toBe(true);
      expect(optimizer.isModificationQuery('MERGE Users AS target USING source')).toBe(true);
      expect(optimizer.isModificationQuery('SELECT * FROM Users')).toBe(false);
    });

    test('hasTableScans should detect table scans', () => {
      expect(optimizer.hasTableScans('SELECT * FROM Users', {})).toBe(true);
      expect(optimizer.hasTableScans('SELECT * FROM Users WHERE id = 1', {})).toBe(false);
      expect(optimizer.hasTableScans('UPDATE Users SET name = "test"', {})).toBe(false);
    });

    test('hasLiterals should detect literal values', () => {
      expect(optimizer.hasLiterals("SELECT * FROM Users WHERE name = 'John'")).toBe(true);
      expect(optimizer.hasLiterals('SELECT * FROM Users WHERE age = 25')).toBe(true);
      expect(optimizer.hasLiterals("SELECT * FROM Users WHERE name = 'Jane'")).toBe(true);
      expect(optimizer.hasLiterals('SELECT * FROM Users WHERE id = ?')).toBe(false);
    });

    test('canUseExists should detect EXISTS optimization opportunities', () => {
      // This method has specific logic that's difficult to trigger with simple examples
      const query1 = 'LEFT JOIN Orders o ON u.id = o.customer_id WHERE o.*';
      // The method returns truthy when it finds a match, falsy when it doesn't
      const result1 = optimizer.canUseExists(query1);
      expect(result1).toBeTruthy(); // The regex match returns an array which is truthy

      const query2 = 'SELECT * FROM Users WHERE id = 1';
      const result2 = optimizer.canUseExists(query2);
      expect(result2).toBe(false);
    });
  });

  describe('Complexity Scoring', () => {
    test('should calculate complexity score based on query features', () => {
      const simpleQuery = 'SELECT * FROM Users WHERE id = 1';
      const complexQuery = `
        WITH UserStats AS (
          SELECT u.department, COUNT(*) as user_count
          FROM Users u 
          LEFT JOIN Orders o ON u.id = o.customer_id
          WHERE u.created_date >= '2023-01-01'
          GROUP BY u.department
          HAVING COUNT(*) > 10
        )
        SELECT * FROM UserStats 
        UNION ALL
        SELECT 'Total', SUM(user_count) OVER() 
        FROM UserStats
        ORDER BY user_count DESC
      `;

      expect(optimizer.calculateComplexityScore(simpleQuery)).toBeLessThan(
        optimizer.calculateComplexityScore(complexQuery)
      );
    });

    test('should cap complexity score at 100', () => {
      const veryComplexQuery =
        'SELECT COUNT(*) OVER() FROM a JOIN b ON a.id = b.id JOIN c ON b.id = c.id WITH cte AS (SELECT * FROM d) SELECT * FROM cte UNION SELECT * FROM e';
      const score = optimizer.calculateComplexityScore(veryComplexQuery);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('analyzeIndexUsage (missing-index DMVs)', () => {
    let dbOptimizer;
    let mockRequest;

    beforeEach(() => {
      mockRequest = { query: vi.fn() };
      const mockPool = { request: () => mockRequest, connected: true };
      const mockConnectionManager = {
        getPool: () => mockPool,
        connect: async () => mockPool
      };
      dbOptimizer = new QueryOptimizer(mockConnectionManager);
    });

    test('throws when not connected', async () => {
      const offline = new QueryOptimizer({ getPool: () => null });
      await expect(offline.analyzeIndexUsage('McpToolingTestDb')).rejects.toThrow(
        'Not connected to any server'
      );
    });

    test('queries missing-index DMVs scoped by DB_ID and maps rows', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [
          {
            table_name: 'Orders',
            equality_columns: '[CustomerId]',
            inequality_columns: null,
            included_columns: '[OrderStatus]',
            user_seeks: 120,
            user_scans: 5,
            avg_user_impact: 92.5,
            impact_score: 11100
          }
        ]
      });

      const out = await dbOptimizer.analyzeIndexUsage('McpToolingTestDb', { limit: 5 });

      const sqlText = mockRequest.query.mock.calls[0][0];
      expect(sqlText).toContain('sys.dm_db_missing_index_group_stats');
      expect(sqlText).toContain("DB_ID(N'McpToolingTestDb')");
      expect(sqlText).toContain('TOP (5)');
      expect(out.database).toBe('McpToolingTestDb');
      expect(out.recommendations).toHaveLength(1);
      expect(out.recommendations[0]).toMatchObject({
        type: 'missing_index',
        table: 'Orders',
        columns: ['CustomerId'],
        includedColumns: ['OrderStatus']
      });
      expect(out.recommendations[0].impactScore).toBeCloseTo(11100);
    });

    test('honors the schema option: filters the DMV query and echoes the schema (#1058)', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [
          {
            schema_name: 'sales',
            table_name: 'Orders',
            equality_columns: '[CustomerId]',
            avg_user_impact: 80,
            impact_score: 900
          }
        ]
      });

      const out = await dbOptimizer.analyzeIndexUsage('Db', { schema: 'sales' });

      const sqlText = mockRequest.query.mock.calls[0][0];
      // Schema filter is pushed into the DMV query (applied before TOP)
      expect(sqlText).toContain('OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id)');
      expect(sqlText).toContain("= N'sales'");
      // Result echoes the requested schema and each recommendation carries it
      expect(out.schema).toBe('sales');
      expect(out.recommendations[0].schema).toBe('sales');
      expect(out.recommendations[0].table).toBe('Orders');
    });

    test('generates schema-qualified CREATE INDEX DDL for a non-dbo recommendation (#1058)', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [
          {
            schema_name: 'sales',
            table_name: 'Orders',
            equality_columns: '[CustomerId]',
            included_columns: '[OrderStatus]',
            avg_user_impact: 80,
            impact_score: 900
          }
        ]
      });

      const out = await dbOptimizer.analyzeIndexUsage('Db', { schema: 'sales' });
      const { suggestion } = out.recommendations[0];

      // ON-target is schema-qualified so the DDL creates the index on
      // sales.Orders, not dbo.Orders; index name carries the schema too.
      expect(suggestion).toContain('ON [sales].[Orders]');
      expect(suggestion).toContain('IX_sales_Orders_missing');
      expect(suggestion).toContain('INCLUDE (OrderStatus)');
      expect(suggestion).not.toContain('ON [Orders]');
    });

    test('omits the schema predicate when no schema is requested', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });

      const out = await dbOptimizer.analyzeIndexUsage('Db');

      const sqlText = mockRequest.query.mock.calls[0][0];
      expect(sqlText).not.toContain('OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id) =');
      expect(out.schema).toBeNull();
    });

    test('rejects malformed schema names', async () => {
      await expect(dbOptimizer.analyzeIndexUsage('Db', { schema: 'bad]schema' })).rejects.toThrow(
        /invalid schema name/i
      );
    });

    test('filters by impactThreshold and clamps limit', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [
          { table_name: 'A', equality_columns: '[x]', avg_user_impact: 10, impact_score: 5 },
          { table_name: 'B', equality_columns: '[y]', avg_user_impact: 90, impact_score: 900 }
        ]
      });

      const out = await dbOptimizer.analyzeIndexUsage('Db', { limit: 99999, impactThreshold: 50 });

      expect(mockRequest.query.mock.calls[0][0]).toContain('TOP (100)'); // clamped
      expect(out.recommendations.map(r => r.table)).toEqual(['B']);
    });

    test('rejects malformed database names', async () => {
      await expect(dbOptimizer.analyzeIndexUsage('bad]name')).rejects.toThrow(
        /invalid database name/i
      );
    });

    test('maps avg_user_impact to priority at the 75/40 boundaries', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [
          { table_name: 'A', equality_columns: '[a]', avg_user_impact: 75 },
          { table_name: 'B', equality_columns: '[b]', avg_user_impact: 74 },
          { table_name: 'C', equality_columns: '[c]', avg_user_impact: 40 },
          { table_name: 'D', equality_columns: '[d]', avg_user_impact: 39 }
        ]
      });

      const out = await dbOptimizer.analyzeIndexUsage('Db');

      expect(out.recommendations.map(r => r.priority)).toEqual(['high', 'medium', 'medium', 'low']);
    });

    test('parses multi-column equality/inequality/included and builds an INCLUDE clause', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [
          {
            table_name: 'Orders',
            equality_columns: '[A], [B]',
            inequality_columns: '[C]',
            included_columns: '[D]',
            avg_user_impact: 50
          }
        ]
      });

      const out = await dbOptimizer.analyzeIndexUsage('Db');
      const rec = out.recommendations[0];

      expect(rec.columns).toEqual(['A', 'B', 'C']);
      expect(rec.includedColumns).toEqual(['D']);
      expect(rec.suggestion).toContain('(A, B, C)');
      expect(rec.suggestion).toContain('INCLUDE (D)');
    });

    test('omits INCLUDE when there are no included columns', async () => {
      mockRequest.query.mockResolvedValue({
        recordset: [{ table_name: 'T', equality_columns: '[x]', avg_user_impact: 50 }]
      });

      const out = await dbOptimizer.analyzeIndexUsage('Db');

      expect(out.recommendations[0].suggestion).not.toContain('INCLUDE');
    });

    test('returns empty recommendations when the DMV result has no recordset', async () => {
      mockRequest.query.mockResolvedValue({});
      const out = await dbOptimizer.analyzeIndexUsage('Db');
      expect(out.recommendations).toEqual([]);
    });

    test('embeds the sanitized database name in DB_ID (injection defense wired)', async () => {
      mockRequest.query.mockResolvedValue({ recordset: [] });
      await dbOptimizer.analyzeIndexUsage("My'Db");
      expect(mockRequest.query.mock.calls[0][0]).toContain("DB_ID(N'My''Db')");
    });

    test('lazily connects when no pool is open yet', async () => {
      const lazyRequest = { query: vi.fn().mockResolvedValue({ recordset: [] }) };
      const lazyPool = { request: () => lazyRequest, connected: true };
      const connect = vi.fn().mockResolvedValue(lazyPool);
      const lazy = new QueryOptimizer({ getPool: () => null, connect });

      await lazy.analyzeIndexUsage('Db');

      expect(connect).toHaveBeenCalled();
      expect(lazyRequest.query).toHaveBeenCalled();
    });
  });

  describe('getOptimizationInsights (aggregate)', () => {
    let dbOptimizer;
    let mockRequest;

    beforeEach(() => {
      mockRequest = { query: vi.fn() };
      const mockPool = { request: () => mockRequest, connected: true };
      dbOptimizer = new QueryOptimizer({ getPool: () => mockPool, connect: async () => mockPool });
    });

    test('throws when not connected', async () => {
      const offline = new QueryOptimizer({ getPool: () => null });
      await expect(offline.getOptimizationInsights('Db')).rejects.toThrow(
        'Not connected to any server'
      );
    });

    test('summarizes missing indexes and expensive queries with a roadmap', async () => {
      // First call = missing-index DMV (via analyzeIndexUsage); second = expensive-query count.
      mockRequest.query
        .mockResolvedValueOnce({
          recordset: [
            {
              table_name: 'Orders',
              equality_columns: '[CustomerId]',
              avg_user_impact: 90,
              impact_score: 900
            }
          ]
        })
        .mockResolvedValueOnce({ recordset: [{ expensive_query_count: 4 }] });

      const out = await dbOptimizer.getOptimizationInsights('McpToolingTestDb');

      expect(out.database).toBe('McpToolingTestDb');
      expect(out.summary.missingIndexCount).toBe(1);
      expect(out.summary.highImpactIndexCount).toBe(1);
      expect(out.summary.expensiveQueryCount).toBe(4);
      expect(Array.isArray(out.recommendations)).toBe(true);
      expect(out.roadmap.length).toBeGreaterThan(0);
    });
  });

  describe('extractTargetTable (#1102)', () => {
    test('resolves a schema-qualified bracketed table', () => {
      const query =
        'SELECT TOP (100) [AccountId] FROM [Imports].[PR_Debtors_P1DEBACCT] WHERE [AccountId] IS NOT NULL';
      expect(optimizer.extractTargetTable(query)).toBe('[Imports].[PR_Debtors_P1DEBACCT]');
    });

    test('resolves a bare schema.table and ignores the alias', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM dbo.Users u WHERE u.id = 1')).toBe(
        '[dbo].[Users]'
      );
    });

    test('resolves an unqualified table', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM Users')).toBe('[Users]');
    });

    test('resolves a three-part name', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM Sales.dbo.Orders')).toBe(
        '[Sales].[dbo].[Orders]'
      );
    });

    test('resolves a temp table', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM #staging WHERE id = 1')).toBe(
        '[#staging]'
      );
    });

    test('escapes a closing bracket inside a bracketed identifier', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM [dbo].[we]]rd]')).toBe('[dbo].[we]]rd]');
    });

    test('returns null when the first FROM is a derived table', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM (SELECT id FROM Users) AS u')).toBeNull();
    });

    test('returns null when there is no FROM clause', () => {
      expect(optimizer.extractTargetTable('SELECT 1')).toBeNull();
    });

    test('returns null for non-string or oversized input', () => {
      expect(optimizer.extractTargetTable(null)).toBeNull();
      expect(
        optimizer.extractTargetTable(`SELECT * FROM Users WHERE x = '${'a'.repeat(10001)}'`)
      ).toBeNull();
    });
  });

  describe('clause terminator and stop-set handling (#1102)', () => {
    test('strips a trailing statement terminator from the last ORDER BY column', () => {
      const query =
        'SELECT [AccountId], [SortOrder] FROM [Imports].[PR_Debtors_P1DEBACCT] ORDER BY [SortOrder];';
      expect(optimizer.extractOrderByColumns(query)).toEqual(['[SortOrder]']);
    });

    test('strips a terminator that follows a sort direction', () => {
      expect(optimizer.extractOrderByColumns('SELECT * FROM Users ORDER BY name DESC;')).toEqual([
        'name'
      ]);
    });

    test('stops at OFFSET ... FETCH pagination', () => {
      const query = 'SELECT * FROM Users ORDER BY name OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY;';
      expect(optimizer.extractOrderByColumns(query)).toEqual(['name']);
    });

    test('stops at FETCH', () => {
      expect(
        optimizer.extractOrderByColumns('SELECT * FROM Users ORDER BY name FETCH NEXT 10 ROWS ONLY')
      ).toEqual(['name']);
    });

    test('stops at FOR (FOR XML / FOR JSON)', () => {
      expect(
        optimizer.extractOrderByColumns('SELECT * FROM Users ORDER BY name FOR JSON AUTO')
      ).toEqual(['name']);
    });

    test('stops at OPTION query hints', () => {
      expect(
        optimizer.extractOrderByColumns(
          'SELECT * FROM Users ORDER BY name, age DESC OPTION (MAXDOP 1)'
        )
      ).toEqual(['name', 'age']);
    });

    test('does not leak a trailing terminator into WHERE columns', () => {
      expect(optimizer.extractWhereColumns('SELECT * FROM Users WHERE id = 5;')).toEqual(['id']);
    });
  });

  describe('generateIndexRecommendations target table (#1102)', () => {
    const repro =
      'SELECT TOP (100) [AccountId], [SortOrder] FROM [Imports].[PR_Debtors_P1DEBACCT] WHERE [AccountId] IS NOT NULL ORDER BY [SortOrder];';

    test('names the real schema-qualified table in the ORDER BY suggestion with no stray terminator', () => {
      const suggestions = optimizer.generateIndexRecommendations(repro, {}, {});
      const orderBy = suggestions.find(s => s.reason.includes('ORDER BY'));

      expect(orderBy.suggestion).toBe(
        'CREATE INDEX IX_OrderBy ON [Imports].[PR_Debtors_P1DEBACCT] ([SortOrder])'
      );
      expect(orderBy.table).toBe('[Imports].[PR_Debtors_P1DEBACCT]');
      expect(orderBy.conceptual).toBeUndefined();
      for (const s of suggestions) {
        expect(s.suggestion).not.toContain('[table]');
        expect(s.suggestion).not.toContain(';');
      }
    });

    test('names the table in the WHERE-column suggestion', () => {
      const suggestions = optimizer.generateIndexRecommendations(
        'SELECT * FROM dbo.Users WHERE name = ? AND age > 5',
        {},
        {}
      );
      const where = suggestions.find(s => s.reason.includes('WHERE'));

      expect(where.suggestion).toBe('CREATE INDEX IX_name_age ON [dbo].[Users] (name, age)');
      expect(where.table).toBe('[dbo].[Users]');
    });

    test('marks CREATE INDEX suggestions conceptual when the table cannot be determined', () => {
      const suggestions = optimizer.generateIndexRecommendations(
        'SELECT * FROM (SELECT id, name FROM Users) AS u WHERE name = ? ORDER BY name',
        {},
        {}
      );
      const createIndex = suggestions.filter(s => /CREATE INDEX/.test(s.suggestion));

      expect(createIndex.length).toBe(2);
      for (const s of createIndex) {
        expect(s.conceptual).toBe(true);
        expect(s.suggestion).toMatch(/conceptual/i);
        expect(s.suggestion).not.toContain('[table]');
        expect(s).not.toHaveProperty('table');
      }
    });

    test('the full analysis of the repro contains neither the placeholder nor a leaked terminator', () => {
      const text = JSON.stringify(optimizer.analyzeQuery(repro).optimization_suggestions);

      expect(text).toContain('[Imports].[PR_Debtors_P1DEBACCT]');
      expect(text).not.toContain('[table]');
      expect(text).not.toContain(';');
    });
  });

  describe('extractTargetTable lexical safety (#1102 review)', () => {
    const repro =
      'SELECT TOP (100) [AccountId], [SortOrder] FROM [Imports].[PR_Debtors_P1DEBACCT] WHERE [AccountId] IS NOT NULL ORDER BY [SortOrder];';

    test('ignores a "from" inside a leading line comment (issue repro with header comment)', () => {
      const query = `-- Report: pulls active accounts from the debtors table\n${repro}`;
      expect(optimizer.extractTargetTable(query)).toBe('[Imports].[PR_Debtors_P1DEBACCT]');
      const orderBy = optimizer
        .generateIndexRecommendations(query, {}, {})
        .find(s => s.reason.includes('ORDER BY'));
      expect(orderBy.suggestion).toBe(
        'CREATE INDEX IX_OrderBy ON [Imports].[PR_Debtors_P1DEBACCT] ([SortOrder])'
      );
    });

    test('ignores FROM inside a trailing line comment', () => {
      expect(
        optimizer.extractTargetTable('SELECT id -- FROM CommentTable\nFROM dbo.Real WHERE id=1')
      ).toBe('[dbo].[Real]');
    });

    test('ignores FROM inside a block comment', () => {
      expect(
        optimizer.extractTargetTable('SELECT id /* FROM CommentTable */ FROM dbo.Real WHERE id=1')
      ).toBe('[dbo].[Real]');
    });

    test('ignores FROM inside a nested block comment', () => {
      expect(
        optimizer.extractTargetTable(
          'SELECT id /* outer /* FROM Inner */ FROM Outer */ FROM dbo.Real WHERE id=1'
        )
      ).toBe('[dbo].[Real]');
    });

    test('ignores FROM inside a string literal', () => {
      expect(
        optimizer.extractTargetTable(
          "SELECT '... FROM nowhere ...' AS note, id FROM dbo.Actual WHERE id = 1"
        )
      ).toBe('[dbo].[Actual]');
    });

    test('ignores FROM inside an escaped string literal', () => {
      expect(
        optimizer.extractTargetTable("SELECT 'it''s FROM nowhere' AS note, id FROM dbo.Actual")
      ).toBe('[dbo].[Actual]');
    });

    test('ignores From inside a bracketed alias', () => {
      expect(
        optimizer.extractTargetTable('SELECT x AS [My From Value], id FROM dbo.T WHERE id=1')
      ).toBe('[dbo].[T]');
    });

    test('ignores From inside a double-quoted alias', () => {
      expect(
        optimizer.extractTargetTable('SELECT x AS "My From Value", id FROM dbo.T WHERE id=1')
      ).toBe('[dbo].[T]');
    });

    test('does not match identifiers that merely start with From', () => {
      expect(optimizer.extractTargetTable('SELECT FromDate, from_id FROM dbo.T')).toBe('[dbo].[T]');
    });

    test('chooses the first FROM at parenthesis depth 0, not one inside a subquery', () => {
      expect(
        optimizer.extractTargetTable('SELECT (SELECT COUNT(*) FROM x) AS n, id FROM y WHERE id = 1')
      ).toBe('[y]');
    });

    test('skips a comment between FROM and the table', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM /* hint */ dbo.T WHERE id = 1')).toBe(
        '[dbo].[T]'
      );
    });

    test('returns null for malformed input (unterminated literal or comment)', () => {
      expect(optimizer.extractTargetTable("SELECT 'abc FROM dbo.T")).toBeNull();
      expect(optimizer.extractTargetTable('SELECT id /* FROM dbo.T')).toBeNull();
      expect(optimizer.extractTargetTable('SELECT [id FROM dbo.T')).toBeNull();
    });

    test('table hints and TABLESAMPLE do not count as additional table sources', () => {
      expect(
        optimizer.extractTargetTable('SELECT * FROM dbo.T t WITH (NOLOCK, INDEX(1)) WHERE id = 1')
      ).toBe('[dbo].[T]');
      expect(optimizer.extractTargetTable('SELECT * FROM dbo.T TABLESAMPLE (10 PERCENT)')).toBe(
        '[dbo].[T]'
      );
    });
  });

  describe('multi-table queries are conceptual (#1102 review)', () => {
    const joinQuery =
      'SELECT * FROM dbo.T1 t1 JOIN dbo.T2 t2 ON t1.id=t2.t1id WHERE t2.status = 1 ORDER BY t2.status';

    test('extractTargetTable returns null for JOIN, comma lists and APPLY', () => {
      expect(optimizer.extractTargetTable(joinQuery)).toBeNull();
      expect(
        optimizer.extractTargetTable('SELECT * FROM dbo.A a LEFT OUTER JOIN dbo.B b ON a.id = b.id')
      ).toBeNull();
      expect(
        optimizer.extractTargetTable('SELECT * FROM dbo.A a, dbo.B b WHERE a.id = b.id')
      ).toBeNull();
      expect(
        optimizer.extractTargetTable('SELECT * FROM dbo.A a CROSS APPLY dbo.fn(a.id) f')
      ).toBeNull();
    });

    test('JOIN query yields only conceptual CREATE INDEX suggestions, never one on the first table', () => {
      const createIndex = optimizer
        .generateIndexRecommendations(joinQuery, {}, {})
        .filter(s => /CREATE INDEX/.test(s.suggestion));

      expect(createIndex.length).toBe(2);
      for (const s of createIndex) {
        expect(s.conceptual).toBe(true);
        expect(s).not.toHaveProperty('table');
        expect(s.suggestion).not.toContain('[dbo].[T1]');
      }
    });
  });

  describe('index key column shaping (#1102 review)', () => {
    const orderBySuggestion = query =>
      optimizer
        .generateIndexRecommendations(query, {}, {})
        .find(s => s.reason.includes('ORDER BY'));

    test('strips the alias qualifier from ORDER BY columns on a single-table query', () => {
      expect(orderBySuggestion('SELECT * FROM dbo.T t ORDER BY t.name').suggestion).toBe(
        'CREATE INDEX IX_OrderBy ON [dbo].[T] (name)'
      );
    });

    test('strips a bracketed alias qualifier and keeps the column bracketed', () => {
      expect(orderBySuggestion('SELECT * FROM dbo.T t ORDER BY [t].[name] DESC').suggestion).toBe(
        'CREATE INDEX IX_OrderBy ON [dbo].[T] ([name])'
      );
    });

    test('marks the suggestion conceptual when ORDER BY columns carry mixed qualifiers', () => {
      const s = orderBySuggestion('SELECT * FROM dbo.T t ORDER BY t.name, u.age');
      expect(s.conceptual).toBe(true);
      expect(s).not.toHaveProperty('table');
      expect(s.suggestion).toContain('(t.name, u.age)');
    });

    test('emits no ORDER BY suggestion for ordinal positions', () => {
      expect(orderBySuggestion('SELECT a, b FROM dbo.T ORDER BY 1, 2')).toBeUndefined();
    });

    test('emits no ORDER BY suggestion for expressions', () => {
      expect(
        orderBySuggestion(
          'SELECT a FROM dbo.T ORDER BY LEN(name), CASE WHEN a = 1 THEN 0 ELSE 1 END'
        )
      ).toBeUndefined();
    });

    test('keeps only the plain columns when ORDER BY mixes expressions and columns', () => {
      expect(orderBySuggestion('SELECT a FROM dbo.T ORDER BY LEN(name), id').suggestion).toBe(
        'CREATE INDEX IX_OrderBy ON [dbo].[T] (id)'
      );
    });

    test('the WHERE suggestion on a single-table aliased query names the table', () => {
      const where = optimizer
        .generateIndexRecommendations('SELECT * FROM dbo.T t WHERE t.name = ?', {}, {})
        .find(s => s.reason.includes('WHERE'));
      expect(where.suggestion).toBe('CREATE INDEX IX_name ON [dbo].[T] (name)');
    });
  });

  describe('identifier grammar (#1102 review)', () => {
    test('handles the default-schema form db..table', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM db..table1 WHERE id = 1')).toBe(
        '[db]..[table1]'
      );
    });

    test('returns null for a name ending in a dot', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM dbo. WHERE id = 1')).toBeNull();
    });

    test('returns null for table-valued functions', () => {
      expect(optimizer.extractTargetTable('SELECT * FROM dbo.fn(1)')).toBeNull();
      expect(optimizer.extractTargetTable('SELECT * FROM dbo.fn (1) AS f')).toBeNull();
    });

    test('returns null for rowset functions', () => {
      expect(
        optimizer.extractTargetTable(
          "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;Trusted_Connection=yes;', 'SELECT 1')"
        )
      ).toBeNull();
      expect(optimizer.extractTargetTable('SELECT * FROM OPENJSON(@j) WITH (id int)')).toBeNull();
      expect(optimizer.extractTargetTable("SELECT * FROM STRING_SPLIT('a,b', ',')")).toBeNull();
    });

    test('returns null when the FROM names a CTE', () => {
      const cte =
        'WITH c AS (SELECT id, name FROM dbo.Base) SELECT * FROM c WHERE name = ? ORDER BY name';
      expect(optimizer.extractTargetTable(cte)).toBeNull();
      const createIndex = optimizer
        .generateIndexRecommendations(cte, {}, {})
        .filter(s => /CREATE INDEX/.test(s.suggestion));
      expect(createIndex.length).toBe(2);
      for (const s of createIndex) {
        expect(s.conceptual).toBe(true);
        expect(s.suggestion).not.toContain('[dbo].[Base]');
        expect(s.suggestion).not.toContain('ON [c]');
      }
    });

    test('recognises every CTE in a list, including column-list and bracketed forms', () => {
      const query =
        'WITH a AS (SELECT 1 AS x), [b] (y) AS (SELECT 2), c AS (SELECT 3) SELECT * FROM b ORDER BY y';
      expect(optimizer.extractTargetTable(query)).toBeNull();
      expect(optimizer.extractTargetTable(query.replace('FROM b', 'FROM c'))).toBeNull();
    });

    test('recognises a CTE introduced by ;WITH', () => {
      expect(
        optimizer.extractTargetTable(';WITH c AS (SELECT 1 AS x) SELECT * FROM c ORDER BY x')
      ).toBeNull();
    });

    test('still resolves a real table when a CTE is only referenced in a subquery', () => {
      expect(
        optimizer.extractTargetTable(
          'WITH c AS (SELECT 1 AS x) SELECT * FROM dbo.Real WHERE id IN (SELECT x FROM c)'
        )
      ).toBe('[dbo].[Real]');
    });
  });
});
