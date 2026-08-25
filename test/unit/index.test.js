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
        ]
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
});
