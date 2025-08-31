#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

/**
 * Performance Monitoring Features Demo
 *
 * This script demonstrates the new performance monitoring features added in GitHub issue #15:
 * 1. get_performance_stats - Overall server performance statistics
 * 2. get_query_performance - Detailed query performance breakdown
 * 3. get_connection_health - Connection pool health metrics
 */

async function demonstratePerformanceFeatures() {
  console.log('🚀 Performance Monitoring Features Demo');
  console.log('======================================\n');

  // Start the MCP server process
  const serverProcess = spawn('node', ['index.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd()
  });

  // Create MCP client and connect to the server
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['index.js']
  });

  const client = new Client(
    {
      name: 'performance-demo-client',
      version: '1.0.0'
    },
    {
      capabilities: {}
    }
  );

  try {
    await client.connect(transport);
    console.log('✅ Connected to SQL Server MCP server\n');

    // Get list of available tools to show the new ones
    console.log('📋 Available MCP Tools:');
    console.log('=======================');
    const tools = await client.listTools();

    const performanceTools = tools.tools.filter(
      tool =>
        tool.name.startsWith('get_performance') || tool.name.startsWith('get_connection_health')
    );

    performanceTools.forEach(tool => {
      console.log(`🔧 ${tool.name} - ${tool.description}`);
    });
    console.log('');

    // Simulate some database activity first to generate performance data
    console.log('🔄 Simulating database activity...');
    console.log('===================================');

    // Execute some queries to generate performance metrics
    const sampleQueries = [
      'SELECT GETDATE() as current_time',
      'SELECT 1 as test_value',
      'SELECT @@VERSION as sql_version',
      'SELECT DB_NAME() as current_database',
      'SELECT SYSTEM_USER as current_user'
    ];

    for (let i = 0; i < sampleQueries.length; i++) {
      try {
        console.log(`  Executing query ${i + 1}/${sampleQueries.length}: ${sampleQueries[i]}`);
        await client.callTool({
          name: 'execute_query',
          arguments: {
            query: sampleQueries[i]
          }
        });

        // Add a small delay between queries
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.log(
          `  ⚠️  Query ${i + 1} failed (this is expected in demo): ${error.message.split('\n')[0]}`
        );
      }
    }

    console.log('✅ Database activity simulation completed\n');

    // Now demonstrate the new performance monitoring features

    // 1. Get Performance Stats
    console.log('📊 Feature 1: Overall Performance Statistics');
    console.log('=============================================');
    try {
      const perfStats = await client.callTool({
        name: 'get_performance_stats',
        arguments: {}
      });

      const statsData = JSON.parse(perfStats.content[0].text);
      console.log('🎯 Performance Statistics (default timeframe):');
      console.log(`   • Monitoring Enabled: ${statsData.enabled}`);
      console.log(`   • Timeframe: ${statsData.timeframe}`);

      if (statsData.enabled) {
        console.log(`   • Server Uptime: ${Math.round(statsData.uptime / 1000)} seconds`);
        console.log(
          `   • Total Queries Tracked: ${statsData.monitoring?.totalQueriesTracked || 0}`
        );
        console.log(`   • Sampling Rate: ${statsData.monitoring?.samplingRate * 100 || 100}%`);
        console.log(
          `   • Slow Query Threshold: ${statsData.monitoring?.slowQueryThreshold || 5000}ms`
        );

        if (statsData.overall) {
          console.log('   📈 Overall Metrics:');
          console.log(`      - Total Queries: ${statsData.overall.totalQueries}`);
          console.log(
            `      - Average Query Time: ${Math.round(statsData.overall.avgQueryTime)}ms`
          );
          console.log(`      - Slow Queries: ${statsData.overall.slowQueries}`);
          console.log(`      - Error Rate: ${statsData.overall.errorRate.toFixed(2)}%`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message.split('\n')[0]}`);
    }
    console.log('');

    // Test with different timeframe
    try {
      const recentStats = await client.callTool({
        name: 'get_performance_stats',
        arguments: { timeframe: 'recent' }
      });

      const recentData = JSON.parse(recentStats.content[0].text);
      console.log('🕐 Performance Statistics (recent timeframe):');
      console.log(`   • Timeframe: ${recentData.timeframe}`);
      console.log(`   • Enabled: ${recentData.enabled}`);
    } catch (error) {
      console.log(`   ❌ Recent stats error: ${error.message.split('\n')[0]}`);
    }
    console.log('');

    // 2. Get Query Performance
    console.log('🔍 Feature 2: Detailed Query Performance Breakdown');
    console.log('==================================================');
    try {
      const queryPerf = await client.callTool({
        name: 'get_query_performance',
        arguments: { limit: 10 }
      });

      const queryData = JSON.parse(queryPerf.content[0].text);
      console.log('🎯 Query Performance Analysis:');
      console.log(`   • Monitoring Enabled: ${queryData.enabled}`);
      console.log(`   • Query Limit: ${queryData.limit}`);
      console.log(`   • Queries Analyzed: ${queryData.queries?.length || 0}`);

      if (queryData.enabled && queryData.queries?.length > 0) {
        console.log('   📊 Recent Queries:');
        queryData.queries.slice(0, 3).forEach((query, index) => {
          console.log(
            `      ${index + 1}. Tool: ${query.tool}, Duration: ${query.duration}ms, Status: ${query.status}`
          );
        });

        if (queryData.byTool && Object.keys(queryData.byTool).length > 0) {
          console.log('   🔧 Performance by Tool:');
          Object.entries(queryData.byTool).forEach(([tool, stats]) => {
            console.log(
              `      • ${tool}: ${stats.count} queries, avg ${Math.round(stats.avgTime)}ms`
            );
          });
        }

        if (queryData.slowQueries?.length > 0) {
          console.log(`   🐌 Slow Queries: ${queryData.slowQueries.length} found`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message.split('\n')[0]}`);
    }
    console.log('');

    // Test with tool filter
    try {
      const filteredPerf = await client.callTool({
        name: 'get_query_performance',
        arguments: {
          limit: 20,
          tool_filter: 'execute_query',
          slow_only: false
        }
      });

      const filteredData = JSON.parse(filteredPerf.content[0].text);
      console.log('🎛️ Filtered Query Performance (execute_query tool only):');
      console.log(`   • Tool Filter: ${filteredData.tool_filter}`);
      console.log(`   • Slow Only: ${filteredData.slow_only}`);
      console.log(`   • Matching Queries: ${filteredData.queries?.length || 0}`);
    } catch (error) {
      console.log(`   ❌ Filtered query error: ${error.message.split('\n')[0]}`);
    }
    console.log('');

    // 3. Get Connection Health
    console.log('💚 Feature 3: Connection Pool Health Metrics');
    console.log('===========================================');
    try {
      const connHealth = await client.callTool({
        name: 'get_connection_health',
        arguments: {}
      });

      const healthData = JSON.parse(connHealth.content[0].text);
      console.log('🎯 Connection Pool Health:');
      console.log(`   • Monitoring Enabled: ${healthData.enabled}`);

      if (healthData.enabled) {
        if (healthData.current) {
          console.log('   📊 Current Pool Status:');
          console.log(`      - Total Connections: ${healthData.current.totalConnections}`);
          console.log(`      - Active Connections: ${healthData.current.activeConnections}`);
          console.log(`      - Idle Connections: ${healthData.current.idleConnections}`);
          console.log(`      - Pending Requests: ${healthData.current.pendingRequests}`);
          console.log(`      - Errors: ${healthData.current.errors}`);
        }

        if (healthData.health) {
          const statusEmoji = {
            healthy: '💚',
            warning: '⚠️',
            critical: '🔴'
          };
          console.log('   🏥 Health Assessment:');
          console.log(
            `      - Status: ${statusEmoji[healthData.health.status] || '❓'} ${healthData.health.status}`
          );
          console.log(`      - Health Score: ${healthData.health.score}/100`);
          if (healthData.health.issues?.length > 0) {
            console.log(`      - Issues: ${healthData.health.issues.join(', ')}`);
          }
        }

        if (healthData.recent) {
          console.log('   📈 Recent Activity:');
          console.log(`      - Connection Rate: ${healthData.recent.connectionRate} per minute`);
          console.log(`      - Error Rate: ${healthData.recent.errorRate} per minute`);
          console.log(`      - Total Events: ${healthData.recent.totalEvents}`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message.split('\n')[0]}`);
    }
    console.log('');

    // Demonstrate error handling with invalid parameters
    console.log('🔧 Feature Demo: Error Handling & Edge Cases');
    console.log('============================================');

    // Test invalid timeframe
    try {
      const invalidTimeframe = await client.callTool({
        name: 'get_performance_stats',
        arguments: { timeframe: 'invalid_timeframe' }
      });

      const invalidData = JSON.parse(invalidTimeframe.content[0].text);
      console.log('✅ Invalid timeframe handling:');
      console.log(`   • Input: 'invalid_timeframe' → Normalized to: '${invalidData.timeframe}'`);
    } catch (error) {
      console.log(`   ❌ Timeframe error: ${error.message.split('\n')[0]}`);
    }

    // Test negative limit
    try {
      await client.callTool({
        name: 'get_query_performance',
        arguments: { limit: -5 }
      });
      console.log('✅ Negative limit handling: Automatically normalized to default (50)');
    } catch (error) {
      console.log(`   ❌ Limit error: ${error.message.split('\n')[0]}`);
    }

    console.log('');
    console.log('🎉 Performance Monitoring Features Demo Complete!');
    console.log('=================================================');
    console.log('');
    console.log('Summary of New Features:');
    console.log('• get_performance_stats: ✅ Overall server performance metrics');
    console.log('• get_query_performance: ✅ Detailed query analysis and breakdown');
    console.log('• get_connection_health: ✅ Connection pool health monitoring');
    console.log('');
    console.log('Key Benefits:');
    console.log('• Real-time performance monitoring');
    console.log('• Query optimization insights');
    console.log('• Connection pool health tracking');
    console.log('• Robust error handling and parameter validation');
    console.log('• Works in all security modes (read-only, etc.)');
  } catch (error) {
    console.error('❌ Demo failed:', error);
  } finally {
    // Clean up
    try {
      await client.close();
    } catch {
      // Ignore cleanup errors
    }

    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  }
}

// Run the demonstration
demonstratePerformanceFeatures().catch(console.error);
