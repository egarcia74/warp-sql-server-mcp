import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseToolsHandler } from '../../lib/tools/handlers/database-tools.js';
import { StreamingHandler } from '../../lib/utils/streaming-handler.js';
import { QueryOptimizer } from '../../lib/analysis/query-optimizer.js';

/**
 * SQL injection behavioral battery (#1093) — the AUTHORITATIVE guard
 * ==================================================================
 *
 * The 1.7.16 → 1.7.18 advisory series (GHSA-qhf4-jmhq-73c8, -crw3-hmxc-f53p,
 * -p8gx-89fp-x73j) was one repeated class: a caller-controlled value
 * (`database`/`schema`/`table_name`/`limit`/`offset`) reached an executed SQL
 * string without the right escaper. This battery drives the REAL handlers and
 * SQL-building methods with a mocked pool/request, feeds injection payloads into
 * every caller-controlled identifier/value, and asserts the EMITTED SQL
 * neutralizes them:
 *   - bracket-identifier context (`[ … ]`): every `]` is doubled;
 *   - single-quoted-literal context (`' … '` / `N' … '`): every `'` is doubled;
 *   - numeric context (`limit`/`offset`/`TOP`): non-integers are rejected.
 *
 * Each injection point is exercised in ISOLATION — the payload goes into exactly
 * one argument while the others stay benign — so a per-position escaper drop
 * (e.g. escaping schema but not table) cannot be masked by an escaped sibling.
 *
 * This tests the security property directly, so — unlike the static lint in
 * sql-construction-guard.test.js — it is immune to tokenizer/variable-naming
 * concerns. It cannot cover a brand-new tool nobody wired into the battery; that
 * residual gap is what the static lint backstops.
 */

const PAYLOADS = ["x' OR '1'='1", "x'; DROP TABLE t--", "x'--", 'x]; DROP TABLE t--', 'x]]'];

const NON_INTEGER_PAYLOADS = ['1; DROP TABLE t--', "1 OR '1'='1", 'x]]', '1.5'];

/** Assert `sql` embeds `payload` as a bracket identifier with every `]` doubled. */
function expectBracketSafe(sql, payload) {
  const escaped = payload.replaceAll(']', ']]');
  expect(sql, `expected bracket-escaped [${escaped}] in:\n${sql}`).toContain(`[${escaped}]`);
}

/** Assert `sql` embeds `payload` inside a single-quoted literal with `'` doubled. */
function expectLiteralSafe(sql, payload) {
  const escaped = payload.replaceAll("'", "''");
  expect(sql, `expected quote-escaped '${escaped}' in:\n${sql}`).toContain(`'${escaped}'`);
  if (payload.includes("'")) {
    expect(sql, 'raw (un-doubled) quoted payload must not appear').not.toContain(`'${payload}'`);
  }
}

/** DatabaseToolsHandler whose connection records every emitted SQL string. */
function makeHandler() {
  const queries = [];
  const record = sql => {
    queries.push(sql);
    return Promise.resolve({ recordset: [], recordsets: [[]], rowsAffected: [0] });
  };
  const request = { query: vi.fn(record), batch: vi.fn(record), timeout: 30000 };
  const pool = { request: () => request, connected: true, close: vi.fn() };
  const connectionManager = {
    connect: vi.fn().mockResolvedValue(pool),
    getPool: vi.fn().mockReturnValue(pool),
    isConnectionActive: () => true,
    close: vi.fn()
  };
  const handler = new DatabaseToolsHandler(connectionManager, { recordQuery: vi.fn() });
  // Returned as a tuple (not an object pattern) so PMD's JS parser does not
  // misread `const { … } = makeHandler()` as an unnecessary block at call sites.
  return [handler, queries];
}

const joinQueries = queries => queries.join('\n;;;\n');

// Each injection point: run the real method with the payload in ONE argument,
// return the emitted SQL, and declare the neutralization context.
const HANDLER_POINTS = [
  {
    name: 'list_tables · database',
    ctx: 'bracket',
    run: (h, p) => h.listTables(p, 'dbo')
  },
  { name: 'list_tables · schema', ctx: 'literal', run: (h, p) => h.listTables(null, p) },
  {
    name: 'describe_table · table_name',
    ctx: 'literal',
    run: (h, p) => h.describeTable(p, null, 'dbo')
  },
  {
    name: 'describe_table · database',
    ctx: 'bracket',
    run: (h, p) => h.describeTable('t', p, 'dbo')
  },
  { name: 'describe_table · schema', ctx: 'literal', run: (h, p) => h.describeTable('t', null, p) },
  {
    name: 'list_foreign_keys · database',
    ctx: 'bracket',
    run: (h, p) => h.listForeignKeys(p, 'dbo')
  },
  {
    name: 'list_foreign_keys · schema',
    ctx: 'literal',
    run: (h, p) => h.listForeignKeys(null, p)
  },
  {
    name: 'get_table_data · table_name',
    ctx: 'bracket',
    run: (h, p) => h.getTableData(p, null, 'dbo', 10, 0)
  },
  {
    name: 'get_table_data · database',
    ctx: 'bracket',
    run: (h, p) => h.getTableData('t', p, 'dbo', 10, 0)
  },
  {
    name: 'get_table_data · schema',
    ctx: 'bracket',
    run: (h, p) => h.getTableData('t', null, p, 10, 0)
  }
];

describe('SQL injection battery (#1093)', () => {
  describe.each(HANDLER_POINTS)('$name', ({ ctx, run }) => {
    test.each(PAYLOADS)('neutralizes %j', async payload => {
      const [handler, queries] = makeHandler();
      await run(handler, payload);
      const sql = joinQueries(queries);
      if (ctx === 'bracket') expectBracketSafe(sql, payload);
      else expectLiteralSafe(sql, payload);
    });
  });

  describe('get_table_data · numeric pagination', () => {
    test.each(NON_INTEGER_PAYLOADS)('rejects limit=%j', async payload => {
      const [handler] = makeHandler();
      await expect(handler.getTableData('t', null, 'dbo', payload, 0)).rejects.toThrow(
        /Invalid limit/
      );
    });
    test.each(NON_INTEGER_PAYLOADS)('rejects offset=%j', async payload => {
      const [handler] = makeHandler();
      await expect(handler.getTableData('t', null, 'dbo', 100, payload)).rejects.toThrow(
        /Invalid offset/
      );
    });
    test('coerces valid pagination into the emitted SQL', async () => {
      const [handler, queries] = makeHandler();
      await handler.getTableData('t', null, 'dbo', 25, 50);
      const sql = joinQueries(queries);
      expect(sql).toContain('OFFSET 50 ROWS');
      expect(sql).toContain('FETCH NEXT 25 ROWS ONLY');
    });
  });

  describe('export_table_csv · database USE switch (bracket)', () => {
    test.each(PAYLOADS)('neutralizes %j', async payload => {
      const [handler, queries] = makeHandler();
      handler.streamingHandler.streamTableExport = vi.fn().mockResolvedValue({ totalRows: 0 });
      handler.streamingHandler.getStreamingStats = vi
        .fn()
        .mockReturnValue({ streaming: false, memoryEfficient: false, totalRows: 0 });
      await handler.exportTableCsv('t', payload, 'dbo');
      expectBracketSafe(joinQueries(queries), payload);
    });
  });

  describe('streamTableExport · table_name/schema (bracket)', () => {
    let streaming;
    let captured;
    beforeEach(() => {
      streaming = new StreamingHandler();
      captured = null;
      vi.spyOn(streaming, 'executeQueryWithStreaming').mockImplementation(async (_req, query) => {
        captured = query;
        return { success: true, recordset: [], streaming: false };
      });
    });
    const req = () => ({ query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }) });

    test.each(PAYLOADS)('neutralizes table_name %j', async payload => {
      await streaming.streamTableExport(req(), payload, { schema: 'dbo' });
      expectBracketSafe(captured, payload);
    });
    test.each(PAYLOADS)('neutralizes schema %j', async payload => {
      await streaming.streamTableExport(req(), 't', { schema: payload });
      expectBracketSafe(captured, payload);
    });
    test.each(NON_INTEGER_PAYLOADS)('rejects limit=%j', async payload => {
      await expect(streaming.streamTableExport(req(), 't', { limit: payload })).rejects.toThrow(
        /Invalid limit/
      );
    });
  });

  describe('streaming size-probe · shouldStreamQuery table/schema (literal)', () => {
    const probe = (tableName, schema) => {
      const streaming = new StreamingHandler();
      const queries = [];
      const request = {
        query: vi.fn(sql => {
          queries.push(sql);
          return Promise.resolve({ recordset: [{ estimated_rows: 0, estimated_size_mb: 0 }] });
        })
      };
      return streaming
        .shouldStreamQuery(request, 'SELECT 1', { tableName, schema })
        .then(() => joinQueries(queries));
    };
    test.each(PAYLOADS)('neutralizes table_name %j', async payload => {
      expectLiteralSafe(await probe(payload, 'dbo'), payload);
    });
    test.each(PAYLOADS)('neutralizes schema %j', async payload => {
      expectLiteralSafe(await probe('t', payload), payload);
    });
  });

  describe('get_index_recommendations · analyzeIndexUsage database/schema (N-literal)', () => {
    function makeOptimizer() {
      const queries = [];
      const request = {
        query: vi.fn(sql => {
          queries.push(sql);
          return Promise.resolve({ recordset: [] });
        })
      };
      const pool = { request: () => request };
      const optimizer = new QueryOptimizer({ getPool: () => pool, connect: async () => pool });
      return [optimizer, queries];
    }
    const quotePayloads = PAYLOADS.filter(p => !p.includes(']'));
    const bracketPayloads = PAYLOADS.filter(p => p.includes(']'));

    // sanitizeDbName doubles single quotes and REJECTS brackets.
    test.each(quotePayloads)('doubles quotes for database=%j', async payload => {
      const [optimizer, queries] = makeOptimizer();
      await optimizer.analyzeIndexUsage(payload);
      expectLiteralSafe(joinQueries(queries), payload);
    });
    test.each(quotePayloads)('doubles quotes for schema=%j', async payload => {
      const [optimizer, queries] = makeOptimizer();
      await optimizer.analyzeIndexUsage(null, { schema: payload });
      expectLiteralSafe(joinQueries(queries), payload);
    });
    test.each(bracketPayloads)('rejects bracket database=%j', async payload => {
      const [optimizer] = makeOptimizer();
      await expect(optimizer.analyzeIndexUsage(payload)).rejects.toThrow(/Invalid/);
    });
    test.each(bracketPayloads)('rejects bracket schema=%j', async payload => {
      const [optimizer] = makeOptimizer();
      await expect(optimizer.analyzeIndexUsage(null, { schema: payload })).rejects.toThrow(
        /Invalid schema/
      );
    });
  });

  describe('execute_query · database USE switch (bracket)', () => {
    async function makeServer() {
      const SqlServerMCP = (await import('../../index.js')).SqlServerMCP;
      vi.spyOn(SqlServerMCP.prototype, 'setupToolHandlers').mockImplementation(() => {});
      const server = new SqlServerMCP();
      const queries = [];
      const request = {
        query: vi.fn(sql => {
          queries.push(sql);
          return Promise.resolve({ recordset: [], rowsAffected: [0] });
        })
      };
      server.connectionManager.connect = async () => ({ request: () => request });
      vi.spyOn(server, 'validateQuery').mockReturnValue({ allowed: true, queryType: 'SELECT' });
      return [server, queries];
    }
    test.each(PAYLOADS)('neutralizes %j', async payload => {
      const [server, queries] = await makeServer();
      await server.executeQuery('SELECT 1', payload);
      expectBracketSafe(joinQueries(queries), payload);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
