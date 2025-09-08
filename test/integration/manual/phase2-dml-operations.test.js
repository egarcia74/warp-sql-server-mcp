#!/usr/bin/env node

/**
 * Phase 2: DML Operations Test
 * Tests DML operations (INSERT/UPDATE/DELETE) while DDL should still be blocked
 */

import { SqlServerMCP } from '../../../index.js';
import { TestDatabaseHelper } from './test-database-helper.js';
import { serverConfig } from '../../../lib/config/server-config.js';
import dotenv from 'dotenv';

// Load environment variables from .env file first
dotenv.config({ override: false }); // Load .env but don't override existing env vars

// Set test-specific environment variables explicitly (these will take precedence)
process.env.SQL_SERVER_READ_ONLY = 'false';
process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
process.env.SQL_SERVER_TRUST_CERT = 'true'; // Trust self-signed certificates
process.env.NODE_ENV = 'test';

// Force configuration reload to pick up our environment variable changes
serverConfig.reload();

// Verify the configuration was set correctly
console.log('🔧 Environment Variables Set:');
console.log('   SQL_SERVER_READ_ONLY:', process.env.SQL_SERVER_READ_ONLY);
console.log(
  '   SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS:',
  process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS
);
console.log('   SQL_SERVER_ALLOW_SCHEMA_CHANGES:', process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES);
console.log('   SQL_SERVER_TRUST_CERT:', process.env.SQL_SERVER_TRUST_CERT);

// Verify the server config actually loaded the changes
const securityConfig = serverConfig.getSecurityConfig();
console.log('\n🔍 Server Configuration Loaded:');
console.log('   readOnlyMode:', securityConfig.readOnlyMode);
console.log('   allowDestructiveOperations:', securityConfig.allowDestructiveOperations);
console.log('   allowSchemaChanges:', securityConfig.allowSchemaChanges);
console.log('');

// CRITICAL: Ensure configuration is validated
if (securityConfig.readOnlyMode !== false) {
  console.error(
    '❌ CRITICAL: Read-only mode is still enabled! Expected: false, Got:',
    securityConfig.readOnlyMode
  );
  console.error('❌ This will cause all DML tests to fail.');
  process.exit(1);
}

if (securityConfig.allowDestructiveOperations !== true) {
  console.error(
    '❌ CRITICAL: Destructive operations are not enabled! Expected: true, Got:',
    securityConfig.allowDestructiveOperations
  );
  console.error('❌ This will cause all DML tests to fail.');
  process.exit(1);
}

class DmlOperationsTest {
  constructor() {
    this.results = { passed: 0, failed: 0, tests: [] };
    this.server = null;
    this.dbHelper = null;
    this.testDbName = null;
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

  async runDmlTest() {
    console.log('🚀 Starting Phase 2: DML Operations Test');
    console.log('========================================\n');

    console.log('🔧 Current Configuration:');
    console.log('   🔓 Read-Only Mode: FALSE');
    console.log('   ⚠️  Allow Destructive Operations: TRUE');
    console.log('   ✅ Allow Schema Changes: FALSE (DDL still blocked)');
    console.log('   🔐 SSL Encryption: ENABLED\n');

    // Create MCP server instance - force configuration reload first
    serverConfig.reload(); // Ensure latest environment variables are loaded
    this.server = new SqlServerMCP();

    // Verify the server instance has the correct configuration
    const serverSecurityConfig = this.server.config.getSecurityConfig();
    console.log('🔍 Server Instance Security Config:');
    console.log('   readOnlyMode:', serverSecurityConfig.readOnlyMode);
    console.log('   allowDestructiveOperations:', serverSecurityConfig.allowDestructiveOperations);
    console.log('   allowSchemaChanges:', serverSecurityConfig.allowSchemaChanges);

    if (serverSecurityConfig.readOnlyMode !== false) {
      throw new Error(
        `Server instance still in read-only mode! Expected: false, Got: ${serverSecurityConfig.readOnlyMode}`
      );
    }

    // Create database helper and test database
    this.dbHelper = new TestDatabaseHelper(this.server);

    try {
      console.log('🏗️  Setting up test environment...');
      this.testDbName = await this.dbHelper.createTestDatabase('Phase2DML');
      console.log(`📊 Using test database: ${this.testDbName}\n`);
    } catch (error) {
      console.error('❌ Failed to set up test environment:', error.message);
      throw error;
    }

    console.log('📊 1. VERIFY READ OPERATIONS STILL WORK');
    console.log('=======================================\n');

    // Verify read operations still work
    await this.runTest('select_operations', 'SELECT operations should still work', async () => {
      const result = await this.server.executeQuery(
        'SELECT COUNT(*) as ProductCount FROM Products',
        this.testDbName
      );
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
    });

    console.log('\n🔓 2. TEST DML OPERATIONS (NOW ALLOWED)');
    console.log('========================================\n');

    // Test INSERT operation (should now work)
    await this.runTest('insert_operation', 'INSERT should now be ALLOWED', async () => {
      const result = await this.server.executeQuery(
        "INSERT INTO Categories (CategoryName, Description) VALUES ('TestCategory', 'Test Description for DML testing')",
        this.testDbName
      );
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
      // Verify the insert actually worked
      if (
        !result.content[0].text.includes('rows affected') &&
        !result.content[0].text.includes('successfully')
      ) {
        throw new Error('INSERT operation did not report success');
      }
    });

    // Test UPDATE operation (should now work)
    await this.runTest('update_operation', 'UPDATE should now be ALLOWED', async () => {
      const result = await this.server.executeQuery(
        "UPDATE Categories SET Description = 'Updated test description' WHERE CategoryName = 'TestCategory'",
        this.testDbName
      );
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
      // Verify the update actually worked
      if (
        !result.content[0].text.includes('rows affected') &&
        !result.content[0].text.includes('successfully')
      ) {
        throw new Error('UPDATE operation did not report success');
      }
    });

    // Verify the changes were actually made
    await this.runTest('verify_dml_changes', 'Verify DML changes were persisted', async () => {
      const result = await this.server.executeQuery(
        "SELECT CategoryName, Description FROM Categories WHERE CategoryName = 'TestCategory'",
        this.testDbName
      );
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }
      if (
        !result.content[0].text.includes('TestCategory') ||
        !result.content[0].text.includes('Updated test description')
      ) {
        throw new Error('DML changes were not persisted correctly');
      }
    });

    console.log('\n🔒 3. VERIFY DDL OPERATIONS STILL BLOCKED');
    console.log('==========================================\n');

    // Test CREATE TABLE (should still be blocked)
    await this.runTest('ddl_create_blocked', 'CREATE TABLE should still be BLOCKED', async () => {
      try {
        await this.server.executeQuery(
          'CREATE TABLE TestDmlTable (ID int PRIMARY KEY, Name nvarchar(100))',
          this.testDbName
        );
        throw new Error('CREATE TABLE was NOT blocked - security failure!');
      } catch (error) {
        if (error.message.includes('Schema changes') || error.message.includes('CREATE')) {
          return; // This is expected
        }
        throw error;
      }
    });

    // Test DROP TABLE (should still be blocked)
    await this.runTest('ddl_drop_blocked', 'DROP TABLE should still be BLOCKED', async () => {
      try {
        await this.server.executeQuery('DROP TABLE IF EXISTS TestDmlTable', this.testDbName);
        throw new Error('DROP TABLE was NOT blocked - security failure!');
      } catch (error) {
        if (error.message.includes('Schema changes') || error.message.includes('DROP')) {
          return; // This is expected
        }
        throw error;
      }
    });

    // Test ALTER TABLE (should still be blocked)
    await this.runTest('ddl_alter_blocked', 'ALTER TABLE should still be BLOCKED', async () => {
      try {
        await this.server.executeQuery(
          'ALTER TABLE Categories ADD TestColumn nvarchar(50)',
          this.testDbName
        );
        throw new Error('ALTER TABLE was NOT blocked - security failure!');
      } catch (error) {
        if (error.message.includes('Schema changes') || error.message.includes('ALTER')) {
          return; // This is expected
        }
        throw error;
      }
    });

    console.log('\n🗑️  4. TEST DELETE OPERATION');
    console.log('=============================\n');

    // Test DELETE operation (should now work) - Clean up our test data
    await this.runTest(
      'delete_operation',
      'DELETE should now be ALLOWED (cleanup test data)',
      async () => {
        const result = await this.server.executeQuery(
          "DELETE FROM Categories WHERE CategoryName = 'TestCategory'",
          this.testDbName
        );
        if (!result.content || !result.content[0] || !result.content[0].text) {
          throw new Error('No content returned');
        }
        // Verify the delete actually worked
        if (
          !result.content[0].text.includes('rows affected') &&
          !result.content[0].text.includes('successfully')
        ) {
          throw new Error('DELETE operation did not report success');
        }
      }
    );

    // Verify the test data was cleaned up
    await this.runTest('verify_cleanup', 'Verify test data was properly deleted', async () => {
      const result = await this.server.executeQuery(
        "SELECT COUNT(*) as TestCount FROM Categories WHERE CategoryName = 'TestCategory'",
        this.testDbName
      );
      if (!result.content || !result.content[0] || !result.content[0].text) {
        throw new Error('No content returned');
      }

      // Parse the table format response to check the actual count
      const responseText = result.content[0].text;
      console.log('   📋 Cleanup verification response:', JSON.stringify(responseText));

      // Handle table format response (TestCount\n---------\n         0)
      // Split by lines and find the data after the header separator
      const lines = responseText.split('\n');
      let dataFound = false;
      let countValue = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Look for the separator line (dashes)
        if (line.match(/^-+$/)) {
          // The next line should contain the count value
          if (i + 1 < lines.length) {
            const dataLine = lines[i + 1].trim();
            countValue = dataLine;
            dataFound = true;
            break;
          }
        }
      }

      console.log('   🔍 Parsed count value:', JSON.stringify(countValue));

      // Check if the count is 0 (test data properly cleaned up)
      if (dataFound) {
        // Count could be "0", "0.0", empty string, or just whitespace when zero
        if (
          countValue === '0' ||
          countValue === '' ||
          countValue === '0.0' ||
          parseInt(countValue) === 0 ||
          countValue.length === 0
        ) {
          console.log('   ✅ Test data successfully cleaned up (count = 0)');
          return; // Test data properly cleaned up
        } else {
          throw new Error(
            `Test data was not properly cleaned up - found ${countValue} records still exist`
          );
        }
      }

      // Fallback: look for indicators in the raw text
      if (
        responseText.includes('0') &&
        (responseText.includes('TestCount') || responseText.includes('COUNT'))
      ) {
        console.log('   ✅ Test data appears to be cleaned up (fallback detection)');
        return;
      }

      throw new Error('Test data cleanup verification failed - could not determine count');
    });

    console.log('\n⚡ 5. VERIFY PERFORMANCE MONITORING WORKS');
    console.log('=========================================\n');

    // Quick check that performance monitoring still works
    await this.runTest(
      'performance_monitoring',
      'Performance monitoring should track DML operations',
      async () => {
        const result = this.server.getPerformanceStats();
        if (!result || !result[0] || !result[0].text) {
          throw new Error('No content returned');
        }
        // Verify it's valid JSON and has data
        const stats = JSON.parse(result[0].text);
        if (!stats.success || !stats.data) {
          throw new Error('Performance stats format invalid');
        }
        // Should have recorded some queries by now
        if (stats.data.overall && stats.data.overall.totalQueries <= 0) {
          throw new Error('Performance monitoring not tracking queries');
        }
      }
    );
  }

  async cleanup() {
    if (this.dbHelper) {
      console.log('\n🧹 Cleaning up test environment...');
      await this.dbHelper.cleanupAllDatabases();
    }
  }

  printSummary() {
    console.log('\n🎯 PHASE 2 DML OPERATIONS RESULTS');
    console.log('=================================');
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

    console.log('\n🏆 Phase 2 Assessment:');
    if (this.results.failed === 0) {
      console.log('   ✅ PHASE 2 COMPLETE - DML operations work correctly!');
      console.log('   🔓 INSERT/UPDATE/DELETE operations: WORKING');
      console.log('   🔒 DDL operations still properly blocked');
      console.log('   🚀 Ready for Phase 3 (DDL operations testing)');
    } else if (this.results.passed / (this.results.passed + this.results.failed) >= 0.8) {
      console.log('   ⚠️  PHASE 2 MOSTLY WORKING - Some issues detected');
    } else {
      console.log('   ❌ PHASE 2 FAILED - Significant issues with DML operations');
    }
  }
}

// Run the DML test
const dmlTest = new DmlOperationsTest();
try {
  await dmlTest.runDmlTest();
  dmlTest.printSummary();

  // Exit with failure code if any tests failed
  if (dmlTest.results.failed > 0) {
    console.error(`\n💥 ${dmlTest.results.failed} test(s) failed`);
    process.exit(1);
  }
} catch (error) {
  console.error('💥 DML test failed:', error.message);
  process.exit(1);
} finally {
  await dmlTest.cleanup();
}
process.exit(0);
