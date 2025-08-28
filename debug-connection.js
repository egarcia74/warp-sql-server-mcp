#!/usr/bin/env node

import sql from 'mssql';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('Testing SQL Server connection...');
console.log(`Host: ${process.env.SQL_SERVER_HOST || 'localhost'}`);
console.log(`Port: ${process.env.SQL_SERVER_PORT || '1433'}`);
console.log(`Database: ${process.env.SQL_SERVER_DATABASE || 'master'}`);
console.log(`User: ${process.env.SQL_SERVER_USER ? '[SET]' : '[NOT SET]'}`);
console.log(`Password: ${process.env.SQL_SERVER_PASSWORD ? '[SET]' : '[NOT SET]'}`);

const config = {
  server: process.env.SQL_SERVER_HOST || 'localhost',
  port: parseInt(process.env.SQL_SERVER_PORT) || 1433,
  database: process.env.SQL_SERVER_DATABASE || 'master',
  user: process.env.SQL_SERVER_USER,
  password: process.env.SQL_SERVER_PASSWORD,
  options: {
    encrypt: process.env.SQL_SERVER_ENCRYPT === 'true' || false,
    trustServerCertificate: process.env.SQL_SERVER_TRUST_CERT === 'true' || true,
    enableArithAbort: true,
    requestTimeout: 30000,
    connectTimeout: 10000
  }
};

// Handle Windows Authentication if no user/password provided
if (!config.user && !config.password) {
  config.authentication = {
    type: 'ntlm',
    options: {
      domain: process.env.SQL_SERVER_DOMAIN || ''
    }
  };
  console.log('Using Windows Authentication');
} else {
  console.log('Using SQL Server Authentication');
}

try {
  console.log('\nAttempting to connect...');
  const pool = await sql.connect(config);
  console.log('✅ Successfully connected to SQL Server!');

  console.log('\nTesting query execution...');
  const result = await pool
    .request()
    .query('SELECT @@VERSION as version, DB_NAME() as current_database');
  console.log('✅ Query executed successfully!');
  console.log('SQL Server Version:', result.recordset[0].version.split('\n')[0]);
  console.log('Current Database:', result.recordset[0].current_database);

  console.log('\nTesting database list query...');
  const dbResult = await pool.request().query(`
    SELECT 
      name as database_name,
      database_id,
      create_date,
      collation_name,
      state_desc as status
    FROM sys.databases 
    WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
    ORDER BY name
  `);

  console.log('✅ Database list query successful!');
  console.log(`Found ${dbResult.recordset.length} user databases:`);
  dbResult.recordset.forEach(db => {
    console.log(`  - ${db.database_name} (${db.status})`);
  });

  await pool.close();
  console.log('\n🎉 All tests passed! Your SQL Server connection is working correctly.');
} catch (error) {
  console.error('❌ Connection failed:', error.message);
  console.error('\nTroubleshooting steps:');
  console.error('1. Verify SQL Server is running');
  console.error('2. Check credentials in .env file');
  console.error('3. Ensure SQL Server allows remote connections');
  console.error('4. Check firewall settings');
  console.error('5. Verify SQL Server authentication mode');
  process.exit(1);
}
