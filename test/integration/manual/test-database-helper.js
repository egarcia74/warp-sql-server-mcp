/**
 * Test Database Helper
 * Provides utilities for creating and managing test databases
 */

import crypto from 'crypto';
import dotenv from 'dotenv';
import { serverConfig } from '../../../lib/config/server-config.js';

export class TestDatabaseHelper {
  constructor(server) {
    this.server = server;
    this.testDatabases = [];
    this.isDockerMode = this.detectDockerMode();

    // Load Docker-specific environment if in Docker mode
    if (this.isDockerMode) {
      this.loadDockerEnvironment();
    }
  }

  /**
   * Detect if we're running in Docker testing mode
   */
  detectDockerMode() {
    return process.env.MCP_TESTING_MODE === 'docker';
  }

  /**
   * Load Docker-specific environment configuration
   */
  loadDockerEnvironment() {
    console.log('🐳 Docker mode detected - loading Docker environment configuration...');

    try {
      // Load Docker-specific environment variables
      const dockerEnvPath = './test/docker/.env.docker';
      dotenv.config({ path: dockerEnvPath, override: true });

      console.log('✅ Docker environment configuration loaded');
      console.log(`🔧 Database: ${process.env.SQL_SERVER_HOST}:${process.env.SQL_SERVER_PORT}`);
      console.log(`👤 User: ${process.env.SQL_SERVER_USER}`);
    } catch (error) {
      console.warn('⚠️  Could not load Docker environment:', error.message);
    }
  }

  /**
   * Generate a unique test database name
   */
  generateTestDatabaseName(testSuite = 'MCP') {
    const timestamp = Date.now();
    const random = crypto.randomBytes(6).toString('hex'); // More entropy
    const processId = process.pid;
    const dbName = `${testSuite}_Test_${timestamp}_${processId}_${random}`;
    return dbName;
  }

  /**
   * Connect to a test database (assumes Docker has already initialized schema)
   */
  async createTestDatabase(dbName = null, createTables = true) {
    // Note: createTables parameter is kept for backwards compatibility but ignored
    if (createTables !== true) {
      console.log(
        'ℹ️  Note: createTables parameter is ignored - Docker init script handles all schema creation'
      );
    }

    if (!dbName) {
      dbName = this.generateTestDatabaseName();
    }

    console.log(`🔌 Connecting to database: ${dbName}${this.isDockerMode ? ' (Docker mode)' : ''}`);

    try {
      // In Docker mode, use predefined databases that are already initialized
      if (this.isDockerMode) {
        const predefinedDbs = [
          'WarpMcpTest',
          'Phase1ReadOnly',
          'Phase2DML',
          'Phase3DDL',
          'ProtocolTest'
        ];
        if (predefinedDbs.includes(dbName)) {
          // Verify the database exists and has tables
          const verification = await this.server.executeQuery(`
            USE [${dbName}];
            SELECT COUNT(*) as TableCount 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE'
          `);

          if (verification && verification.content && verification.content[0]) {
            const content = verification.content[0].text;
            const tableCount = content.match(/\d+/)?.[0] || '0';
            console.log(`✅ Connected to ${dbName} - found ${tableCount} tables`);
            return dbName;
          }
        }
      }

      // For non-Docker mode or custom database names, create empty database only
      // (No table creation - this should be handled by external initialization)
      console.log(
        `🏗️  Creating empty database: ${dbName} (schema should be initialized externally)`
      );

      // Temporarily enable schema changes for database creation only
      const originalConfig = {
        readOnly: process.env.SQL_SERVER_READ_ONLY,
        allowDestructive: process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS,
        allowSchema: process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES
      };

      // Enable minimal access for database creation only
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';

      // Force the server to reload its configuration
      serverConfig.reload();

      // Check if database already exists
      try {
        const existsResult = await this.server.executeQuery(`
          SELECT COUNT(*) as DbCount 
          FROM sys.databases 
          WHERE name = '${dbName}'
        `);

        if (existsResult && existsResult.content && existsResult.content[0]) {
          const content = existsResult.content[0].text;
          if (content && content.includes('1')) {
            console.log(`✅ Database ${dbName} already exists`);
            return dbName;
          }
        }
      } catch (error) {
        console.log(`ℹ️  Could not check database existence: ${error.message}`);
      }

      // Create empty database only
      await this.server.executeQuery(`CREATE DATABASE [${dbName}]`);
      this.testDatabases.push(dbName);

      // Restore original configuration
      process.env.SQL_SERVER_READ_ONLY = originalConfig.readOnly || 'true';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS =
        originalConfig.allowDestructive || 'false';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = originalConfig.allowSchema || 'false';

      // Force the server to reload its configuration back to test settings
      serverConfig.reload();

      console.log(
        `✅ Empty database created: ${dbName} (tables should be created by external initialization)`
      );
      return dbName;
    } catch (error) {
      console.error(`❌ Failed to connect to database ${dbName}:`, error.message);
      throw error;
    }
  }

  /**
   * Clean up a specific test database
   */
  async cleanupDatabase(dbName) {
    try {
      console.log(`🧹 Cleaning up test database: ${dbName}`);

      // Temporarily enable all operations for cleanup
      const originalConfig = {
        readOnly: process.env.SQL_SERVER_READ_ONLY,
        allowDestructive: process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS,
        allowSchema: process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES
      };

      // Enable full cleanup permissions temporarily
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'true';

      // Force server to reload configuration for cleanup
      serverConfig.reload();

      // Switch back to master before dropping
      await this.server.executeQuery('USE master');

      // Force close connections and drop database
      await this.server.executeQuery(`
        IF EXISTS (SELECT name FROM sys.databases WHERE name = '${dbName}')
        BEGIN
          ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
          DROP DATABASE [${dbName}];
        END
      `);

      // Restore original configuration
      process.env.SQL_SERVER_READ_ONLY = originalConfig.readOnly || 'true';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS =
        originalConfig.allowDestructive || 'false';
      process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = originalConfig.allowSchema || 'false';

      // Restore server configuration
      serverConfig.reload();

      // Remove from our tracking list
      this.testDatabases = this.testDatabases.filter(db => db !== dbName);

      console.log(`✅ Test database cleaned up: ${dbName}`);
    } catch (error) {
      // Check if it's a security policy error - if so, provide helpful context
      if (error.message.includes('Query blocked by safety policy')) {
        // This is expected behavior in restricted security phases
        console.log(`ℹ️  Note: Database ${dbName} cleanup deferred - security restrictions active`);
      } else if (error.message.includes('database does not exist')) {
        // Database was already cleaned up
        console.log(`ℹ️  Note: Database ${dbName} already cleaned`);
      } else {
        console.warn(`⚠️  Warning: Could not clean up database ${dbName}:`, error.message);
      }
    }
  }

  /**
   * Clean up all test databases created by this helper
   */
  async cleanupAllDatabases() {
    console.log(`🧹 Cleaning up ${this.testDatabases.length} test databases...`);

    for (const dbName of [...this.testDatabases]) {
      await this.cleanupDatabase(dbName);
    }

    console.log('✅ All test databases cleaned up');
  }

  /**
   * Get list of test databases created by this helper
   */
  getTestDatabases() {
    return [...this.testDatabases];
  }
}
