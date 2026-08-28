import { SqlServerMCP } from '../../index.js';
import { expect } from 'chai';
import sinon from 'sinon';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ConnectionManager } from '../../lib/database/connection-manager.js';
import { QueryOptimizer } from '../../lib/analysis/query-optimizer.js';
import { BottleneckDetector } from '../../lib/analysis/bottleneck-detector.js';
import { DatabaseToolsHandler } from '../../lib/tools/handlers/database-tools.js';

describe('SqlServerMCP Index', () => {
  let server;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    const connectionError = new Error('Not connected to any server');

    // Stub prototypes of all dependencies BEFORE SqlServerMCP is instantiated
    sandbox.stub(ConnectionManager.prototype, 'connect').rejects(new Error('Connection failed'));

    sandbox.stub(DatabaseToolsHandler.prototype, 'listDatabases').throws(connectionError);
    sandbox.stub(DatabaseToolsHandler.prototype, 'listTables').throws(connectionError);
    sandbox.stub(DatabaseToolsHandler.prototype, 'describeTable').throws(connectionError);
    sandbox.stub(DatabaseToolsHandler.prototype, 'listForeignKeys').throws(connectionError);
    sandbox.stub(DatabaseToolsHandler.prototype, 'getTableData').throws(connectionError);
    sandbox.stub(DatabaseToolsHandler.prototype, 'exportTableCsv').throws(connectionError);
    sandbox.stub(DatabaseToolsHandler.prototype, 'explainQuery').throws(connectionError);
    sandbox.stub(DatabaseToolsHandler.prototype, 'executeQuery').throws(connectionError);

    sandbox.stub(QueryOptimizer.prototype, 'analyzeIndexUsage').throws(connectionError);
    sandbox.stub(QueryOptimizer.prototype, 'getOptimizationInsights').throws(connectionError);

    sandbox.stub(BottleneckDetector.prototype, 'detectBottlenecks').throws(connectionError);

    // Now, create the server instance. It will internally create instances
    // of the dependencies, but because we've stubbed their prototypes,
    // our stubs will be used.
    server = new SqlServerMCP();

    // After instantiation, we can stub properties on the instances
    sandbox.stub(server.performanceMonitor, 'metrics').value({
      queries: [],
      connections: [],
      poolStats: {},
      aggregates: {}
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle connectToDatabase errors gracefully', async () => {
      try {
        await server.connectToDatabase({ server: 'test' });
        expect.fail('connectToDatabase should have thrown an error.');
      } catch (error) {
        expect(error).to.be.instanceOf(McpError);
        expect(error.message).to.include('Connection failed');
      }
    });

    const methodsToTest = [
      { name: 'listDatabases', args: [] },
      { name: 'listTables', args: [{ database: 'test' }] },
      { name: 'describeTable', args: [{ table: 'test' }] },
      { name: 'listForeignKeys', args: [{ database: 'test' }] },
      { name: 'getTableData', args: [{ table: 'test' }] },
      { name: 'exportTableCsv', args: [{ table: 'test' }] },
      { name: 'explainQuery', args: [{ query: 'SELECT 1' }] },
      { name: 'executeQuery', args: [{ query: 'SELECT 1' }] },
      { name: 'getIndexRecommendations', args: [{ database: 'test' }] },
      { name: 'detectQueryBottlenecks', args: [{ database: 'test' }] },
      { name: 'getOptimizationInsights', args: [{ database: 'test' }] }
    ];

    methodsToTest.forEach(({ name, args }) => {
      it(`should handle ${name} errors gracefully when not connected`, async () => {
        // Stub the specific method on the instance to throw for this test
        sandbox
          .stub(server, name)
          .throws(new McpError(ErrorCode.ConnectionError, 'Not connected to any server'));

        try {
          await server[name](...args);
          expect.fail(`${name} should have thrown an error.`);
        } catch (error) {
          expect(error).to.be.instanceOf(McpError, `Error for method ${name} was not an McpError`);
          expect(error.message).to.include('Not connected to any server');
        }
      });
    });

    it('should handle getQueryPerformance gracefully', async () => {
      // This method reads from performance monitor, which is stubbed to return []
      const result = await server.getQueryPerformance({ topN: 10 });
      const parsed = JSON.parse(result[0].text);
      expect(parsed.success).to.be.true;
      expect(parsed.data.queries).to.be.an('array').that.is.empty;
    });
  });

  // #1058: these tools declared parameters the dispatcher used to drop. Verify
  // the handlers now change their output/behavior in response to those params.
  describe('Declared parameter handling (#1058)', () => {
    const fullStats = {
      enabled: true,
      uptime: 1000,
      overall: { totalQueries: 150, avgDuration: 300 },
      recent: { count: 12, avgDuration: 120 },
      pool: {},
      monitoring: {}
    };

    it('getPerformanceStats("recent") scopes to the recent window', () => {
      sandbox.stub(server.performanceMonitor, 'getStats').returns(fullStats);

      const parsed = JSON.parse(server.getPerformanceStats('recent')[0].text);

      expect(parsed.data.timeframe).to.equal('recent');
      expect(parsed.data.scoped).to.deep.equal(fullStats.recent);
    });

    it('getPerformanceStats("session") scopes to the since-startup window', () => {
      sandbox.stub(server.performanceMonitor, 'getStats').returns(fullStats);

      const parsed = JSON.parse(server.getPerformanceStats('session')[0].text);

      expect(parsed.data.timeframe).to.equal('session');
      expect(parsed.data.scoped).to.deep.equal(fullStats.overall);
    });

    it('getPerformanceStats() defaults to the overall window', () => {
      sandbox.stub(server.performanceMonitor, 'getStats').returns(fullStats);

      const parsed = JSON.parse(server.getPerformanceStats()[0].text);

      expect(parsed.data.timeframe).to.equal('all');
      expect(parsed.data.scoped).to.deep.equal(fullStats.overall);
    });

    it('getQueryPerformance forwards slowOnly and toolFilter to the monitor', () => {
      const spy = sandbox
        .stub(server.performanceMonitor, 'getQueryStats')
        .returns({ enabled: true, queries: [] });

      const parsed = JSON.parse(
        server.getQueryPerformance(25, { slowOnly: true, toolFilter: 'execute_query' })[0].text
      );

      expect(spy.calledOnceWith(25, { slowOnly: true, toolFilter: 'execute_query' })).to.be.true;
      expect(parsed.filters).to.deep.equal({ slowOnly: true, toolFilter: 'execute_query' });
    });

    it('getIndexRecommendations forwards the schema option to the optimizer', async () => {
      // analyzeIndexUsage is already stubbed on the prototype in beforeEach;
      // reconfigure that stub to resolve so we can inspect the forwarded args.
      const spy = server.queryOptimizer.analyzeIndexUsage;
      spy.resetHistory();
      spy.resolves({ database: 'Db', schema: 'sales', recommendations: [] });

      await server.getIndexRecommendations('Db', { limit: 5, schema: 'sales' });

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.equal('Db');
      expect(spy.firstCall.args[1]).to.include({ schema: 'sales' });
    });

    it('getOptimizationInsights forwards analysisPeriod to the optimizer (#1103)', async () => {
      const spy = server.queryOptimizer.getOptimizationInsights;
      spy.resetHistory();
      spy.resolves({ database: 'Db', summary: {}, recommendations: [], roadmap: [] });

      await server.getOptimizationInsights('Db', { analysisPeriod: '30_DAYS' });

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.equal('Db');
      expect(spy.firstCall.args[1]).to.include({ analysisPeriod: '30_DAYS' });
    });
  });

  describe('Tool Call Handler', () => {
    it('should return error for unknown tool', async () => {
      try {
        await server.handleCallToolRequest({
          params: { name: 'unknownTool', arguments: {} }
        });
        expect.fail('callTool should have thrown an error for unknown tool');
      } catch (error) {
        expect(error).to.be.instanceOf(McpError);
        expect(error.code).to.equal(ErrorCode.MethodNotFound);
        expect(error.message).to.include('Unknown tool: unknownTool');
      }
    });

    it('forwards the where argument from get_table_data to the handler (regression #3081)', async () => {
      DatabaseToolsHandler.prototype.getTableData.resolves([{ type: 'text', text: 'ok' }]);

      await server.handleCallToolRequest({
        params: {
          name: 'get_table_data',
          arguments: { table_name: 'Users', schema: 'dbo', limit: 5, where: "status = 'active'" }
        }
      });

      const call = DatabaseToolsHandler.prototype.getTableData.lastCall;
      expect(call, 'getTableData was not called').to.not.equal(null);
      expect(call.args).to.include("status = 'active'");
    });

    it('forwards the where argument from export_table_csv to the handler', async () => {
      DatabaseToolsHandler.prototype.exportTableCsv.resolves([{ type: 'text', text: 'ok' }]);

      await server.handleCallToolRequest({
        params: {
          name: 'export_table_csv',
          arguments: { table_name: 'Users', where: 'id > 10' }
        }
      });

      const call = DatabaseToolsHandler.prototype.exportTableCsv.lastCall;
      expect(call, 'exportTableCsv was not called').to.not.equal(null);
      expect(call.args).to.include('id > 10');
    });

    it('threads analysis_period from get_optimization_insights through to the optimizer (#1103)', async () => {
      const spy = server.queryOptimizer.getOptimizationInsights;
      spy.resetHistory();
      spy.resolves({ database: 'Db', summary: {}, recommendations: [], roadmap: [] });

      await server.handleCallToolRequest({
        params: {
          name: 'get_optimization_insights',
          arguments: { database: 'Db', analysis_period: '24_HOURS' }
        }
      });

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.equal('Db');
      expect(spy.firstCall.args[1]).to.include({ analysisPeriod: '24_HOURS' });
    });

    describe('where clause lexical guard (defense in depth, uses real validator)', () => {
      const blocked = [
        ['semicolon batch', '1=1; DELETE FROM Users'],
        ['whitespace batch (T-SQL needs no terminator)', '1=1 DELETE FROM Users'],
        ['EXEC of dangerous proc (unparseable -> regex fallback)', "1=1 EXEC xp_cmdshell 'dir'"],
        ['WAITFOR', "1=1\nWAITFOR DELAY '00:00:05'"],
        ['line comment', '1=1 -- hide the rest'],
        ['block comment', '1=1 /*x*/ DROP TABLE Users'],
        ['OPENROWSET inside predicate', "1=1 OR 1=(SELECT COUNT(*) FROM OPENROWSET('a','b','c'))"],
        ['SHUTDOWN', '1=1 SHUTDOWN'],
        [
          'top-level UNION (rows from another table)',
          '1=0 UNION ALL SELECT name, NULL FROM sys.tables'
        ],
        ['top-level EXCEPT', '1=1 EXCEPT SELECT * FROM Other'],
        ['top-level INTERSECT', '1=1 INTERSECT SELECT * FROM Other'],
        ['bare SELECT as whitespace batch', '1=1 SELECT 1'],
        ['top-level ORDER BY / FOR XML', '1=1 ORDER BY 1 FOR XML PATH'],
        [
          'UNION hidden by unbalanced parens',
          '1=1) UNION ALL SELECT name, NULL FROM sys.tables WHERE (1=1'
        ],
        ['unterminated bracket hiding a statement', '1=1 [ DROP TABLE Users --'],
        [
          'unterminated string literal hiding a statement',
          "id > 1 AND 'x OR 1=1; DROP TABLE Users"
        ],
        ['CHECKPOINT smuggled into a filter', '1=1 CHECKPOINT'],
        ['DISABLE TRIGGER smuggled into a filter', '1=1 DISABLE TRIGGER ALL ON Users'],
        ['RECONFIGURE smuggled into a filter', '1=1 RECONFIGURE'],
        ['SETUSER smuggled into a filter', "1=1 SETUSER 'guest'"],
        ['RECEIVE smuggled into a filter', '1=1 RECEIVE TOP (1) * FROM dbo.Q'],
        ['top-level FROM (second table)', '1=1 FROM Other']
      ];

      blocked.forEach(([label, where]) => {
        it(`blocks ${label}`, async () => {
          DatabaseToolsHandler.prototype.getTableData.resolves([{ type: 'text', text: 'ok' }]);
          try {
            await server.handleCallToolRequest({
              params: { name: 'get_table_data', arguments: { table_name: 'Users', where } }
            });
            expect.fail(`where clause should have been blocked: ${where}`);
          } catch (error) {
            expect(error).to.be.instanceOf(McpError);
            expect(error.message).to.match(/blocked by safety policy/i);
            expect(DatabaseToolsHandler.prototype.getTableData.called).to.equal(false);
          }
        });
      });

      const allowed = [
        ['simple predicate', "Status = 'Migrated' AND ErrorCount = 0"],
        ['T-SQL functions the AST parser cannot parse', 'created >= DATEADD(day, -7, GETDATE())'],
        ['forbidden tokens inside a string literal', "note = 'a;b -- delete'"],
        [
          'columns named like non-reserved statement words',
          'Enable = 1 AND Disable = 0 AND Receive IS NULL'
        ],
        ['keyword-like bracketed identifier', '[Set] = 1 AND [If] IS NULL'],
        ['subquery', 'id IN (SELECT TOP 5 id FROM Other ORDER BY id)'],
        ['EXISTS subquery', 'EXISTS (SELECT 1 FROM Other o WHERE o.userId = Users.id)'],
        ['UNION inside a subquery', 'id IN (SELECT id FROM A UNION SELECT id FROM B)'],
        ['bracketed identifiers named like clause keywords', '[Order] = 1 AND [Select] IS NULL']
      ];

      allowed.forEach(([label, where]) => {
        it(`allows ${label}`, async () => {
          DatabaseToolsHandler.prototype.getTableData.resolves([{ type: 'text', text: 'ok' }]);
          await server.handleCallToolRequest({
            params: { name: 'get_table_data', arguments: { table_name: 'Users', where } }
          });
          expect(DatabaseToolsHandler.prototype.getTableData.lastCall.args).to.include(where);
        });
      });
    });

    it('routes a lexically clean get_table_data where clause through validateQuery and honours its verdict', async () => {
      // Layer 2: a predicate that passes the lexical guard must still be run
      // through the same safety policy as execute_query, using the assembled probe.
      DatabaseToolsHandler.prototype.getTableData.resolves([{ type: 'text', text: 'ok' }]);
      sandbox
        .stub(server, 'validateQuery')
        .returns({ allowed: false, reason: 'Read-only mode: only SELECT allowed' });

      try {
        await server.handleCallToolRequest({
          params: {
            name: 'get_table_data',
            arguments: { table_name: 'Users', schema: 'app', where: 'id = 1' }
          }
        });
        expect.fail('get_table_data should have been blocked by the safety policy');
      } catch (error) {
        expect(error).to.be.instanceOf(McpError);
        expect(error.message).to.match(/blocked by safety policy/i);
        expect(
          server.validateQuery.calledWith('SELECT * FROM [app].[Users] WHERE id = 1')
        ).to.equal(true);
        expect(DatabaseToolsHandler.prototype.getTableData.called).to.equal(false);
      }
    });

    describe('validateQuery batch statement guard (GHSA-qhf4-jmhq-73c8)', () => {
      // T-SQL does not require ';' between statements, so a batch such as
      // "SELECT 1 DELETE FROM t" must not be classified by its SELECT prefix alone.
      const setModes = ({ readOnly, destructive, schema }) => {
        Object.defineProperty(server, 'readOnlyMode', { get: () => readOnly, configurable: true });
        Object.defineProperty(server, 'allowDestructiveOperations', {
          get: () => destructive,
          configurable: true
        });
        Object.defineProperty(server, 'allowSchemaChanges', {
          get: () => schema,
          configurable: true
        });
      };

      describe('read-only mode', () => {
        beforeEach(() => setModes({ readOnly: true, destructive: false, schema: false }));

        const blocked = [
          ['whitespace-separated DELETE', 'SELECT 1 DELETE FROM Users'],
          ['newline-separated EXEC xp_cmdshell', "SELECT 1\nEXEC xp_cmdshell 'dir'"],
          ['whitespace-separated DROP', 'SELECT 1 DROP TABLE Users'],
          ['WAITFOR after SELECT', "SELECT 1 WAITFOR DELAY '00:00:05'"],
          ['TRUNCATE hidden behind a block comment', 'SELECT 1 /* */ TRUNCATE TABLE Users'],
          ['CTE followed by DELETE', 'WITH x AS (SELECT 1 a) SELECT * FROM x DELETE FROM Users'],
          ['SELECT INTO creates a table', 'SELECT * INTO Users_copy FROM Users'],
          ['INSERT after SELECT', 'SELECT 1 INSERT INTO Users VALUES (1)'],
          ['unterminated string literal', "SELECT 'abc"],
          ['unterminated block comment', 'SELECT 1 /* DELETE FROM Users'],
          [
            'OPENQUERY (can run arbitrary SQL on a linked server)',
            "SELECT * FROM OPENQUERY(Linked, 'DELETE FROM T')"
          ],
          ['SHUTDOWN', 'SHUTDOWN'],
          ['KILL', 'KILL 53'],
          ['DISABLE TRIGGER after SELECT', 'SELECT 1 DISABLE TRIGGER ALL ON Users'],
          ['SETUSER after SELECT', "SELECT 1 SETUSER 'guest'"],
          ['RECEIVE as the leading statement', 'RECEIVE TOP (1) * FROM dbo.Q'],
          ['RECEIVE * after SELECT', 'SELECT 1 RECEIVE * FROM dbo.Q'],
          ['RECEIVE inside WAITFOR', 'WAITFOR (RECEIVE * FROM dbo.Q)'],
          ['bare procedure call', 'dbo.PurgeUsers'],
          ['bare procedure call followed by SELECT', 'dbo.PurgeUsers; SELECT 1'],
          ['bare sp_executesql followed by SELECT', "sp_executesql N'DELETE FROM Users'; SELECT 1"],
          [
            'bare bracketed xp_cmdshell followed by SELECT',
            "master.dbo.[xp_cmdshell] 'dir'; SELECT 1"
          ],
          ['bracketed xp_cmdshell followed by SELECT', "[xp_cmdshell] 'dir'; SELECT 1"]
        ];
        blocked.forEach(([label, query]) => {
          it(`blocks ${label}`, () => {
            const result = server.validateQuery(query);
            expect(result.allowed).to.equal(false);
            expect(result.queryType).to.equal('non-select');
          });
        });

        const allowed = [
          ['plain SELECT', 'SELECT 1'],
          ['semicolon-separated SELECTs', 'SELECT 1; SELECT 2'],
          [
            'non-reserved statement words used as identifiers',
            'SELECT Enable, Disable, Receive FROM dbo.Config'
          ],
          ['alias named like a non-reserved statement word', 'SELECT 1 AS Disable'],
          ['keyword inside a string literal', "SELECT * FROM Users WHERE note = 'DELETE FROM x'"],
          ['keyword as bracketed identifier', 'SELECT [delete], [into] FROM Users'],
          ['keyword inside a line comment', 'SELECT 1 -- DROP TABLE Users'],
          ['keyword inside a block comment', 'SELECT 1 /* DROP TABLE Users */'],
          ['keyword inside nested block comments', 'SELECT 1 /* a /* DELETE */ b */'],
          ['CTE', 'WITH x AS (SELECT 1 AS a) SELECT * FROM x'],
          ['variable named like a keyword', 'SELECT @delete'],
          ['temp table named like a keyword', 'SELECT * FROM #update']
        ];
        allowed.forEach(([label, query]) => {
          it(`allows ${label}`, () => {
            const result = server.validateQuery(query);
            expect(result.allowed, result.reason).to.equal(true);
          });
        });
      });

      describe('DML allowed, DDL disabled', () => {
        beforeEach(() => setModes({ readOnly: false, destructive: true, schema: false }));

        it('allows INSERT INTO (INTO is part of the INSERT, not SELECT INTO)', () => {
          expect(server.validateQuery('INSERT INTO Users VALUES (1)').allowed).to.equal(true);
        });
        it('allows INSERT TOP (n) INTO (TOP sits between the verb and INTO)', () => {
          const q = 'INSERT TOP (10) INTO Users SELECT * FROM Staging';
          expect(server.validateQuery(q).allowed).to.equal(true);
        });
        it('allows MERGE TOP (n) INTO', () => {
          const q =
            'MERGE TOP (10) INTO Users AS t USING Staging AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.a = s.a;';
          expect(server.validateQuery(q).allowed).to.equal(true);
        });
        const adminAllowed = [
          ['SHUTDOWN', 'SHUTDOWN'],
          ['BACKUP DATABASE', "BACKUP DATABASE Users TO DISK = 'x.bak'"],
          ['DBCC', 'DBCC DROPCLEANBUFFERS'],
          ['bare procedure call', 'dbo.PurgeUsers'],
          ['BULK INSERT', "BULK INSERT Users FROM 'x.csv'"],
          ['UPDATE STATISTICS', 'UPDATE STATISTICS Users']
        ];
        adminAllowed.forEach(([label, query]) => {
          it(`allows ${label} (the gate is the destructive flag)`, () => {
            const result = server.validateQuery(query);
            expect(result.allowed, result.reason).to.equal(true);
          });
        });

        it('allows a CTE feeding INSERT INTO', () => {
          const q = 'WITH s AS (SELECT * FROM Staging) INSERT INTO Users SELECT * FROM s';
          expect(server.validateQuery(q).allowed).to.equal(true);
        });
        it('allows MERGE INTO', () => {
          const q =
            'MERGE INTO Users AS t USING Staging AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.a = s.a;';
          expect(server.validateQuery(q).allowed).to.equal(true);
        });
        it('blocks CREATE TABLE smuggled after a SELECT as a schema change', () => {
          const result = server.validateQuery('SELECT 1 CREATE TABLE T (a int)');
          expect(result.allowed).to.equal(false);
          expect(result.queryType).to.equal('schema');
        });
        it('blocks SELECT INTO as a schema change', () => {
          const result = server.validateQuery('SELECT * INTO Users_copy FROM Users');
          expect(result.allowed).to.equal(false);
          expect(result.queryType).to.equal('schema');
        });
      });

      describe('DML disabled, DDL disabled (not read-only)', () => {
        beforeEach(() => setModes({ readOnly: false, destructive: false, schema: false }));

        const administrative = [
          ['SHUTDOWN', 'SHUTDOWN'],
          ['KILL', 'KILL 53'],
          ['BACKUP DATABASE', "BACKUP DATABASE Users TO DISK = 'x.bak'"],
          ['RESTORE DATABASE', "RESTORE DATABASE Users FROM DISK = 'x.bak'"],
          ['RECONFIGURE', 'RECONFIGURE'],
          ['DBCC', 'DBCC DROPCLEANBUFFERS'],
          ['CHECKPOINT', 'CHECKPOINT'],
          ['SETUSER', "SETUSER 'guest'"],
          ['bare xp_cmdshell', "xp_cmdshell 'dir'"],
          ['bare sp_configure', "sp_configure 'show advanced options', 1"],
          ['bare sp_executesql', "sp_executesql N'DELETE FROM Users'"],
          ['OPENQUERY', "SELECT * FROM OPENQUERY(Linked, 'DELETE FROM T')"],
          ['OPENDATASOURCE', "SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=x;').db.dbo.t"],
          [
            'OPENROWSET provider form',
            "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'DELETE FROM t')"
          ]
        ];
        administrative.forEach(([label, query]) => {
          it(`blocks ${label} as an administrative operation`, () => {
            const result = server.validateQuery(query);
            expect(result.allowed).to.equal(false);
            expect(result.queryType).to.equal('destructive');
            expect(result.reason).to.match(/Administrative operations/);
          });
        });

        const unrecognised = [
          ['bare user procedure', 'dbo.PurgeUsers'],
          ['bare bracketed xp_cmdshell', "master.dbo.[xp_cmdshell] 'dir'"],
          ['bracketed xp_cmdshell', "[xp_cmdshell] 'dir'"],
          ['double-quoted xp_cmdshell', '"dbo"."xp_cmdshell" \'dir\''],
          ['comment-only batch', '-- only a comment']
        ];
        unrecognised.forEach(([label, query]) => {
          it(`blocks ${label} as an unrecognised leading statement`, () => {
            const result = server.validateQuery(query);
            expect(result.allowed).to.equal(false);
            expect(result.queryType).to.equal('destructive');
            expect(result.reason).to.match(/Unrecognised leading statement/);
          });
        });

        it('blocks DISABLE TRIGGER smuggled after a SELECT as a schema change', () => {
          const result = server.validateQuery('SELECT 1 DISABLE TRIGGER ALL ON Users');
          expect(result.allowed).to.equal(false);
          expect(result.queryType).to.equal('schema');
        });
        it('blocks WRITETEXT as destructive', () => {
          const result = server.validateQuery("WRITETEXT Users.note 0x00 'x'");
          expect(result.allowed).to.equal(false);
          expect(result.queryType).to.equal('destructive');
        });

        const stillAllowed = [
          ['DECLARE then SELECT', 'DECLARE @x INT SELECT @x'],
          ['SET option then SELECT', 'SET NOCOUNT ON SELECT 1'],
          ['IF then SELECT', 'IF 1=1 SELECT 1'],
          ['BEGIN ... END block', 'BEGIN SELECT 1 END'],
          ['leading semicolon CTE', ';WITH c AS (SELECT 1 AS a) SELECT * FROM c'],
          ['leading block comment', '/* lead */ SELECT 1'],
          [
            'bracketed identifiers named like admin keywords',
            'SELECT [shutdown], [dbcc] FROM Users'
          ],
          ['admin keyword inside a literal', "SELECT * FROM Users WHERE note = 'SHUTDOWN'"],
          [
            'non-reserved statement words used as identifiers',
            'SELECT Enable, Disable, Receive FROM dbo.Config WHERE Enable = 1'
          ],
          ['WAITFOR is not an administrative operation', "WAITFOR DELAY '00:00:01' SELECT 1"],
          [
            'SHOW is classified read-only by server-config (SQL Server rejects it itself)',
            'SHOW TABLES'
          ]
        ];
        stillAllowed.forEach(([label, query]) => {
          it(`allows ${label}`, () => {
            const result = server.validateQuery(query);
            expect(result.allowed, result.reason).to.equal(true);
          });
        });

        it('blocks DELETE smuggled after a SELECT as destructive', () => {
          const result = server.validateQuery('SELECT 1 DELETE FROM Users');
          expect(result.allowed).to.equal(false);
          expect(result.queryType).to.equal('destructive');
        });
        it('allows a file read via OPENROWSET(BULK ...) — BULK alone is not destructive', () => {
          const q = "SELECT * FROM OPENROWSET(BULK 'C:\\data.csv', SINGLE_CLOB) AS x";
          expect(server.validateQuery(q).allowed, 'BULK read').to.equal(true);
        });
        it('blocks INSERT smuggled after a SELECT as destructive (not misreported as schema)', () => {
          const result = server.validateQuery('SELECT 1 INSERT INTO Users VALUES (1)');
          expect(result.allowed).to.equal(false);
          expect(result.queryType).to.equal('destructive');
        });
      });

      describe('full destruction mode', () => {
        beforeEach(() => setModes({ readOnly: false, destructive: true, schema: true }));

        it('does not apply the batch guard when all restrictions are disabled', () => {
          expect(server.validateQuery('SELECT 1 DROP TABLE Users').allowed).to.equal(true);
        });
      });
    });

    it('routes explain_query through validateQuery and blocks disallowed SQL (no actual-plan bypass)', async () => {
      // include_actual_plan executes the statement, so explain_query must honor
      // the same safety policy as execute_query.
      sandbox
        .stub(server, 'validateQuery')
        .returns({ allowed: false, reason: 'Read-only mode: only SELECT allowed' });

      try {
        await server.handleCallToolRequest({
          params: {
            name: 'explain_query',
            arguments: { query: 'DELETE FROM Orders', include_actual_plan: true }
          }
        });
        expect.fail('explain_query should have been blocked by the safety policy');
      } catch (error) {
        expect(error).to.be.instanceOf(McpError);
        expect(error.message).to.match(/blocked by safety policy/i);
        expect(server.validateQuery.calledWith('DELETE FROM Orders')).to.equal(true);
      }
    });
  });

  describe('executeQuery database switching (GHSA-p8gx-89fp-x73j)', () => {
    it('bracket-escapes the database argument in the emitted USE statement', async () => {
      const request = { query: sinon.stub().resolves({ recordset: [], rowsAffected: [0] }) };
      const pool = { request: () => request };
      // Override the instance-level connect (the prototype stub rejects by default).
      server.connectionManager.connect = async () => pool;
      sandbox.stub(server, 'validateQuery').returns({ allowed: true, queryType: 'SELECT' });

      await server.executeQuery('SELECT 1', 'we]rd');

      // A crafted `]` must be doubled so it cannot break out of the [...] quoting.
      expect(request.query.calledWith('USE [we]]rd]')).to.equal(true);
      // The USE must run before the actual query.
      expect(request.query.firstCall.args[0]).to.equal('USE [we]]rd]');
      expect(request.query.calledWith('SELECT 1')).to.equal(true);
    });

    it('passes a normal database name through unchanged', async () => {
      const request = { query: sinon.stub().resolves({ recordset: [], rowsAffected: [0] }) };
      const pool = { request: () => request };
      server.connectionManager.connect = async () => pool;
      sandbox.stub(server, 'validateQuery').returns({ allowed: true, queryType: 'SELECT' });

      await server.executeQuery('SELECT 1', 'McpToolingTestDb');

      expect(request.query.calledWith('USE [McpToolingTestDb]')).to.equal(true);
    });
  });

  describe('execute_query row-count telemetry (#1101)', () => {
    const useResult = result => {
      const request = { query: sinon.stub().resolves(result) };
      server.connectionManager.connect = async () => ({ request: () => request });
      sandbox.stub(server, 'validateQuery').returns({ allowed: true, queryType: 'SELECT' });
    };

    it('records the real returned-row count and rowsAffected from the driver result', async () => {
      useResult({ recordset: [{ id: 1 }, { id: 2 }, { id: 3 }], rowsAffected: [3] });
      const recordQuery = sandbox.stub(server.performanceMonitor, 'recordQuery');

      await server.executeQuery('SELECT id FROM t');

      expect(recordQuery.calledOnce).to.equal(true);
      expect(recordQuery.firstCall.args[0]).to.include({
        tool: 'execute_query',
        success: true,
        rowCount: 3,
        rowsAffected: 3
      });
    });

    it('surfaces the recorded row count through get_query_performance', async () => {
      useResult({ recordset: [{ id: 1 }, { id: 2 }], rowsAffected: [2] });

      await server.executeQuery('SELECT id FROM t');

      const parsed = JSON.parse(
        server.getQueryPerformance(10, { toolFilter: 'execute_query' })[0].text
      );
      expect(parsed.data.queries).to.have.lengthOf(1);
      expect(parsed.data.queries[0].rowCount).to.equal(2);
      // The normalized rowsAffected must surface too, not just be stored (#1101).
      expect(parsed.data.queries[0].rowsAffected).to.equal(2);
    });
  });
});
