#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * MCP Smoke Test Client
 * Systematically tests all 15 MCP tools
 */

class SmokeTestClient {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async connect() {
    console.log('🚀 Starting MCP Smoke Test');
    console.log('================================\n');

    // Connect to existing MCP server with stdio transport
    // This assumes the MCP server is already running in the background
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['index.js']
    });

    this.client = new Client({ name: 'smoke-test-client', version: '1.0.0' }, { capabilities: {} });

    await this.client.connect(transport);
    console.log('✅ Connected to MCP server\n');
  }

  async runTest(name, description, toolCall) {
    console.log(`🧪 Testing: ${description}`);
    try {
      const result = await toolCall();
      console.log(`✅ PASSED: ${name}`);
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED', description });
      return result;
    } catch (error) {
      console.log(`❌ FAILED: ${name} - ${error.message.split('\n')[0]}`);
      this.results.failed++;
      this.results.tests.push({
        name,
        status: 'FAILED',
        description,
        error: error.message.split('\n')[0]
      });
      return null;
    }
  }

  async runSmokeTest() {
    console.log('📋 1. BASIC CONNECTIVITY AND DATABASE OPERATIONS');
    console.log('=================================================\n');

    // Test 1: list_databases
    await this.runTest('list_databases', 'List all user databases', () =>
      this.client.callTool({ name: 'list_databases', arguments: {} })
    );

    // Test 2: list_tables
    await this.runTest('list_tables', 'List tables in WarpMcpTest database', () =>
      this.client.callTool({ name: 'list_tables', arguments: { database: 'WarpMcpTest' } })
    );

    console.log('\n🔍 2. CORE DATABASE SCHEMA OPERATIONS');
    console.log('=====================================\n');

    // Test 3: describe_table
    await this.runTest('describe_table', 'Describe Products table structure', () =>
      this.client.callTool({
        name: 'describe_table',
        arguments: { database: 'WarpMcpTest', table_name: 'Products' }
      })
    );

    // Test 4: list_foreign_keys
    await this.runTest('list_foreign_keys', 'List foreign key relationships', () =>
      this.client.callTool({
        name: 'list_foreign_keys',
        arguments: { database: 'WarpMcpTest' }
      })
    );

    console.log('\n📊 3. DATA RETRIEVAL OPERATIONS');
    console.log('===============================\n');

    // Test 5: get_table_data
    await this.runTest('get_table_data', 'Get sample data from Categories table', () =>
      this.client.callTool({
        name: 'get_table_data',
        arguments: { database: 'WarpMcpTest', table_name: 'Categories', limit: 5 }
      })
    );

    // Test 6: export_table_csv
    await this.runTest('export_table_csv', 'Export Products table as CSV', () =>
      this.client.callTool({
        name: 'export_table_csv',
        arguments: { database: 'WarpMcpTest', table_name: 'Products', limit: 3 }
      })
    );

    console.log('\n🔍 4. QUERY EXECUTION AND ANALYSIS');
    console.log('==================================\n');

    // Test 7: execute_query (SELECT)
    await this.runTest('execute_query_select', 'Execute complex SELECT query', () =>
      this.client.callTool({
        name: 'execute_query',
        arguments: {
          database: 'WarpMcpTest',
          query:
            'SELECT TOP 3 p.ProductName, c.CategoryName, p.Price FROM Products p JOIN Categories c ON p.CategoryID = c.CategoryID ORDER BY p.Price DESC'
        }
      })
    );

    // Test 8: explain_query
    await this.runTest('explain_query', 'Generate execution plan for query', () =>
      this.client.callTool({
        name: 'explain_query',
        arguments: {
          database: 'WarpMcpTest',
          query: 'SELECT COUNT(*) FROM Products WHERE CategoryID = 1'
        }
      })
    );

    console.log('\n⚡ 5. PERFORMANCE MONITORING TOOLS');
    console.log('=================================\n');

    // Test 9: get_performance_stats
    await this.runTest('get_performance_stats', 'Get overall performance statistics', () =>
      this.client.callTool({
        name: 'get_performance_stats',
        arguments: { timeframe: 'all' }
      })
    );

    // Test 10: get_query_performance
    await this.runTest('get_query_performance', 'Get query performance breakdown', () =>
      this.client.callTool({
        name: 'get_query_performance',
        arguments: {}
      })
    );

    // Test 11: get_connection_health
    await this.runTest('get_connection_health', 'Check connection pool health', () =>
      this.client.callTool({
        name: 'get_connection_health',
        arguments: {}
      })
    );

    console.log('\n🔧 6. QUERY OPTIMIZATION TOOLS');
    console.log('==============================\n');

    // Test 12: get_index_recommendations
    await this.runTest('get_index_recommendations', 'Get index optimization recommendations', () =>
      this.client.callTool({
        name: 'get_index_recommendations',
        arguments: { database: 'WarpMcpTest' }
      })
    );

    // Test 13: analyze_query_performance
    await this.runTest('analyze_query_performance', 'Analyze query performance deeply', () =>
      this.client.callTool({
        name: 'analyze_query_performance',
        arguments: {
          database: 'WarpMcpTest',
          query: 'SELECT * FROM Products WHERE CategoryID = 1'
        }
      })
    );

    // Test 14: detect_query_bottlenecks
    await this.runTest('detect_query_bottlenecks', 'Detect query bottlenecks', () =>
      this.client.callTool({
        name: 'detect_query_bottlenecks',
        arguments: { database: 'WarpMcpTest' }
      })
    );

    // Test 15: get_optimization_insights
    await this.runTest('get_optimization_insights', 'Get comprehensive optimization insights', () =>
      this.client.callTool({
        name: 'get_optimization_insights',
        arguments: { database: 'WarpMcpTest' }
      })
    );

    console.log('\n🔒 7. SECURITY AND SAFETY BOUNDARIES');
    console.log('====================================\n');

    // Test security - these should FAIL in read-only mode
    await this.runTest(
      'security_insert_blocked',
      'INSERT should be blocked (read-only mode)',
      async () => {
        try {
          await this.client.callTool({
            name: 'execute_query',
            arguments: {
              database: 'WarpMcpTest',
              query: "INSERT INTO Categories (CategoryName, Description) VALUES ('Test', 'Test')"
            }
          });
          throw new Error('INSERT was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return { blocked: true, reason: 'Read-only mode correctly enforced' };
          }
          throw error;
        }
      }
    );

    await this.runTest(
      'security_update_blocked',
      'UPDATE should be blocked (read-only mode)',
      async () => {
        try {
          await this.client.callTool({
            name: 'execute_query',
            arguments: {
              database: 'WarpMcpTest',
              query: 'UPDATE Products SET Price = 50.00 WHERE ProductID = 1'
            }
          });
          throw new Error('UPDATE was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return { blocked: true, reason: 'Read-only mode correctly enforced' };
          }
          throw error;
        }
      }
    );

    await this.runTest(
      'security_delete_blocked',
      'DELETE should be blocked (read-only mode)',
      async () => {
        try {
          await this.client.callTool({
            name: 'execute_query',
            arguments: {
              database: 'WarpMcpTest',
              query: 'DELETE FROM Products WHERE ProductID = 99'
            }
          });
          throw new Error('DELETE was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return { blocked: true, reason: 'Read-only mode correctly enforced' };
          }
          throw error;
        }
      }
    );

    await this.runTest(
      'security_ddl_blocked',
      'CREATE TABLE should be blocked (read-only mode)',
      async () => {
        try {
          await this.client.callTool({
            name: 'execute_query',
            arguments: {
              database: 'WarpMcpTest',
              query: 'CREATE TABLE TestTable (ID int PRIMARY KEY, Name nvarchar(100))'
            }
          });
          throw new Error('CREATE TABLE was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return { blocked: true, reason: 'Read-only mode correctly enforced' };
          }
          throw error;
        }
      }
    );

    // Test that SELECT still works
    await this.runTest(
      'security_select_allowed',
      'SELECT should still work in read-only mode',
      () =>
        this.client.callTool({
          name: 'execute_query',
          arguments: {
            database: 'WarpMcpTest',
            query: 'SELECT COUNT(*) as ProductCount FROM Products'
          }
        })
    );
  }

  printSummary() {
    console.log('\n🎯 SMOKE TEST RESULTS SUMMARY');
    console.log('=============================');
    console.log(`✅ Tests Passed: ${this.results.passed}`);
    console.log(`❌ Tests Failed: ${this.results.failed}`);
    console.log(`📊 Total Tests: ${this.results.passed + this.results.failed}`);
    console.log(
      `📈 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`
    );

    if (this.results.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.tests
        .filter(t => t.status === 'FAILED')
        .forEach(t => console.log(`   • ${t.name}: ${t.error}`));
    }

    console.log('\n🏆 Production Readiness Assessment:');
    if (this.results.failed === 0) {
      console.log('   ✅ FULLY PRODUCTION READY - All tests passed!');
    } else if (this.results.passed / (this.results.passed + this.results.failed) >= 0.9) {
      console.log('   ⚠️  MOSTLY PRODUCTION READY - Some non-critical issues');
    } else {
      console.log('   ❌ NOT PRODUCTION READY - Significant issues detected');
    }
  }
}

// Run the smoke test
const smokeTest = new SmokeTestClient();
try {
  await smokeTest.connect();
  await smokeTest.runSmokeTest();
  smokeTest.printSummary();
} catch (error) {
  console.error('💥 Smoke test failed to start:', error.message);
  process.exit(1);
}

process.exit(0);
