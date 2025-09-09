#!/usr/bin/env node

/**
 * Simple Docker Connectivity Test
 *
 * Verifies that the MCP server can successfully connect to the
 * Docker SQL Server container and perform basic operations.
 *
 * This is a focused test to verify end-to-end functionality
 * without the complexity of full test suites.
 */

import dotenv from 'dotenv';
import { SqlServerMCP } from '../../index.js';

// Load Docker environment configuration
dotenv.config({ path: 'test/docker/.env.docker' });

async function runConnectivityTests() {
  // Set testing mode
  process.env.MCP_TESTING_MODE = 'docker';

  console.log('🦣 MCP Docker Connectivity Test\n');

  let server;
  try {
    server = new SqlServerMCP();
    console.log('MCP server initialized successfully');
  } catch (error) {
    console.log('❌ Failed to initialize MCP server:', error.message);
    process.exit(1);
  }

  // Test 1: Basic connection
  console.log('\n1️⃣ Testing Database Connection...');
  try {
    const response = await server.databaseTools.listDatabases();

    if (response && Array.isArray(response) && response[0] && response[0].type === 'text') {
      const textContent = response[0].text;

      if (textContent === 'No data returned') {
        console.log(
          '   ✅ Connection successful - no user databases found (expected for fresh Docker)'
        );
      } else {
        // Count database lines (subtract header and separator lines)
        const lines = textContent.split('\n');
        const dataLines = lines.filter((line, index) => index > 1 && line.trim().length > 0);
        console.log(`   ✅ Connection successful - found ${dataLines.length} databases`);
      }
    } else {
      throw new Error('Invalid response format');
    }
  } catch (error) {
    console.log('   ❌ Connection failed:', error.message);
    process.exit(1);
  }

  // Test 2: Query execution
  console.log('\n2️⃣ Testing Query Execution...');
  try {
    const queryResult = await server.executeQuery('SELECT @@VERSION as Version');

    if (queryResult && queryResult.content && Array.isArray(queryResult.content)) {
      const textContent = queryResult.content[0].text;

      // Check if it's a successful query result (text table format)
      if (textContent && textContent.includes('Version')) {
        const versionMatch = textContent.match(/SQL Server (\d{4})/);
        const version = versionMatch ? versionMatch[0] : 'SQL Server';
        console.log(`   ✅ Query successful - ${version} detected`);
      } else {
        throw new Error('No version data in query result');
      }
    } else {
      throw new Error('Invalid query result format');
    }
  } catch (error) {
    console.log('   ❌ Query execution failed:', error.message);
    process.exit(1);
  }

  // Test 3: Table operations
  console.log('\n3️⃣ Testing Table Operations...');
  try {
    const response = await server.databaseTools.listTables('WarpMcpTest');

    if (response && Array.isArray(response) && response[0] && response[0].type === 'text') {
      const textContent = response[0].text;

      if (textContent === 'No data returned') {
        console.log('   ✅ Table listing successful - no tables found in WarpMcpTest database');
      } else {
        // Count table lines (subtract header and separator lines)
        const lines = textContent.split('\n');
        const dataLines = lines.filter((line, index) => index > 1 && line.trim().length > 0);
        console.log(`   ✅ Table listing successful - found ${dataLines.length} tables`);
      }
    } else {
      throw new Error('Invalid response format');
    }
  } catch (error) {
    console.log('   ❌ Table operations failed:', error.message);
    process.exit(1);
  }

  console.log('\n🎉 All connectivity tests passed!');
  console.log('✅ MCP server successfully communicates with Docker SQL Server container');
  console.log('💡 Ready for full testing with: npm run test:integration');
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runConnectivityTests().catch(error => {
    console.error('💥 Connectivity test failed:', error.message);
    process.exit(1);
  });
}
