import mssql from 'mssql';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load Docker env
const envPath = path.join(process.cwd(), 'test/docker/.env.docker');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'WarpMCP123!',
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433'),
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
    const lines = sqlScript.replace(/\r\n/g, '\n').split('\n');
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

initDb();
