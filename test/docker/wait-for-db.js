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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logConnectionAttempt(attempt) {
  // Only show detailed attempt info after initial expected failures.
  if (attempt <= 3) {
    process.stdout.write('.');
  } else {
    console.log(`🔍 Attempt ${attempt}/${timing.maxAttempts}: Testing database connection...`);
  }
}

function logConnectionSuccess(attempt) {
  // Clear the dots if we were using them.
  if (attempt <= 3) {
    console.log('');
  }
  console.log('✅ Database connection successful!');
  console.log('🎉 SQL Server container is ready!');
}

function logConnectionFailure(attempt, error) {
  // Error details are not helpful during normal Docker startup.
  if (attempt > 3) {
    console.log(`⚠️ Connection attempt ${attempt}/${timing.maxAttempts} failed: ${error.message}`);
  }
}

async function closeFailedPool(pool) {
  if (pool) {
    try {
      await pool.close();
    } catch {
      // Ignore close errors.
    }
  }
}

async function waitBeforeRetry(attempt, currentRetryDelay) {
  const delayMs = Math.min(currentRetryDelay, timing.maxRetryDelay);

  if (attempt > 3) {
    console.log(`⏳ Waiting ${(delayMs / 1000).toFixed(1)}s before next attempt...`);
  }
  await sleep(delayMs);

  return Math.min(currentRetryDelay * timing.backoffMultiplier, timing.maxRetryDelay);
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
      logConnectionAttempt(attempt);

      // Create a new pool for each attempt to avoid connection state issues
      pool = new sql.ConnectionPool(config);
      await pool.connect();

      // Test basic connectivity
      await pool.request().query('SELECT @@VERSION');

      logConnectionSuccess(attempt);

      await pool.close();
      return;
    } catch (error) {
      lastError = error;

      logConnectionFailure(attempt, error);

      // Clean up the failed pool
      await closeFailedPool(pool);
      pool = null;

      if (attempt < timing.maxAttempts) {
        currentRetryDelay = await waitBeforeRetry(attempt, currentRetryDelay);
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
