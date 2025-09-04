#!/usr/bin/env node

/**
 * Improved Manual Performance Test for MCP Server
 * Uses a single persistent MCP server process instead of spawning one per request
 * This solves the connection delay issues in the original performance-test.js
 */

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';

class ImprovedPerformanceTest {
  constructor() {
    this.results = [];
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      startTime: null,
      endTime: null
    };
    this.mcpProcess = null;
    this.requestCounter = 0;
  }

  /**
   * Start a persistent MCP server process
   */
  async startMCPServer() {
    console.log('🚀 Starting persistent MCP server process...');

    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn('node', ['index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let startupOutput = '';
      let startupError = '';
      const startupTimeout = setTimeout(() => {
        reject(new Error('MCP server startup timed out after 20 seconds'));
      }, 20000);

      const checkStartup = () => {
        if (startupOutput.includes('SQL Server MCP server running on stdio')) {
          clearTimeout(startupTimeout);
          console.log('✅ MCP server started successfully');
          resolve();
          return true;
        }
        return false;
      };

      this.mcpProcess.stdout.on('data', data => {
        const chunk = data.toString();
        startupOutput += chunk;
        if (checkStartup()) {
          // Remove these handlers once we're started
          this.mcpProcess.stdout.removeAllListeners('data');
        }
      });

      this.mcpProcess.stderr.on('data', data => {
        const chunk = data.toString();
        startupError += chunk;
        if (chunk.includes('SQL Server MCP server running on stdio')) {
          clearTimeout(startupTimeout);
          console.log('✅ MCP server started successfully');
          resolve();

          // Remove these handlers once we're started
          this.mcpProcess.stderr.removeAllListeners('data');
        }
      });

      this.mcpProcess.on('error', err => {
        clearTimeout(startupTimeout);
        reject(new Error(`MCP server failed to start: ${err.message}`));
      });

      this.mcpProcess.on('close', code => {
        if (code !== 0 && !this.isShuttingDown) {
          console.error(`MCP server process exited unexpectedly with code ${code}`);
          console.error('Error output:', startupError);
        }
      });
    });
  }

  /**
   * Send a request to the persistent MCP server
   */
  async sendMCPRequest(method, params = {}, timeout = 15000) {
    if (!this.mcpProcess || this.mcpProcess.killed) {
      throw new Error('MCP server process is not running');
    }

    return new Promise((resolve, reject) => {
      const requestId = ++this.requestCounter;
      const startTime = performance.now();

      const request = {
        jsonrpc: '2.0',
        id: requestId,
        method: method,
        params: params
      };

      const _errorData = '';
      let responseData = '';
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Request #${requestId} timed out after ${timeout}ms`));
      }, timeout);

      // Set up one-time response handlers for this specific request
      const responseHandler = data => {
        const chunk = data.toString();
        responseData += chunk;

        // Look for a complete JSON-RPC response matching our request ID
        if (chunk.includes('"id":' + requestId)) {
          clearTimeout(timeoutHandle);

          try {
            const lines = responseData.split('\n');
            let jsonResponse = null;

            for (const line of lines) {
              if (
                line.trim().startsWith('{') &&
                line.includes('jsonrpc') &&
                line.includes('"id":' + requestId)
              ) {
                jsonResponse = JSON.parse(line);
                break;
              }
            }

            if (jsonResponse) {
              const responseTime = performance.now() - startTime;
              resolve({
                success: true,
                responseTime,
                response: jsonResponse
              });

              // Clean up the temporary listeners
              this.mcpProcess.stdout.removeListener('data', responseHandler);
            }
          } catch (error) {
            // If parsing failed, wait for more data
            console.error('Error parsing response:', error);
          }
        }
      };

      const errorHandler = _err => {
        // Error handler for stderr - currently unused but required for completeness
      };

      // Add temporary listeners for this request
      this.mcpProcess.stdout.on('data', responseHandler);
      this.mcpProcess.stderr.on('data', errorHandler);

      try {
        // Send the request to the MCP server's stdin
        this.mcpProcess.stdin.write(JSON.stringify(request) + '\n');
      } catch (err) {
        clearTimeout(timeoutHandle);
        this.mcpProcess.stdout.removeListener('data', responseHandler);
        reject(new Error(`Failed to send request to MCP server: ${err.message}`));
      }
    });
  }

  /**
   * Stop the MCP server process
   */
  stopMCPServer() {
    if (this.mcpProcess && !this.mcpProcess.killed) {
      this.isShuttingDown = true;
      console.log('🛑 Stopping MCP server...');
      this.mcpProcess.kill();
      this.mcpProcess = null;
      console.log('✅ MCP server stopped');
    }
  }

  updateStats(result, error = null) {
    this.stats.totalRequests++;

    if (result?.success) {
      this.stats.successfulRequests++;
      this.stats.responseTimes.push(result.responseTime);
    } else {
      this.stats.failedRequests++;
      if (error) {
        this.stats.errors.push(error.message);
      }
    }
  }

  async runTest(testName, testFn, options = {}) {
    const { description = '', critical = false } = options;

    console.log(`\n🔍 ${testName}`);
    if (description) {
      console.log(`   ${description}`);
    }
    console.log('   ' + '-'.repeat(50));

    try {
      const startTime = performance.now();
      const result = await testFn();
      const endTime = performance.now();

      this.updateStats(result);

      if (result?.success) {
        console.log(`   ✅ Success (${Math.round(endTime - startTime)}ms)`);
        return { success: true, result, duration: endTime - startTime };
      } else {
        console.log('   ❌ Failed');
        return {
          success: false,
          error: 'Test function returned failure',
          duration: endTime - startTime
        };
      }
    } catch (error) {
      this.updateStats(null, error);
      console.log(`   ❌ Error: ${error.message}`);

      if (critical) {
        console.log('   🚨 CRITICAL TEST FAILED - Stopping execution');
        throw error;
      }

      return { success: false, error: error.message, duration: 0 };
    }
  }

  async runSequentialQueries(count = 5, queryParams = {}) {
    const results = [];

    for (let i = 0; i < count; i++) {
      try {
        const start = performance.now();
        const _result = await this.sendMCPRequest('tools/call', {
          name: 'execute_query',
          arguments: queryParams
        });
        const duration = performance.now() - start;

        results.push({
          index: i,
          success: true,
          responseTime: duration,
          error: null
        });

        console.log(`   Query ${i + 1}/${count}: ${Math.round(duration)}ms`);
      } catch (error) {
        results.push({
          index: i,
          success: false,
          responseTime: null,
          error: error.message
        });
        console.log(`   Query ${i + 1}/${count}: Failed - ${error.message}`);
      }
    }

    return results;
  }

  async runConcurrentQueries(count = 5, queryParams = {}) {
    console.log(`   Executing ${count} concurrent queries...`);

    // Temporarily increase max listeners to accommodate concurrent requests
    const originalMaxListeners = this.mcpProcess.stdout.getMaxListeners();
    const originalMaxListenersStderr = this.mcpProcess.stderr.getMaxListeners();
    this.mcpProcess.stdout.setMaxListeners(count + 10); // Extra buffer for safety
    this.mcpProcess.stderr.setMaxListeners(count + 10); // Handle stderr as well

    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(
        (async () => {
          const start = performance.now();
          try {
            const _result = await this.sendMCPRequest('tools/call', {
              name: 'execute_query',
              arguments: queryParams
            });
            const duration = performance.now() - start;
            return {
              index: i,
              success: true,
              responseTime: duration,
              error: null
            };
          } catch (error) {
            return {
              index: i,
              success: false,
              responseTime: null,
              error: error.message
            };
          }
        })()
      );
    }

    const results = await Promise.all(promises);

    // Restore original max listeners
    this.mcpProcess.stdout.setMaxListeners(originalMaxListeners);
    this.mcpProcess.stderr.setMaxListeners(originalMaxListenersStderr);

    // Log results
    results.forEach((r, i) => {
      if (r.success) {
        console.log(`   Query ${i + 1}/${count}: ${Math.round(r.responseTime)}ms`);
      } else {
        console.log(`   Query ${i + 1}/${count}: Failed - ${r.error}`);
      }
    });

    return results;
  }

  /**
   * Calculate and print performance statistics
   */
  printPerformanceSummary() {
    const responseTimes = this.stats.responseTimes;

    if (responseTimes.length === 0) {
      console.log('❌ No successful requests to analyze');
      return;
    }

    // Sort response times for percentile calculations
    const sortedTimes = [...responseTimes].sort((a, b) => a - b);

    const min = sortedTimes[0];
    const max = sortedTimes[sortedTimes.length - 1];
    const avg = sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length;

    const median = sortedTimes[Math.floor(sortedTimes.length / 2)];
    const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
    const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];

    console.log('\n📊 PERFORMANCE SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Requests: ${this.stats.totalRequests}`);
    console.log(`Successful:     ${this.stats.successfulRequests}`);
    console.log(`Failed:         ${this.stats.failedRequests}`);
    console.log(
      `Error Rate:     ${((this.stats.failedRequests / this.stats.totalRequests) * 100).toFixed(2)}%`
    );
    console.log('\nResponse Times (ms):');
    console.log(`  Min:          ${Math.round(min)}`);
    console.log(`  Avg:          ${Math.round(avg)}`);
    console.log(`  Median:       ${Math.round(median)}`);
    console.log(`  95th %ile:    ${Math.round(p95)}`);
    console.log(`  99th %ile:    ${Math.round(p99)}`);
    console.log(`  Max:          ${Math.round(max)}`);

    if (this.stats.errors.length > 0) {
      console.log('\n⚠️ ERRORS:');
      const errorCounts = {};
      this.stats.errors.forEach(err => {
        errorCounts[err] = (errorCounts[err] || 0) + 1;
      });

      Object.entries(errorCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([error, count]) => {
          console.log(`  ${count}x: ${error}`);
        });
    }

    const totalDuration = (this.stats.endTime - this.stats.startTime) / 1000;
    console.log(`\nTotal Test Duration: ${totalDuration.toFixed(2)} seconds`);
  }

  async runManualPerformanceTests() {
    console.log('🚀 IMPROVED MCP Server Manual Performance Test');
    console.log('Testing system performance, monitoring, and connection pool behavior');
    console.log('='.repeat(70));

    this.stats.startTime = performance.now();

    try {
      // Start the MCP server process once
      await this.startMCPServer();

      // Test 1: Basic connectivity (critical)
      await this.runTest(
        'Basic Server Connectivity',
        async () => {
          console.log('   Verifying connection...');
          return await this.sendMCPRequest('tools/call', {
            name: 'get_performance_stats',
            arguments: {}
          });
        },
        {
          description: 'Validates basic MCP server connectivity',
          critical: true
        }
      );

      // Test 2: Performance monitoring baseline
      const baselineResult = await this.runTest(
        'Performance Monitoring Baseline',
        async () => {
          return await this.sendMCPRequest('tools/call', {
            name: 'get_performance_stats',
            arguments: {}
          });
        },
        { description: 'Captures initial performance monitoring state' }
      );

      // Extract baseline data for comparison
      const _baselineMetrics = baselineResult.result?.response?.result?.content;

      // Test 3: Connection pool health
      await this.runTest(
        'Connection Pool Health',
        async () => {
          return await this.sendMCPRequest('tools/call', {
            name: 'get_connection_health',
            arguments: {}
          });
        },
        {
          description: 'Verifies connection pool is healthy and properly configured',
          critical: true
        }
      );

      // Test 4: Simple database operation
      await this.runTest(
        'Basic Database Operation',
        async () => {
          return await this.sendMCPRequest('tools/call', {
            name: 'execute_query',
            arguments: {
              query: 'SELECT @@VERSION as version'
            }
          });
        },
        { description: 'Executes a simple query to verify database access' }
      );

      // Test 5: List databases (more complex operation)
      await this.runTest(
        'Database Listing Operation',
        async () => {
          return await this.sendMCPRequest('tools/call', {
            name: 'list_databases',
            arguments: {}
          });
        },
        { description: 'Retrieves database list to verify more complex operations' }
      );

      // Test 6: Sequential query execution
      await this.runTest(
        'Sequential Query Execution',
        async () => {
          const sequentialResults = await this.runSequentialQueries(5, {
            query: 'SELECT DB_NAME() as current_db, @@VERSION as sql_version'
          });

          const successCount = sequentialResults.filter(r => r.success).length;
          return {
            success: successCount > 0,
            response: { sequential_results: sequentialResults },
            responseTime:
              sequentialResults.reduce((sum, r) => sum + (r.responseTime || 0), 0) / successCount
          };
        },
        { description: 'Executes multiple queries sequentially to test stability' }
      );

      // Test 7: Concurrent query execution (stress test)
      await this.runTest(
        'Concurrent Query Execution',
        async () => {
          const concurrentResults = await this.runConcurrentQueries(10, {
            query:
              'SELECT DB_NAME() as current_db, @@VERSION as sql_version, GETDATE() as current_time'
          });

          const successCount = concurrentResults.filter(r => r.success).length;
          return {
            success: successCount > 0,
            response: { concurrent_results: concurrentResults },
            responseTime:
              concurrentResults.reduce((sum, r) => sum + (r.responseTime || 0), 0) / successCount
          };
        },
        { description: 'Executes multiple queries concurrently to stress test the system' }
      );

      // Test 8: Verify performance monitoring after load
      await this.runTest(
        'Performance Monitoring After Load',
        async () => {
          return await this.sendMCPRequest('tools/call', {
            name: 'get_performance_stats',
            arguments: {}
          });
        },
        { description: 'Captures performance metrics after test load to verify monitoring' }
      );

      // Cleanup: Stop the MCP server
      this.stopMCPServer();

      // Complete
      this.stats.endTime = performance.now();
      this.printPerformanceSummary();
      console.log('\n✅ Performance tests completed successfully');
    } catch (error) {
      console.error(`\n❌ Test suite failed: ${error.message}`);
      // Make sure to clean up even on error
      this.stopMCPServer();
      this.stats.endTime = performance.now();
      this.printPerformanceSummary();
      process.exit(1);
    }
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  const testRunner = new ImprovedPerformanceTest();
  testRunner.runManualPerformanceTests().catch(error => {
    console.error('💥 Test suite failed:', error);
    process.exit(1);
  });
}

// Export for testing
export { ImprovedPerformanceTest };
