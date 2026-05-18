import mssql from 'mssql';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Load Docker env
const envPath = path.join(process.cwd(), 'test/docker/.env.docker');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const config = {
  user: process.env.SQL_SERVER_USER || process.env.DB_USER || 'sa',
  // Intentionally required from env; validated before connect rather than defaulted.
  password: process.env.SQL_SERVER_PASSWORD || process.env.DB_PASSWORD,
  server: process.env.SQL_SERVER_HOST || process.env.DB_SERVER || 'localhost',
  port: Number(process.env.SQL_SERVER_PORT || process.env.DB_PORT || '1433'),
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  pool: {
    max: 1,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

/**
 * Splits SQL script into batches separated by GO statements
 * @param {string} sqlScript - The SQL script to split
 * @returns {string[]} Array of SQL batches
 */
function splitSqlBatches(sqlScript) {
  // Standardize line endings to \n
  const lines = sqlScript.replaceAll('\r\n', '\n').split('\n');
  const batches = [];
  let currentBatch = [];

  for (const line of lines) {
    if (line.trim().toUpperCase() === 'GO') {
      if (currentBatch.length > 0) {
        const batch = currentBatch.join('\n').trim();
        if (batch.length > 0) {
          batches.push(batch);
        }
        currentBatch = [];
      }
    } else {
      currentBatch.push(line);
    }
  }

  // Add final batch if exists
  if (currentBatch.length > 0) {
    const batch = currentBatch.join('\n').trim();
    if (batch.length > 0) {
      batches.push(batch);
    }
  }

  return batches;
}

async function initDb() {
  if (!config.password) {
    throw new Error(
      'DB_PASSWORD or SQL_SERVER_PASSWORD must be set before initializing the Docker database'
    );
  }

  console.log(`🔌 Connecting to ${config.server}:${config.port}...`);
  let pool;
  try {
    pool = await mssql.connect(config);
    console.log('✅ Connected.');

    const sqlScriptPath = path.join(process.cwd(), 'test/docker/init-db.sql');
    const sqlScript = fs.readFileSync(sqlScriptPath, 'utf8');

    // Split SQL script into batches separated by GO statements
    const batches = splitSqlBatches(sqlScript);

    for (const batch of batches) {
      console.log('🚀 Executing SQL batch...');
      await pool.request().query(batch);
    }

    console.log('✅ Database initialization complete.');
  } catch (err) {
    console.error('❌ Initialization failed:', err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

await initDb();
