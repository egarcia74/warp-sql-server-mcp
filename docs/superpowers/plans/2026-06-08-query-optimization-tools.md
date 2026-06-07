# Query Optimization Tools — Fix & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stubbed/broken query-optimization tools (`explain_query`, `get_index_recommendations`, `detect_query_bottlenecks`, `get_optimization_insights`) with real SQL Server DMV-backed implementations, wire up the tool parameters that are currently dropped, and reconcile the docs so claims match behavior.

**Architecture:** The MCP server (`index.js`) dispatches tool calls to handlers. Database I/O lives in `lib/tools/handlers/database-tools.js` (extends `BaseToolHandler`). Analysis lives in `lib/analysis/query-optimizer.js` (index recommendations, optimization insights) and `lib/analysis/bottleneck-detector.js` (bottlenecks). We keep that split: DMV queries that produce raw rows go through the analysis classes, which already receive a `connectionManager` and call `connectionManager.getPool()`. `explain_query` stays in `database-tools.js` but is fixed to pin a single connection so `SET SHOWPLAN`/`SET STATISTICS` session state actually applies to the query batch.

**Tech Stack:** Node.js (ESM), `mssql` (`import sql from 'mssql'`), Vitest (unit tests with `vi.mock('mssql')` via `test/unit/mcp-shared-fixtures.js`), Model Context Protocol SDK. Live verification via the `wssm-local` MCP server against the `McpToolingTestDb` database.

---

## Background: verified findings (2026-06-08)

All 16 tools were exercised against `McpToolingTestDb` via `wssm-local`. Twelve work. Four do not:

| Tool                        | Symptom                                                        | Root cause                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explain_query`             | Returns result rows, not a plan; `include_actual_plan` ignored | `database-tools.js:343-350` runs `SET SHOWPLAN_ALL ON`, the query, and `SET OFF` as three separate `request.query()` calls on a **pooled** request → different physical connections → SHOWPLAN session state does not apply to the query batch. `include_actual_plan` is never passed from `index.js:310`. |
| `get_index_recommendations` | Hardcoded `example_table` / `column1,column2`                  | `query-optimizer.js:738-757` `analyzeIndexUsage()` returns a literal stub ("this would normally query SQL Server DMVs").                                                                                                                                                                                   |
| `detect_query_bottlenecks`  | Returns `[]`                                                   | `bottleneck-detector.js:498-510` `detectBottlenecks()` is a stub ("Placeholder for actual implementation").                                                                                                                                                                                                |
| `get_optimization_insights` | Returns `{}`                                                   | `query-optimizer.js:783-795` `getOptimizationInsights()` is a stub.                                                                                                                                                                                                                                        |

Secondary issues addressed by this plan:

- **Dropped parameters:** `index.js:308-346` case handlers forward only `args.database` (and `args.query`). The schemas advertise `include_actual_plan`, `limit`, `impact_threshold`, `schema`, `severity_filter`, `analysis_period` — all silently ignored.
- **Dead/duplicate code:** `query-optimizer.js:764-776` `getIndexRecommendations(query)` is an unused stub (the live path is `analyzeIndexUsage`). Remove it.
- **Docs mismatch:** `WARP.md` marks "Query Optimization & Performance Tools" as "✅ COMPLETED v1.5.0". After this work that becomes true; until then it is inaccurate.

### Connection-pinning note (applies to every DMV query)

`USE [db]` in one `request.query()` batch followed by `DB_ID()` in a later batch hits the **same pooling bug** as `explain_query` — the two batches may run on different connections. **Therefore every DMV query in this plan scopes the database inline via `DB_ID(N'<name>')` and never relies on `USE` + later-batch session state.** This keeps each analysis method to a single `request.query()` call, which is correct under pooling and trivially unit-testable.

### Database-name sanitization helper (used by Tasks 2-4)

Database names are interpolated into `DB_ID(N'...')`. Escape single quotes. Reject anything with `]`, `[`, or control characters. Define once and reuse.

---

## File Structure

- **Modify** `lib/tools/handlers/database-tools.js` — rewrite `explainQuery` (Task 1); add private `formatExecutionPlan`.
- **Modify** `lib/analysis/query-optimizer.js` — rewrite `analyzeIndexUsage` (Task 2); rewrite `getOptimizationInsights` (Task 4); add `sanitizeDbName` helper (Task 2); remove dead `getIndexRecommendations(query)` (Task 5).
- **Modify** `lib/analysis/bottleneck-detector.js` — rewrite `detectBottlenecks` (Task 3).
- **Modify** `index.js` — forward dropped args in the four case handlers and the wrapper methods (Tasks 1-4).
- **Modify** `test/unit/mcp-shared-fixtures.js` — extend the `mssql` mock with `Transaction` (Task 1).
- **Modify/Create** test files:
  - `test/unit/database-tools-handler.test.js` — explain_query tests (Task 1).
  - `test/unit/query-optimizer.test.js` — index recs + insights tests (Tasks 2, 4).
  - `test/unit/bottleneck-detector.test.js` — create if absent; bottleneck tests (Task 3).
- **Modify** `WARP.md`, regenerate `docs/tools.json` / `docs/tools.html` / `docs/index.html` (Task 6).

---

## Task 0: Setup

**Files:** none (branch already created: `fix/query-optimization-tools` off `main`).

- [ ] **Step 1: Confirm branch + clean baseline**

Run: `git branch --show-current && git status --short`
Expected: prints `fix/query-optimization-tools` and no changes.

- [ ] **Step 2: Confirm the full unit suite is green before any change**

Run: `npm test`
Expected: all tests pass (baseline ~507). If not, stop and investigate before proceeding.

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-06-08-query-optimization-tools.md
git commit -m "docs: add query-optimization tools fix plan"
```

---

## Task 1: Fix `explain_query` (pin connection + wire `include_actual_plan`)

**Files:**

- Modify: `test/unit/mcp-shared-fixtures.js` (extend mssql mock with `Transaction`)
- Modify: `lib/tools/handlers/database-tools.js:333-412` (`explainQuery`)
- Modify: `index.js:308-311` (case handler) and `index.js:569-572` (wrapper)
- Test: `test/unit/database-tools-handler.test.js`

**Approach:** Use an explicit `mssql` transaction to pin one physical connection for the `SET ... ON` → query → `SET ... OFF` sequence. `include_actual_plan=false` → `SET SHOWPLAN_XML ON` (estimated plan, query does not execute). `include_actual_plan=true` → `SET STATISTICS XML ON` (query executes, plan returned alongside results). Return the plan XML as text.

- [ ] **Step 1: Extend the mssql mock with a Transaction class**

In `test/unit/mcp-shared-fixtures.js`, inside the `vi.mock('mssql', () => ({ ... }))` factory (currently lines 114-127), add a `Transaction` mock to **both** the `default` object and the named exports. The transaction's `begin`/`commit`/`rollback` resolve, and `new sql.Request(transaction)` must keep returning `mocks.mockRequest`.

Replace the factory body with:

```javascript
vi.mock('mssql', () => {
  const TransactionMock = vi.fn(function () {
    return {
      begin: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined)
    };
  });
  const RequestMock = vi.fn(function () {
    return mocks.mockRequest;
  });
  return {
    default: {
      connect: vi.fn(),
      ConnectionPool: vi.fn(),
      Request: RequestMock,
      Transaction: TransactionMock
    },
    connect: vi.fn(),
    ConnectionPool: vi.fn(),
    Request: RequestMock,
    Transaction: TransactionMock
  };
});
```

- [ ] **Step 2: Write the failing tests for explainQuery**

Add a new `describe('explainQuery (execution plan)', ...)` block in `test/unit/database-tools-handler.test.js`. It reuses the file's existing `handler` / `mockRequest` setup (see the top-of-file `beforeEach`). The plan XML column name SQL Server uses is `Microsoft SQL Server 2005 XML Showplan`.

```javascript
describe('explainQuery (execution plan)', () => {
  test('returns estimated plan XML and toggles SHOWPLAN_XML when include_actual_plan is false', async () => {
    const planXml = '<ShowPlanXML>estimated</ShowPlanXML>';
    mockRequest.query.mockReset();
    mockRequest.query
      .mockResolvedValueOnce({ recordset: [] }) // SET SHOWPLAN_XML ON
      .mockResolvedValueOnce({
        recordset: [{ 'Microsoft SQL Server 2005 XML Showplan': planXml }]
      }) // the analyzed query
      .mockResolvedValueOnce({ recordset: [] }); // SET SHOWPLAN_XML OFF

    const result = await handler.explainQuery('SELECT 1', null, false);

    expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_XML ON');
    expect(mockRequest.query).toHaveBeenCalledWith('SET SHOWPLAN_XML OFF');
    expect(result[0].text).toContain(planXml);
  });

  test('uses STATISTICS XML when include_actual_plan is true', async () => {
    mockRequest.query.mockReset();
    mockRequest.query.mockResolvedValue({ recordset: [] });

    await handler.explainQuery('SELECT 1', null, true);

    expect(mockRequest.query).toHaveBeenCalledWith('SET STATISTICS XML ON');
    expect(mockRequest.query).toHaveBeenCalledWith('SET STATISTICS XML OFF');
  });

  test('scopes to a database with USE inside the pinned transaction', async () => {
    mockRequest.query.mockReset();
    mockRequest.query.mockResolvedValue({ recordset: [] });

    await handler.explainQuery('SELECT 1', 'McpToolingTestDb', false);

    expect(mockRequest.query).toHaveBeenCalledWith('USE [McpToolingTestDb]');
  });

  test('rolls back and rethrows on query error', async () => {
    mockRequest.query.mockReset();
    mockRequest.query
      .mockResolvedValueOnce({ recordset: [] }) // SET ON
      .mockRejectedValueOnce(new Error('boom')); // query fails

    await expect(handler.explainQuery('SELECT 1', null, false)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/unit/database-tools-handler.test.js -t "execution plan"`
Expected: FAIL — current `explainQuery` calls `pool.request()` (not a transaction), uses `SET SHOWPLAN_ALL`, and ignores the third argument.

- [ ] **Step 4: Rewrite explainQuery**

In `lib/tools/handlers/database-tools.js`, add the mssql import at the top (after the existing imports on lines 7-8):

```javascript
import sql from 'mssql';
```

Replace the entire `explainQuery` method (lines 333-412) with:

```javascript
  async explainQuery(query, database = null, includeActualPlan = false) {
    const pool = await this.getConnection();
    const transaction = new sql.Transaction(pool);
    const planMode = includeActualPlan ? 'STATISTICS XML' : 'SHOWPLAN_XML';

    try {
      await transaction.begin();
      const request = new sql.Request(transaction);

      if (database) {
        await request.query(`USE [${database}]`);
      }

      // SHOWPLAN/STATISTICS must be its own batch; pinning the transaction's
      // single connection ensures the setting applies to the query batch.
      await request.query(`SET ${planMode} ON`);
      const result = await request.query(query);
      await request.query(`SET ${planMode} OFF`);
      await transaction.commit();

      if (this.performanceMonitor) {
        this.performanceMonitor.recordQuery({
          tool: 'explain_query',
          query,
          executionTime: 0, // plan capture, not a timed execution
          success: true,
          database,
          timestamp: new Date()
        });
      }

      return this.formatExecutionPlan(result);
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {
        // ignore rollback failure; surface the original error below
      }

      if (this.performanceMonitor) {
        this.performanceMonitor.recordQuery({
          tool: 'explain_query',
          query,
          executionTime: 0,
          success: false,
          error: error.message,
          database,
          timestamp: new Date()
        });
      }

      throw error;
    }
  }

  /**
   * Extract execution-plan XML from a result set, falling back to table
   * formatting when no recognizable plan column is present.
   * @private
   */
  formatExecutionPlan(result) {
    const rows = result?.recordset || [];
    const planColumn = rows.length ? Object.keys(rows[0]).find(c => /Showplan/i.test(c)) : null;

    if (planColumn) {
      const xml = rows.map(r => r[planColumn]).join('\n');
      return [{ type: 'text', text: xml }];
    }

    // include_actual_plan=true returns result rows too; fall back to a table.
    return this.formatResults(result);
  }
```

- [ ] **Step 5: Run the explain_query tests to verify they pass**

Run: `npx vitest run test/unit/database-tools-handler.test.js -t "execution plan"`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire `include_actual_plan` through index.js**

In `index.js`, replace the `explain_query` case (lines 308-311) with:

```javascript
          case 'explain_query':
            return {
              content: await this.databaseTools.explainQuery(
                args.query,
                args.database,
                args.include_actual_plan
              )
            };
```

And update the wrapper at `index.js:569-572` so it forwards all args (it already uses `...args`, so confirm it reads):

```javascript
  async explainQuery(...args) {
    try {
      return { content: await this.databaseTools.explainQuery(...args) };
```

(No change needed if it already spreads `...args`; verify and leave as-is.)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Manual live verification (REQUIRED — SHOWPLAN-in-transaction risk)**

There is a known risk that `SET SHOWPLAN_XML ON` behaves unexpectedly inside an explicit transaction. Verify against the live DB before trusting the unit mocks. Ask the operator to call, via `wssm-local`:

`explain_query` with `{ "query": "SELECT * FROM Orders WHERE CustomerId = 1", "database": "McpToolingTestDb" }`

Expected: response contains `<ShowPlanXML ...>` (estimated plan), NOT the Orders rows.

Then with `{ ..., "include_actual_plan": true }` → expected: plan XML present (actual stats).

**Fallback if SHOWPLAN_XML errors inside the transaction:** drop the transaction and instead create a one-shot dedicated pool for the sequence:

```javascript
const dedicated = await new sql.ConnectionPool(this.connectionManager.config).connect();
try {
  const request = dedicated.request();
  /* USE / SET ON / query / SET OFF on this single-connection pool */
} finally {
  await dedicated.close();
}
```

If the fallback is used, update Step 4's code and the Step 2 tests (the mock already returns `mockRequest` from `ConnectionPool`/`request`). Record which path shipped in the commit message.

- [ ] **Step 9: Commit**

```bash
git add lib/tools/handlers/database-tools.js index.js test/unit/database-tools-handler.test.js test/unit/mcp-shared-fixtures.js
git commit -m "fix(explain_query): pin connection for SHOWPLAN and wire include_actual_plan"
```

---

## Task 2: Implement `get_index_recommendations` via missing-index DMVs

**Files:**

- Modify: `lib/analysis/query-optimizer.js:738-757` (`analyzeIndexUsage`); add `sanitizeDbName` helper
- Modify: `index.js:328-331` (case handler) and `index.js:637-656` (wrapper `getIndexRecommendations`)
- Test: `test/unit/query-optimizer.test.js`

**DMV source:** `sys.dm_db_missing_index_group_stats` ⋈ `sys.dm_db_missing_index_groups` ⋈ `sys.dm_db_missing_index_details`, scoped by `mid.database_id = DB_ID(N'<db>')`.

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/query-optimizer.test.js` a new block that constructs the optimizer with a real mock `connectionManager` (the existing top-level `beforeEach` passes a config object as the first arg, which is wrong for DB-backed methods — this block builds its own instance):

```javascript
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
          impact_score: 11100.0
        }
      ]
    });

    const out = await dbOptimizer.analyzeIndexUsage('McpToolingTestDb', { limit: 5 });

    const sql = mockRequest.query.mock.calls[0][0];
    expect(sql).toContain('sys.dm_db_missing_index_group_stats');
    expect(sql).toContain("DB_ID(N'McpToolingTestDb')");
    expect(sql).toContain('TOP (5)');
    expect(out.database).toBe('McpToolingTestDb');
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0]).toMatchObject({
      type: 'missing_index',
      table: 'Orders',
      columns: ['CustomerId'],
      includedColumns: ['OrderStatus']
    });
    expect(out.recommendations[0].impactScore).toBeCloseTo(11100.0);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/query-optimizer.test.js -t "missing-index"`
Expected: FAIL — `analyzeIndexUsage` currently returns the hardcoded stub and ignores its arguments.

- [ ] **Step 3: Add the sanitize helper and rewrite analyzeIndexUsage**

In `lib/analysis/query-optimizer.js`, add a method to the `QueryOptimizer` class (place it just above `analyzeIndexUsage`):

```javascript
  /**
   * Validate a database name for safe inline use in DB_ID(N'...').
   * @param {string|null} database
   * @returns {string|null} sanitized name (single quotes doubled), or null
   */
  sanitizeDbName(database) {
    if (database === null || database === undefined) {
      return null;
    }
    if (typeof database !== 'string' || /[[\] -]/.test(database)) {
      throw new Error(`Invalid database name: ${database}`);
    }
    return database.replace(/'/g, "''");
  }
```

Replace `analyzeIndexUsage` (lines 738-757) with:

```javascript
  async analyzeIndexUsage(database, { limit = 10, impactThreshold = 0 } = {}) {
    const pool = this.connectionManager.getPool();
    if (!pool) {
      throw new Error('Not connected to any server');
    }

    const safeDb = this.sanitizeDbName(database);
    const dbPredicate = safeDb ? `DB_ID(N'${safeDb}')` : 'DB_ID()';
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

    const result = await pool.request().query(`
      SELECT TOP (${safeLimit})
        OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
        mid.equality_columns,
        mid.inequality_columns,
        mid.included_columns,
        migs.user_seeks,
        migs.user_scans,
        migs.avg_user_impact,
        CONVERT(decimal(18,2),
          migs.avg_total_user_cost * migs.avg_user_impact
          * (migs.user_seeks + migs.user_scans)) AS impact_score
      FROM sys.dm_db_missing_index_group_stats migs
      INNER JOIN sys.dm_db_missing_index_groups mig
        ON migs.group_handle = mig.index_group_handle
      INNER JOIN sys.dm_db_missing_index_details mid
        ON mig.index_handle = mid.index_handle
      WHERE mid.database_id = ${dbPredicate}
      ORDER BY impact_score DESC
    `);

    const parseCols = csv =>
      csv
        ? csv
            .split(',')
            .map(c => c.trim().replace(/^\[|\]$/g, ''))
            .filter(Boolean)
        : [];

    const recommendations = (result.recordset || [])
      .filter(r => (r.avg_user_impact ?? 0) >= impactThreshold)
      .map(r => ({
        type: 'missing_index',
        priority: r.avg_user_impact >= 75 ? 'high' : r.avg_user_impact >= 40 ? 'medium' : 'low',
        table: r.table_name,
        columns: [...parseCols(r.equality_columns), ...parseCols(r.inequality_columns)],
        includedColumns: parseCols(r.included_columns),
        avgUserImpact: r.avg_user_impact,
        userSeeks: r.user_seeks,
        userScans: r.user_scans,
        impactScore: r.impact_score,
        suggestion: `CREATE INDEX IX_${r.table_name}_missing ON [${r.table_name}] (${[
          ...parseCols(r.equality_columns),
          ...parseCols(r.inequality_columns)
        ].join(', ')})${
          parseCols(r.included_columns).length
            ? ` INCLUDE (${parseCols(r.included_columns).join(', ')})`
            : ''
        }`
      }));

    return {
      database: database || null,
      timestamp: new Date().toISOString(),
      recommendations,
      unusedIndexes: [],
      duplicateIndexes: [],
      fragmentedIndexes: []
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/query-optimizer.test.js -t "missing-index"`
Expected: PASS (4 tests).

- [ ] **Step 5: Forward `limit` and `impact_threshold` through index.js**

Replace the `get_index_recommendations` case (`index.js:328-331`) with:

```javascript
          case 'get_index_recommendations':
            return {
              content: await this.getIndexRecommendations(args.database, {
                limit: args.limit,
                impactThreshold: args.impact_threshold
              })
            };
```

Update the wrapper at `index.js:637`:

```javascript
  async getIndexRecommendations(database, options = {}) {
    try {
      const recommendations = await this.queryOptimizer.analyzeIndexUsage(database, options);
```

(Leave the rest of the wrapper body unchanged.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Manual live verification**

Via `wssm-local`, call `get_index_recommendations` with `{ "database": "McpToolingTestDb" }`. On a freshly seeded DB the missing-index DMVs may legitimately be empty (`recommendations: []`) — that is correct behavior, not a stub. To force a recommendation, run a few filtered queries first (e.g. `SELECT * FROM Orders WHERE OrderStatus = 'Pending'` several times) then re-check. Confirm output is DMV-derived (real table names, no `example_table`).

- [ ] **Step 8: Commit**

```bash
git add lib/analysis/query-optimizer.js index.js test/unit/query-optimizer.test.js
git commit -m "feat(get_index_recommendations): implement via missing-index DMVs"
```

---

## Task 3: Implement `detect_query_bottlenecks` via query-stats DMVs

**Files:**

- Modify: `lib/analysis/bottleneck-detector.js:498-510` (`detectBottlenecks`); add a `sanitizeDbName` helper (same logic as Task 2)
- Modify: `index.js:338-341` (case handler) and `index.js:675-694` (wrapper `detectQueryBottlenecks`)
- Test: `test/unit/bottleneck-detector.test.js` (create if it does not exist)

**DMV source:** `sys.dm_exec_query_stats` CROSS APPLY `sys.dm_exec_sql_text(sql_handle)`, optionally scoped by `qt.dbid = DB_ID(N'<db>')`, ranked by total worker (CPU) time.

- [ ] **Step 1: Inspect the BottleneckDetector constructor**

Run: `grep -n "constructor" lib/analysis/bottleneck-detector.js`
Expected: a constructor that stores `connectionManager` (mirrors QueryOptimizer). Note the exact property name (`this.connectionManager`) for the test mock and implementation.

- [ ] **Step 2: Write the failing tests**

Create `test/unit/bottleneck-detector.test.js`:

```javascript
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { BottleneckDetector } from '../../lib/analysis/bottleneck-detector.js';

describe('BottleneckDetector.detectBottlenecks (query-stats DMVs)', () => {
  let detector;
  let mockRequest;

  beforeEach(() => {
    mockRequest = { query: vi.fn() };
    const mockPool = { request: () => mockRequest, connected: true };
    detector = new BottleneckDetector({ getPool: () => mockPool, connect: async () => mockPool });
  });

  test('throws when not connected', async () => {
    const offline = new BottleneckDetector({ getPool: () => null });
    await expect(offline.detectBottlenecks('Db')).rejects.toThrow('Not connected to any server');
  });

  test('queries query-stats DMVs and categorizes severity', async () => {
    mockRequest.query.mockResolvedValue({
      recordset: [
        {
          query_text: 'SELECT * FROM Orders',
          execution_count: 500,
          avg_cpu_time_us: 8000000,
          avg_elapsed_time_us: 9000000,
          avg_logical_reads: 200000,
          total_logical_reads: 100000000
        },
        {
          query_text: 'SELECT 1',
          execution_count: 3,
          avg_cpu_time_us: 1000,
          avg_elapsed_time_us: 1200,
          avg_logical_reads: 4,
          total_logical_reads: 12
        }
      ]
    });

    const out = await detector.detectBottlenecks('McpToolingTestDb', { limit: 10 });

    const sql = mockRequest.query.mock.calls[0][0];
    expect(sql).toContain('sys.dm_exec_query_stats');
    expect(sql).toContain('sys.dm_exec_sql_text');
    expect(sql).toContain("DB_ID(N'McpToolingTestDb')");
    expect(out).toHaveLength(2);
    expect(out[0].severity).toBe('CRITICAL'); // 8s avg CPU
    expect(out[0].query).toContain('SELECT * FROM Orders');
    expect(out[1].severity).toBe('LOW');
  });

  test('applies severity_filter', async () => {
    mockRequest.query.mockResolvedValue({
      recordset: [
        {
          query_text: 'big',
          execution_count: 1,
          avg_cpu_time_us: 9000000,
          avg_elapsed_time_us: 9000000,
          avg_logical_reads: 1,
          total_logical_reads: 1
        },
        {
          query_text: 'small',
          execution_count: 1,
          avg_cpu_time_us: 100,
          avg_elapsed_time_us: 100,
          avg_logical_reads: 1,
          total_logical_reads: 1
        }
      ]
    });

    const out = await detector.detectBottlenecks('Db', { severityFilter: 'CRITICAL' });

    expect(out.every(b => b.severity === 'CRITICAL')).toBe(true);
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/unit/bottleneck-detector.test.js`
Expected: FAIL — `detectBottlenecks` currently returns `[]`.

- [ ] **Step 4: Rewrite detectBottlenecks**

In `lib/analysis/bottleneck-detector.js`, add the same `sanitizeDbName` helper as Task 2 (copy the method into this class), then replace `detectBottlenecks` (lines 498-510) with:

```javascript
  async detectBottlenecks(database, { limit = 10, severityFilter = null } = {}) {
    const pool = this.connectionManager.getPool();
    if (!pool) {
      throw new Error('Not connected to any server');
    }

    const safeDb = this.sanitizeDbName(database);
    const dbFilter = safeDb ? `WHERE qt.dbid = DB_ID(N'${safeDb}')` : '';
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

    const result = await pool.request().query(`
      SELECT TOP (${safeLimit})
        SUBSTRING(qt.text,
          (qs.statement_start_offset / 2) + 1,
          ((CASE qs.statement_end_offset
              WHEN -1 THEN DATALENGTH(qt.text)
              ELSE qs.statement_end_offset END
            - qs.statement_start_offset) / 2) + 1) AS query_text,
        qs.execution_count,
        qs.total_worker_time / qs.execution_count AS avg_cpu_time_us,
        qs.total_elapsed_time / qs.execution_count AS avg_elapsed_time_us,
        qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
        qs.total_logical_reads AS total_logical_reads
      FROM sys.dm_exec_query_stats qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
      ${dbFilter}
      ORDER BY qs.total_worker_time DESC
    `);

    const categorize = avgCpuUs => {
      const ms = avgCpuUs / 1000;
      if (ms >= 5000) return 'CRITICAL';
      if (ms >= 1000) return 'HIGH';
      if (ms >= 100) return 'MEDIUM';
      return 'LOW';
    };

    const bottlenecks = (result.recordset || []).map(r => ({
      query: r.query_text,
      severity: categorize(r.avg_cpu_time_us),
      executionCount: r.execution_count,
      avgCpuTimeMs: Math.round(r.avg_cpu_time_us / 1000),
      avgElapsedTimeMs: Math.round(r.avg_elapsed_time_us / 1000),
      avgLogicalReads: r.avg_logical_reads,
      totalLogicalReads: r.total_logical_reads,
      type:
        r.avg_logical_reads >= 100000
          ? 'IO_BOUND'
          : r.avg_cpu_time_us / 1000 >= 1000
            ? 'CPU_BOUND'
            : 'NORMAL'
    }));

    return severityFilter
      ? bottlenecks.filter(b => b.severity === severityFilter)
      : bottlenecks;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/bottleneck-detector.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Forward `limit` and `severity_filter` through index.js**

Replace the `detect_query_bottlenecks` case (`index.js:338-341`):

```javascript
          case 'detect_query_bottlenecks':
            return {
              content: await this.detectQueryBottlenecks(args.database, {
                limit: args.limit,
                severityFilter: args.severity_filter
              })
            };
```

Update the wrapper at `index.js:675`:

```javascript
  async detectQueryBottlenecks(database, options = {}) {
    try {
      const bottlenecks = await this.bottleneckDetector.detectBottlenecks(database, options);
```

(Leave the rest unchanged.)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Manual live verification**

Via `wssm-local`, call `detect_query_bottlenecks` with `{ "database": "McpToolingTestDb" }`. Because we run with `MINIMAL` security on a small DB, results may be modest; confirm the shape is real (query text + severity + metrics), not `[]` for a server that has run queries. `sys.dm_exec_query_stats` requires `VIEW SERVER STATE` — if permission is denied, surface that clearly (caught error), and note it in the commit.

- [ ] **Step 9: Commit**

```bash
git add lib/analysis/bottleneck-detector.js index.js test/unit/bottleneck-detector.test.js
git commit -m "feat(detect_query_bottlenecks): implement via query-stats DMVs"
```

---

## Task 4: Implement `get_optimization_insights` (aggregate health summary)

**Files:**

- Modify: `lib/analysis/query-optimizer.js:783-795` (`getOptimizationInsights`)
- Modify: `index.js:343-346` (case handler) and `index.js:696-711` (wrapper)
- Test: `test/unit/query-optimizer.test.js`

**Approach:** Compose a real summary from `analyzeIndexUsage` (Task 2) plus a compact expensive-query count, and produce a prioritized roadmap. No new DMV beyond what Tasks 2/3 established.

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/query-optimizer.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/query-optimizer.test.js -t "aggregate"`
Expected: FAIL — current `getOptimizationInsights` returns `{}`.

- [ ] **Step 3: Rewrite getOptimizationInsights**

Replace `getOptimizationInsights` (lines 783-795) with:

```javascript
  async getOptimizationInsights(database) {
    const pool = this.connectionManager.getPool();
    if (!pool) {
      throw new Error('Not connected to any server');
    }

    const indexAnalysis = await this.analyzeIndexUsage(database, { limit: 100 });

    const safeDb = this.sanitizeDbName(database);
    const dbFilter = safeDb ? `WHERE qt.dbid = DB_ID(N'${safeDb}')` : '';
    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS expensive_query_count
      FROM sys.dm_exec_query_stats qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
      ${dbFilter ? `${dbFilter} AND` : 'WHERE'}
        qs.total_worker_time / qs.execution_count >= 1000000
    `);

    const missingIndexCount = indexAnalysis.recommendations.length;
    const highImpactIndexCount = indexAnalysis.recommendations.filter(
      r => r.priority === 'high'
    ).length;
    const expensiveQueryCount = countResult.recordset?.[0]?.expensive_query_count ?? 0;

    const roadmap = [];
    if (highImpactIndexCount > 0) {
      roadmap.push({
        priority: 'high',
        action: `Add ${highImpactIndexCount} high-impact missing index(es)`
      });
    }
    if (expensiveQueryCount > 0) {
      roadmap.push({
        priority: 'medium',
        action: `Review ${expensiveQueryCount} expensive query(ies) (>1s avg CPU)`
      });
    }
    if (roadmap.length === 0) {
      roadmap.push({ priority: 'info', action: 'No significant optimization opportunities detected' });
    }

    return {
      database: database || null,
      timestamp: new Date().toISOString(),
      summary: { missingIndexCount, highImpactIndexCount, expensiveQueryCount },
      recommendations: indexAnalysis.recommendations.slice(0, 10),
      roadmap
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/query-optimizer.test.js -t "aggregate"`
Expected: PASS (2 tests).

- [ ] **Step 5: Forward `analysis_period` (accepted, documented as reserved)**

The schema advertises `analysis_period`, but the live DMVs (`dm_exec_query_stats`) reflect cache lifetime, not an arbitrary window, so the value cannot be honored precisely. Forward it so the surface is honest and update docs (Task 6) to mark it reserved. Replace the `get_optimization_insights` case (`index.js:343-346`):

```javascript
          case 'get_optimization_insights':
            return {
              content: await this.getOptimizationInsights(args.database)
            };
```

(No functional arg change; `analysis_period` is documented as reserved in Task 6. Do not silently pretend to filter by it.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Manual live verification**

Via `wssm-local`, call `get_optimization_insights` with `{ "database": "McpToolingTestDb" }`. Confirm a populated object (`summary`, `recommendations`, `roadmap`), not `{}`.

- [ ] **Step 8: Commit**

```bash
git add lib/analysis/query-optimizer.js index.js test/unit/query-optimizer.test.js
git commit -m "feat(get_optimization_insights): aggregate index + expensive-query health summary"
```

---

## Task 5: Remove dead/duplicate stub code

**Files:**

- Modify: `lib/analysis/query-optimizer.js:764-776` (remove unused `getIndexRecommendations(query)`)
- Test: `test/unit/query-optimizer.test.js`

The live index path is `analyzeIndexUsage`. The `getIndexRecommendations(query)` method at lines 764-776 is an unreferenced stub (verify no callers first).

- [ ] **Step 1: Verify there are no callers**

Run: `grep -rn "\.getIndexRecommendations(" index.js lib/ test/ | grep -v analyzeIndexUsage`
Expected: matches only the MCP server wrapper `this.getIndexRecommendations(` in `index.js` (which calls `analyzeIndexUsage` internally) — NOT `this.queryOptimizer.getIndexRecommendations`. If any test references `queryOptimizer.getIndexRecommendations`, update it to `analyzeIndexUsage` in this task.

- [ ] **Step 2: Delete the dead method**

Remove the `getIndexRecommendations(query)` method (lines 764-776) from `lib/analysis/query-optimizer.js`, including its leading JSDoc block if it documents only that method.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all pass (no references existed).

- [ ] **Step 4: Commit**

```bash
git add lib/analysis/query-optimizer.js test/unit/query-optimizer.test.js
git commit -m "refactor: remove unused getIndexRecommendations stub"
```

---

## Task 6: Documentation truth-pass

**Files:**

- Modify: `WARP.md` (optimization-tools status)
- Regenerate: `docs/tools.json`, `docs/tools.html`, `docs/index.html`

- [ ] **Step 1: Update WARP.md tool descriptions**

In `WARP.md`, the "Query Optimization (NEW)" list (lines ~63-68) and the Phase 2 note (line ~1028 "✅ Query Optimization & Performance Tools (COMPLETED v1.5.0)") are now accurate for `explain_query`, `get_index_recommendations`, `detect_query_bottlenecks`, and `get_optimization_insights`. Add a one-line caveat under `get_optimization_insights` noting `analysis_period` is **reserved** (DMV cache reflects cache lifetime, not an arbitrary window). Verify no remaining text claims plan-XML or DMV features that were not implemented.

- [ ] **Step 2: Regenerate the generated tool docs**

Run:

```bash
node scripts/docs/extract-docs.js
node scripts/docs/generate-tools-html.js
node scripts/docs/generate-landing-page.js
```

Expected: `docs/tools.json`, `docs/tools.html`, `docs/index.html` regenerate without error.

- [ ] **Step 3: Lint markdown**

Run: `npm run markdown:lint`
Expected: PASS (run `npm run markdown:fix` if it flags the edits).

- [ ] **Step 4: Commit**

```bash
git add WARP.md docs/tools.json docs/tools.html docs/index.html
git commit -m "docs: reconcile query-optimization tool docs with real behavior"
```

---

## Task 7: Final verification & PR

- [ ] **Step 1: Run the full CI pipeline locally**

Run: `npm run ci`
Expected: eslint, prettier, markdownlint, and the full test suite all pass.

- [ ] **Step 2: Re-verify all four tools live via wssm-local**

Confirm each returns real data (not stub/rows): `explain_query` (plan XML), `get_index_recommendations` (real or empty-but-correct), `detect_query_bottlenecks` (categorized), `get_optimization_insights` (populated summary). Reload the VS Code window first so `wssm-local` runs the updated `index.js`.

- [ ] **Step 3: Optional — run the Dockerized integration suite**

Run: `npm run test:integration`
Expected: manual + protocol + performance integration tests pass against the Docker SQL Server.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin fix/query-optimization-tools
gh pr create --base main --title "fix: implement query-optimization tools (explain_query, index recs, bottlenecks, insights)" --body "Replaces stubbed/broken optimization tools with DMV-backed implementations; wires dropped tool params; reconciles docs. See docs/superpowers/plans/2026-06-08-query-optimization-tools.md."
```

---

## Self-Review

**Spec coverage:** The four broken tools each have an implementation task (1-4) with TDD steps. Secondary issues are covered: dropped params (Tasks 1/2/3 wire them; Task 4 documents the un-honorable one), dead code (Task 5), docs mismatch (Task 6). Final verification + PR (Task 7).

**Placeholder scan:** No "TBD/TODO/handle edge cases" left; every code step shows complete code and exact commands with expected output.

**Type/name consistency:** `sanitizeDbName` is defined in both `query-optimizer.js` (Task 2) and `bottleneck-detector.js` (Task 3) — intentional duplication across two classes (no shared base), noted in each task. `analyzeIndexUsage(database, { limit, impactThreshold })`, `detectBottlenecks(database, { limit, severityFilter })`, and `getOptimizationInsights(database)` signatures are used consistently between their definition tasks and the `index.js` wiring. Plan XML column match uses `/Showplan/i` to tolerate version-specific column names.

**Known risk flagged:** SHOWPLAN-in-transaction (Task 1 Step 8) has a live-verify checkpoint and a documented fallback.
