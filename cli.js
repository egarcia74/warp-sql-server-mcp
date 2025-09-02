#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.warp-sql-server-mcp.json'
);
const EXAMPLE_CONFIG = {
  SQL_SERVER_HOST: 'localhost',
  SQL_SERVER_PORT: '1433',
  SQL_SERVER_DATABASE: 'master',
  SQL_SERVER_USER: 'your_username',
  SQL_SERVER_PASSWORD: 'your_password',
  SQL_SERVER_ENCRYPT: 'false',
  SQL_SERVER_TRUST_CERT: 'true',
  SQL_SERVER_READ_ONLY: 'true',
  SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'false',
  SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false',
  SQL_SERVER_CONNECT_TIMEOUT_MS: '10000',
  SQL_SERVER_REQUEST_TIMEOUT_MS: '30000',
  SQL_SERVER_MAX_RETRIES: '3',
  SQL_SERVER_RETRY_DELAY_MS: '1000'
};

function showHelp() {
  console.log(`
Warp SQL Server MCP - Secure database connectivity for Warp

Usage:
  warp-sql-server-mcp <command> [options]

Commands:
  start              Start the MCP server
  init               Initialize configuration file
  config             Show current configuration
  help, --help, -h   Show this help message

Examples:
  warp-sql-server-mcp init       # Create initial config file
  warp-sql-server-mcp config     # Show current configuration
  warp-sql-server-mcp start      # Start the MCP server

Configuration:
  Config file location: ${CONFIG_FILE}
  
  After running 'init', edit the config file with your SQL Server details.
  The server will use environment variables first, then fall back to config file.
`);
}

function initConfig() {
  // Security: Use O_CREAT | O_EXCL flags to atomically create file and fail if it exists
  // This prevents TOCTOU (Time-of-Check Time-of-Use) race conditions where another
  // process could create the file between our existence check and write operation
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY;

  try {
    // Atomic file creation with restrictive permissions (0o600 = owner read/write only)
    const fd = fs.openSync(CONFIG_FILE, flags, 0o600);
    fs.writeSync(fd, JSON.stringify(EXAMPLE_CONFIG, null, 2));
    fs.closeSync(fd);

    console.log(`✅ Configuration file created at: ${CONFIG_FILE}`);
    console.log('\n📝 Next steps:');
    console.log('1. Edit the configuration file with your SQL Server details');
    console.log('2. Run: warp-sql-server-mcp start');
    console.log('\n⚠️  Security Note: The config file contains your database credentials.');
    console.log('   File permissions set to 600 (owner read/write only).');
  } catch (error) {
    if (error.code === 'EEXIST') {
      // File already exists - this is expected behavior, not an error
      console.log(`Configuration file already exists at: ${CONFIG_FILE}`);
      console.log('To reconfigure, delete the file and run init again, or edit it directly.');
      return;
    }
    // Other errors (permissions, disk space, etc.) are actual failures
    console.error(`❌ Failed to create configuration file: ${error.message}`);
    process.exit(1);
  }
}

function showConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`❌ Configuration file not found at: ${CONFIG_FILE}`);
    console.log('Run: warp-sql-server-mcp init');
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log(`Configuration file: ${CONFIG_FILE}`);
    console.log('Current settings:');
    // Mask sensitive values
    const displayConfig = { ...config };
    if (displayConfig.SQL_SERVER_PASSWORD) {
      displayConfig.SQL_SERVER_PASSWORD = '***MASKED***';
    }
    console.log(JSON.stringify(displayConfig, null, 2));
  } catch (error) {
    console.error(`❌ Failed to read configuration file: ${error.message}`);
    process.exit(1);
  }
}

function loadConfigToEnv() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`⚠️  No configuration file found at: ${CONFIG_FILE}`);
    console.log(
      'Using environment variables only. Run "warp-sql-server-mcp init" to create a config file.'
    );
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // Set environment variables from config (don't override existing env vars)
    for (const [key, value] of Object.entries(config)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log(`✅ Configuration loaded from: ${CONFIG_FILE}`);
  } catch (error) {
    console.error(`❌ Failed to load configuration file: ${error.message}`);
    process.exit(1);
  }
}

function startServer() {
  console.log('🚀 Starting Warp SQL Server MCP...');
  // Load configuration into environment
  loadConfigToEnv();
  // Start the actual MCP server
  const serverPath = path.join(__dirname, 'index.js');
  const serverProcess = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: process.env
  });

  serverProcess.on('error', error => {
    console.error(`❌ Failed to start server: ${error.message}`);
    process.exit(1);
  });

  serverProcess.on('exit', code => {
    process.exit(code);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    serverProcess.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    serverProcess.kill('SIGTERM');
  });
}

// Parse command line arguments
const command = process.argv[2];

switch (command) {
  case 'start':
    startServer();
    break;
  case 'init':
    initConfig();
    break;
  case 'config':
    showConfig();
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    showHelp();
    break;
  default:
    console.error(`❌ Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
