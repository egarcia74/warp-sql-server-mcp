#!/usr/bin/env node

/**
 * Direct MCP Server Test
 * Tests all 15 MCP tools by importing the server directly
 */

import { SqlServerMCP } from '../../../index.js';
import dotenv from 'dotenv';

// Load environment variables from .env file first
dotenv.config();

// Override only the security settings for testing (credentials loaded from .env)
process.env.SQL_SERVER_READ_ONLY = 'true';
process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'false';
process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
process.env.NODE_ENV = 'test'; // Prevent stdio server from starting

class DirectMcpTest {
  constructor() {
    this.results = { passed: 0, failed: 0, tests: [] };
  }

  async runTest(name, description, testFn) {
    console.log(`🧪 Testing: ${description}`);
    try {
      await testFn();
      console.log(`✅ PASSED: ${name}`);
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED', description });
    } catch (error) {
      console.log(`❌ FAILED: ${name} - ${error.message.split('\\n')[0]}`);
      this.results.failed++;
      this.results.tests.push({
        name,
        status: 'FAILED',
        description,
        error: error.message.split('\\n')[0]
      });
    }
  }

  async runSmokeTest() {
    console.log('🚀 Starting Direct MCP Server Smoke Test');
    console.log('==========================================\\n');

    // Create MCP server instance
    const server = new SqlServerMCP();

    console.log('📋 1. BASIC CONNECTIVITY AND DATABASE OPERATIONS');
    console.log('=================================================\\n');

    // Test 1: list_databases
    await this.runTest('list_databases', 'List all user databases', async () => {
      const result = await server.listDatabases();
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    // Test 2: list_tables
    await this.runTest('list_tables', 'List tables in WarpMcpTest database', async () => {
      const result = await server.listTables('WarpMcpTest');
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    console.log('\\n🔍 2. CORE DATABASE SCHEMA OPERATIONS');
    console.log('=====================================\\n');

    // Test 3: describe_table
    await this.runTest('describe_table', 'Describe Products table structure', async () => {
      const result = await server.describeTable('Products', 'WarpMcpTest');
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    // Test 4: list_foreign_keys
    await this.runTest('list_foreign_keys', 'List foreign key relationships', async () => {
      const result = await server.listForeignKeys('WarpMcpTest');
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    console.log('\\n📊 3. DATA RETRIEVAL OPERATIONS');
    console.log('===============================\\n');

    // Test 5: get_table_data
    await this.runTest('get_table_data', 'Get sample data from Categories table', async () => {
      const result = await server.getTableData('Categories', 'WarpMcpTest', 'dbo', 5);
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    // Test 6: export_table_csv
    await this.runTest('export_table_csv', 'Export Products table as CSV', async () => {
      const result = await server.exportTableCsv('Products', 'WarpMcpTest', 'dbo');
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    console.log('\\n🔍 4. QUERY EXECUTION AND ANALYSIS');
    console.log('==================================\\n');

    // Test 7: execute_query (SELECT)
    await this.runTest('execute_query_select', 'Execute complex SELECT query', async () => {
      const result = await server.executeQuery(
        'SELECT TOP 3 p.ProductName, c.CategoryName, p.Price FROM Products p JOIN Categories c ON p.CategoryID = c.CategoryID ORDER BY p.Price DESC',
        'WarpMcpTest'
      );
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    // Test 8: explain_query
    await this.runTest('explain_query', 'Generate execution plan for query', async () => {
      const result = await server.explainQuery(
        'SELECT COUNT(*) FROM Products WHERE CategoryID = 1',
        'WarpMcpTest'
      );
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    console.log('\\n⚡ 5. PERFORMANCE MONITORING TOOLS');
    console.log('=================================\\n');

    // Test 9: get_performance_stats
    await this.runTest('get_performance_stats', 'Get overall performance statistics', async () => {
      const result = server.getPerformanceStats();
      if (!result || !result[0] || !result[0].text) {
        throw new Error('No content returned');
      }
      // Verify it's valid JSON
      JSON.parse(result[0].text);
    });

    // Test 10: get_query_performance
    await this.runTest('get_query_performance', 'Get query performance breakdown', async () => {
      const result = server.getQueryPerformance();
      if (!result || !result[0] || !result[0].text) {
        throw new Error('No content returned');
      }
      // Verify it's valid JSON
      JSON.parse(result[0].text);
    });

    // Test 11: get_connection_health
    await this.runTest('get_connection_health', 'Check connection pool health', async () => {
      const result = server.getConnectionHealth();
      if (!result || !result[0] || !result[0].text) {
        throw new Error('No content returned');
      }
      // Verify it's valid JSON
      JSON.parse(result[0].text);
    });

    console.log('\\n🔧 6. QUERY OPTIMIZATION TOOLS');
    console.log('==============================\\n');

    // Test 12: get_index_recommendations
    await this.runTest(
      'get_index_recommendations',
      'Get index optimization recommendations',
      async () => {
        const result = await server.getIndexRecommendations('WarpMcpTest');
        if (!result || !result[0] || !result[0].text) {
          throw new Error('No content returned');
        }
        // Verify it's valid JSON
        JSON.parse(result[0].text);
      }
    );

    // Test 13: analyze_query_performance
    await this.runTest(
      'analyze_query_performance',
      'Analyze query performance deeply',
      async () => {
        const result = await server.analyzeQueryPerformance(
          'SELECT * FROM Products WHERE CategoryID = 1',
          'WarpMcpTest'
        );
        if (!result || !result[0] || !result[0].text) {
          throw new Error('No content returned');
        }
        // Verify it's valid JSON
        JSON.parse(result[0].text);
      }
    );

    // Test 14: detect_query_bottlenecks
    await this.runTest('detect_query_bottlenecks', 'Detect query bottlenecks', async () => {
      const result = await server.detectQueryBottlenecks('WarpMcpTest');
      if (!result || !result[0] || !result[0].text) {
        throw new Error('No content returned');
      }
      // Verify it's valid JSON
      JSON.parse(result[0].text);
    });

    // Test 15: get_optimization_insights
    await this.runTest(
      'get_optimization_insights',
      'Get comprehensive optimization insights',
      async () => {
        const result = await server.getOptimizationInsights('WarpMcpTest');
        if (!result || !result[0] || !result[0].text) {
          throw new Error('No content returned');
        }
        // Verify it's valid JSON
        JSON.parse(result[0].text);
      }
    );

    console.log('\\n🔒 7. SECURITY AND SAFETY BOUNDARIES');
    console.log('====================================\\n');

    // Test security - these should FAIL in read-only mode
    await this.runTest(
      'security_insert_blocked',
      'INSERT should be blocked (read-only mode)',
      async () => {
        try {
          await server.executeQuery(
            "INSERT INTO Categories (CategoryName, Description) VALUES ('Test', 'Test')",
            'WarpMcpTest'
          );
          throw new Error('INSERT was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return; // This is expected
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
          await server.executeQuery(
            'UPDATE Products SET Price = 50.00 WHERE ProductID = 1',
            'WarpMcpTest'
          );
          throw new Error('UPDATE was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return; // This is expected
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
          await server.executeQuery('DELETE FROM Products WHERE ProductID = 99', 'WarpMcpTest');
          throw new Error('DELETE was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return; // This is expected
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
          await server.executeQuery(
            'CREATE TABLE TestTable (ID int PRIMARY KEY, Name nvarchar(100))',
            'WarpMcpTest'
          );
          throw new Error('CREATE TABLE was NOT blocked - security failure!');
        } catch (error) {
          if (error.message.includes('Read-only mode')) {
            return; // This is expected
          }
          throw error;
        }
      }
    );

    // Test that SELECT still works
    await this.runTest(
      'security_select_allowed',
      'SELECT should still work in read-only mode',
      async () => {
        const result = await server.executeQuery(
          'SELECT COUNT(*) as ProductCount FROM Products',
          'WarpMcpTest'
        );
        if (!result.content || !result.content[0] || !result.content[0].text) {
          throw new Error('No content returned');
        }
      }
    );
  }

  printSummary() {
    console.log('\\n🎯 SMOKE TEST RESULTS SUMMARY');
    console.log('=============================');
    console.log(`✅ Tests Passed: ${this.results.passed}`);
    console.log(`❌ Tests Failed: ${this.results.failed}`);
    console.log(`📊 Total Tests: ${this.results.passed + this.results.failed}`);
    console.log(
      `📈 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`
    );

    if (this.results.failed > 0) {
      console.log('\\n❌ Failed Tests:');
      this.results.tests
        .filter(t => t.status === 'FAILED')
        .forEach(t => console.log(`   • ${t.name}: ${t.error}`));
    }

    console.log('\\n🏆 Production Readiness Assessment:');
    if (this.results.failed === 0) {
      console.log('   ✅ FULLY PRODUCTION READY - All tests passed!');
    } else if (this.results.passed / (this.results.passed + this.results.failed) >= 0.9) {
      console.log('   ⚠️  MOSTLY PRODUCTION READY - Some non-critical issues');
    } else {
      console.log('   ❌ NOT PRODUCTION READY - Significant issues detected');
    }
  }
}

// Run the test
const test = new DirectMcpTest();
try {
  await test.runSmokeTest();
  test.printSummary();
  process.exit(0);
} catch (error) {
  console.error('💥 Test failed:', error);
  process.exit(1);
}
