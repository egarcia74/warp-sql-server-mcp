#!/usr/bin/env node

/**
 * Database Wait Script
 * Waits for SQL Server container to be ready and accepts connections
 */

import sql from 'mssql';
import dotenv from 'dotenv';

// Load Docker-specific environment
dotenv.config({ path: './test/docker/.env.docker' });

// Dynamic timing based on platform with intelligent retry logic
function getTimingConfig() {
  const isAppleSilicon = process.arch === 'arm64' && process.platform === 'darwin';

  if (isAppleSilicon) {
    return {
      initialDelay: 2000, // Start with 2 seconds instead of 15
      maxAttempts: 25, // More attempts for emulated environments
      baseRetryDelay: 1500, // Base delay for exponential backoff
      maxRetryDelay: 8000, // Cap the maximum delay
      backoffMultiplier: 1.3 // Gradual increase
    };
  }

  return {
    initialDelay: 1000, // Start with 1 second instead of 8
    maxAttempts: 15,
    baseRetryDelay: 1000, // Base delay for exponential backoff
    maxRetryDelay: 5000, // Cap the maximum delay
    backoffMultiplier: 1.4 // Slightly faster increase for non-emulated
  };
}

const timing = getTimingConfig();

const config = {
  server: process.env.SQL_SERVER_HOST || 'localhost',
  port: parseInt(process.env.SQL_SERVER_PORT) || 1433,
  user: process.env.SQL_SERVER_USER || 'sa',
  password: process.env.SQL_SERVER_PASSWORD || 'WarpMCP123!',
  database: 'master',
  pool: {
    max: 1,
    min: 0,
    idleTimeoutMillis: 1000
  },
  connectionTimeout: 30000,
  requestTimeout: 60000,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};

async function _waitForDatabase(pool) {
  console.log('🔄 Waiting for SQL Server container to be ready...');

  const isAppleSilicon = process.arch === 'arm64' && process.platform === 'darwin';
  if (isAppleSilicon) {
    console.log('🍎 Apple Silicon detected - using intelligent retry with exponential backoff');
  }

  let attempt = 1;
  let lastError = null;
  let currentRetryDelay = timing.baseRetryDelay;

  while (attempt <= timing.maxAttempts) {
    try {
      // Only show detailed attempt info after initial expected failures
      if (attempt <= 3) {
        process.stdout.write('.');
      } else {
        console.log(`🔍 Attempt ${attempt}/${timing.maxAttempts}: Testing database connection...`);
      }

      // Just verify basic connectivity
      await pool.request().query('SELECT @@VERSION');

      // Clear the dots if we were using them
      if (attempt <= 3) {
        console.log(''); // New line after dots
      }
      console.log('✅ Database connection successful!');
      return true;
    } catch (error) {
      lastError = error;

      // Only show warning details after the first few expected failures
      if (attempt <= 3) {
        // Just show dots for expected initial failures
        // Error details are not helpful during normal Docker startup
      } else {
        console.log(
          `⚠️ Connection attempt ${attempt}/${timing.maxAttempts} failed: ${error.message}`
        );
      }

      if (attempt < timing.maxAttempts) {
        // Calculate next delay with exponential backoff
        const delayMs = Math.min(currentRetryDelay, timing.maxRetryDelay);

        // Only show wait message for later attempts
        if (attempt > 3) {
          console.log(`⏳ Waiting ${(delayMs / 1000).toFixed(1)}s before next attempt...`);
        }
        await sleep(delayMs);

        // Increase delay for next iteration
        currentRetryDelay = Math.min(
          currentRetryDelay * timing.backoffMultiplier,
          timing.maxRetryDelay
        );
      }
      attempt++;
    }
  }

  console.error(`❌ Failed to connect after ${timing.maxAttempts} attempts`);
  console.error(`💥 Last error: ${lastError?.message || 'Unknown error'}`);
  throw lastError;
}

async function _testDatabaseContent(pool) {
  console.log('🧪 Testing database content and structure...');

  try {
    // Test each database
    const databases = ['WarpMcpTest', 'Phase1ReadOnly', 'Phase2DML', 'Phase3DDL'];

    for (const dbName of databases) {
      try {
        await pool.request().query(`USE ${dbName}`);

        if (dbName === 'Phase3DDL') {
          console.log(`📦 ${dbName}: Empty database (ready for DDL testing)`);
        } else {
          // First check if the tables exist
          const tableCheck = await pool.request().query(`
            SELECT COUNT(*) as TableCount 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE'
          `);

          const tableCount = tableCheck.recordset[0].TableCount;

          if (tableCount === 0) {
            console.log(`⚠️ ${dbName} exists but has no tables - may need initialization`);

            // Create tables if none exist
            if (dbName === 'WarpMcpTest') {
              try {
                console.log(`🏗️ Creating basic test tables in ${dbName}...`);
                // Create a minimal set of tables for testing
                await pool.request().query(`
                  CREATE TABLE Categories (
                    CategoryID int IDENTITY(1,1) PRIMARY KEY,
                    CategoryName nvarchar(100) NOT NULL,
                    Description nvarchar(255) NULL
                  );
                  
                  INSERT INTO Categories (CategoryName, Description) VALUES
                  ('Electronics', 'Electronic devices and accessories'),
                  ('Books', 'Books and reading materials');
                `);

                await pool.request().query(`
                  CREATE TABLE Products (
                    ProductID int IDENTITY(1,1) PRIMARY KEY,
                    ProductName nvarchar(100) NOT NULL,
                    Category nvarchar(50) NOT NULL,
                    Price decimal(10,2) NOT NULL
                  );
                  
                  INSERT INTO Products (ProductName, Category, Price) VALUES
                  ('Laptop', 'Electronics', 999.99),
                  ('Mouse', 'Electronics', 25.99),
                  ('Programming Book', 'Books', 45.50);
                `);
                console.log(`✅ Basic test tables created in ${dbName}`);
              } catch (createErr) {
                console.error(`❌ Error creating tables in ${dbName}: ${createErr.message}`);
              }
            }
            continue;
          }

          try {
            // Try to count records from key tables
            const recordCount = await pool.request().query(`
              SELECT 
                (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME = 'Categories') as HasCategories,
                (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME = 'Products') as HasProducts
            `);

            console.log(
              `📦 ${dbName}: ${tableCount} tables, Categories: ${recordCount.recordset[0].HasCategories}, Products: ${recordCount.recordset[0].HasProducts}`
            );
          } catch {
            console.log(`📦 ${dbName}: ${tableCount} tables (record count unavailable)`);
          }
        }
      } catch (error) {
        console.error(`❌ Error testing ${dbName}: ${error.message}`);
      }
    }

    console.log('✅ Database content verification completed!');
  } catch (error) {
    console.error('💥 Database content test failed:', error.message);
    process.exit(1);
  }
}

async function _initializeDatabases(pool) {
  console.log('🏗️  Running database initialization manually...');

  try {
    // Create the four test databases with their schemas
    const databases = [
      {
        name: 'WarpMcpTest',
        description: 'Main test database with full schema',
        needsTables: true
      },
      { name: 'Phase1ReadOnly', description: 'Read-only test database', needsTables: true },
      { name: 'Phase2DML', description: 'DML operations test database', needsTables: true },
      { name: 'Phase3DDL', description: 'DDL operations test database', needsTables: false }
    ];

    for (const db of databases) {
      try {
        console.log(`🏗️ Creating database: ${db.name}`);
        await pool.request().query(`CREATE DATABASE [${db.name}]`);
        console.log(`✅ Created database: ${db.name}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️ Database ${db.name} already exists`);
        } else {
          console.error(`❌ Error creating ${db.name}: ${error.message}`);
        }
      }
    }

    // Create basic test tables in WarpMcpTest
    try {
      console.log('📊 Creating test tables in WarpMcpTest...');
      await pool.request().query(`
        USE WarpMcpTest;
        
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Categories')
        CREATE TABLE Categories (
          CategoryID int IDENTITY(1,1) PRIMARY KEY,
          CategoryName nvarchar(100) NOT NULL,
          Description nvarchar(255) NULL
        );
        
        IF NOT EXISTS (SELECT 1 FROM Categories)
        INSERT INTO Categories (CategoryName, Description) VALUES
        ('Electronics', 'Electronic devices and accessories'),
        ('Books', 'Books and reading materials'),
        ('Clothing', 'Apparel and accessories');
      `);

      await pool.request().query(`
        USE WarpMcpTest;
        
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
        CREATE TABLE Products (
          ProductID int IDENTITY(1,1) PRIMARY KEY,
          ProductName nvarchar(100) NOT NULL,
          Category nvarchar(50) NOT NULL,
          Price decimal(10,2) NOT NULL
        );
        
        IF NOT EXISTS (SELECT 1 FROM Products)
        INSERT INTO Products (ProductName, Category, Price) VALUES
        ('Laptop Computer', 'Electronics', 999.99),
        ('Wireless Mouse', 'Electronics', 25.99),
        ('Programming Book', 'Books', 45.50),
        ('Fiction Novel', 'Books', 12.99),
        ('T-Shirt', 'Clothing', 19.99);
      `);
      console.log('✅ Test tables created successfully!');
    } catch (error) {
      console.error('❌ Error creating test tables:', error.message);
    }

    // Create tables for Phase1ReadOnly and Phase2DML
    for (const db of databases.filter(d => d.needsTables && d.name !== 'WarpMcpTest')) {
      try {
        console.log(`📊 Creating test tables in ${db.name}...`);
        await pool.request().query(`
          USE [${db.name}];
          
          IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Categories')
          CREATE TABLE Categories (
            CategoryID int IDENTITY(1,1) PRIMARY KEY,
            CategoryName nvarchar(100) NOT NULL,
            Description nvarchar(255) NULL
          );
          
          IF NOT EXISTS (SELECT 1 FROM Categories)
          INSERT INTO Categories (CategoryName, Description) VALUES
          ('Test Category', 'Sample category for testing');
          
          IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
          CREATE TABLE Products (
            ProductID int IDENTITY(1,1) PRIMARY KEY,
            ProductName nvarchar(100) NOT NULL,
            Category nvarchar(50) NOT NULL,
            Price decimal(10,2) NOT NULL
          );
          
          IF NOT EXISTS (SELECT 1 FROM Products)
          INSERT INTO Products (ProductName, Category, Price) VALUES
          ('Test Product', 'Test Category', 29.99);
        `);
        console.log(`✅ Test tables created in ${db.name}`);
      } catch (error) {
        console.error(`❌ Error creating tables in ${db.name}: ${error.message}`);
      }
    }

    console.log('✅ Database initialization completed!');
  } catch (error) {
    console.error('💥 Failed to initialize databases:', error.message);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
async function main() {
  console.log('🚀 Starting SQL Server readiness check...');
  console.log(`🔧 Configuration: ${config.server}:${config.port}`);

  // Start with a minimal initial delay to give the container time to start
  console.log(`⏳ Brief startup delay (${timing.initialDelay / 1000}s)...`);
  await sleep(timing.initialDelay);

  let pool = null;
  let attempt = 1;
  let lastError = null;
  let currentRetryDelay = timing.baseRetryDelay;

  console.log('🔄 Waiting for SQL Server container to be ready...');

  const isAppleSilicon = process.arch === 'arm64' && process.platform === 'darwin';
  if (isAppleSilicon) {
    console.log('🍎 Apple Silicon detected - using intelligent retry with exponential backoff');
  }

  while (attempt <= timing.maxAttempts) {
    try {
      // Only show detailed attempt info after initial expected failures
      if (attempt <= 3) {
        process.stdout.write('.');
      } else {
        console.log(`🔍 Attempt ${attempt}/${timing.maxAttempts}: Testing database connection...`);
      }

      // Create a new pool for each attempt to avoid connection state issues
      pool = new sql.ConnectionPool(config);
      await pool.connect();

      // Test basic connectivity
      await pool.request().query('SELECT @@VERSION');

      // Clear the dots if we were using them
      if (attempt <= 3) {
        console.log(''); // New line after dots
      }
      console.log('✅ Database connection successful!');
      console.log('🎉 SQL Server container is ready!');

      await pool.close();
      return;
    } catch (error) {
      lastError = error;

      // Only show warning details after the first few expected failures
      if (attempt <= 3) {
        // Just show dots for expected initial failures
        // Error details are not helpful during normal Docker startup
      } else {
        console.log(
          `⚠️ Connection attempt ${attempt}/${timing.maxAttempts} failed: ${error.message}`
        );
      }

      // Clean up the failed pool
      if (pool) {
        try {
          await pool.close();
        } catch {
          // Ignore close errors
        }
        pool = null;
      }

      if (attempt < timing.maxAttempts) {
        // Calculate next delay with exponential backoff
        const delayMs = Math.min(currentRetryDelay, timing.maxRetryDelay);

        // Only show wait message for later attempts
        if (attempt > 3) {
          console.log(`⏳ Waiting ${(delayMs / 1000).toFixed(1)}s before next attempt...`);
        }
        await sleep(delayMs);

        // Increase delay for next iteration
        currentRetryDelay = Math.min(
          currentRetryDelay * timing.backoffMultiplier,
          timing.maxRetryDelay
        );
      }
      attempt++;
    }
  }

  console.error(`❌ Failed to connect after ${timing.maxAttempts} attempts`);
  console.error(`💥 Last error: ${lastError?.message || 'Unknown error'}`);
  process.exit(1);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Wait script interrupted');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Wait script terminated');
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}
