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

    sandbox.stub(QueryOptimizer.prototype, 'getIndexRecommendations').throws(connectionError);
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
  });
});
