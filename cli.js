#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { applyFileEnvironment, getConfigPath } from './lib/config/environment.js';
import { projectSavedConfig } from './lib/cli/saved-config-display.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let CONFIG_FILE, configPathError;
try {
  CONFIG_FILE = getConfigPath(process.env);
} catch (error) {
  configPathError = error?.code === 'missing-home' ? 'missing-home' : 'unavailable';
}
const CONFIG_LOCATION =
  CONFIG_FILE ??
  (configPathError === 'missing-home'
    ? 'unavailable (HOME or USERPROFILE not set)'
    : 'unavailable');
const CONFIG_LOCATION_ERROR =
  configPathError === 'missing-home'
    ? 'HOME or USERPROFILE is required to locate the configuration file.'
    : 'Configuration file location is unavailable.';
const EXAMPLE_CONFIG = {
  SQL_SERVER_HOST: 'localhost',
  SQL_SERVER_PORT: '1433',
  SQL_SERVER_DATABASE: 'master',
  SQL_SERVER_USER: 'your_username',
  SQL_SERVER_PASSWORD: 'your_password',
  SQL_SERVER_ENCRYPT: 'true',
  SQL_SERVER_TRUST_CERT: 'false',
  SQL_SERVER_READ_ONLY: 'true',
  SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'false',
  SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false',
  SQL_SERVER_CONNECT_TIMEOUT_MS: '10000',
  SQL_SERVER_REQUEST_TIMEOUT_MS: '30000',
  SQL_SERVER_MAX_RETRIES: '3',
  SQL_SERVER_RETRY_DELAY_MS: '1000'
};

function showHelp() {
  // Help should go to stdout for CLI usage
  console.log(`
Warp SQL Server MCP - Secure database connectivity for Warp

Usage:
  warp-sql-server-mcp <command> [options]

Commands:
  start              Start the MCP server
  init               Initialize configuration file
  config             Show saved configuration
  config edit        Edit configuration in a guided menu (interactive terminal)
  config validate    Run a bounded, read-only connection probe without saving
  version, --version, -v   Show the installed version
  help, --help, -h   Show this help message

Examples:
  warp-sql-server-mcp init       # Create initial config file
  warp-sql-server-mcp config     # Show current configuration
  warp-sql-server-mcp start      # Start the MCP server

Configuration:
  Config file location: ${CONFIG_LOCATION}
  
  Use 'config edit' to review and explicitly Save your SQL Server details.
  'config validate' runs SELECT 1 without saving or starting MCP (60s + up to 3s shutdown).
  New-command statuses: 0 saved/valid, 1 probe/runtime/cleanup, 2 local/usage, 130 cancel, 143 SIGTERM.
  Passwords saved in JSON are plaintext; environment credentials remain available.
  The home file fills missing/empty environment values; dotenv overrides only when explicitly enabled.
`);
}

function showVersion() {
  // Read the version from this package's package.json (resolved relative to
  // this file so it works regardless of the install location).
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    console.log(`${pkg.name} v${pkg.version}`);
  } catch (error) {
    console.error(`❌ Failed to read version: ${error.message}`);
    process.exit(1);
  }
}

function initConfig() {
  if (configPathError) {
    console.error('❌ ' + CONFIG_LOCATION_ERROR);
    process.exit(1);
    return;
  }
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
    console.log(
      'For an isolated local server with a self-signed certificate, explicitly set SQL_SERVER_TRUST_CERT to true while keeping SQL_SERVER_ENCRYPT true.'
    );
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
  if (configPathError) {
    console.log('❌ ' + CONFIG_LOCATION_ERROR);
    return;
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`❌ Configuration file not found at: ${CONFIG_FILE}`);
    console.log('Run: warp-sql-server-mcp init');
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const displayConfig = projectSavedConfig(config);
    console.log(`Configuration file: ${CONFIG_FILE}`);
    console.log('Current settings:');
    console.log(JSON.stringify(displayConfig, null, 2));
  } catch {
    console.error('❌ Failed to read configuration file: invalid or unreadable JSON');
    process.exit(1);
  }
}

// These banners are `console.error`, not `console.log`, and **not** because of any
// detection (#1260). This function only runs on the `start` path, which then spawns
// `index.js` with `stdio: 'inherit'` - so this process's stdout *is* the file descriptor
// that becomes the JSON-RPC channel moments later. There is no variant of `start` where
// writing to it is safe, so there is nothing to detect. A human running `start` in a
// terminal still sees these lines, because a terminal shows stderr. (The human-facing
// `init`, `config`, `version` and `help` commands never spawn the server and keep their
// `console.log`.)
function loadConfigToEnv() {
  if (configPathError || !fs.existsSync(CONFIG_FILE)) {
    console.error(
      configPathError
        ? '⚠️  ' + CONFIG_LOCATION_ERROR
        : `⚠️  No configuration file found at: ${CONFIG_FILE}`
    );
    console.error(
      'Using environment variables only. Run "warp-sql-server-mcp init" to create a config file.'
    );
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // Set environment variables from config (don't override existing env vars)
    Object.assign(process.env, applyFileEnvironment(process.env, config));
    console.error(`✅ Configuration loaded from: ${CONFIG_FILE}`);
  } catch {
    console.error('❌ Failed to load configuration file: invalid or unreadable JSON');
    process.exit(1);
  }
}

function startServer() {
  // stderr unconditionally: the `spawn(..., { stdio: 'inherit' })` below hands this
  // process's stdout straight to the MCP server as its protocol channel. See the note
  // above `loadConfigToEnv()` for why there is nothing here to detect.
  console.error('🚀 Starting Warp SQL Server MCP...');
  // Load configuration into environment
  loadConfigToEnv();
  // Start the actual MCP server
  const serverPath = path.join(__dirname, 'index.js');
  const serverProcess = spawn(process.execPath, [serverPath], {
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

  // Handle graceful shutdown. stderr for the same reason as the startup banners: the
  // child inherited this stdout as its protocol channel and may still be draining it.
  process.on('SIGINT', () => {
    console.error('\n🛑 Shutting down server...');
    serverProcess.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.error('\n🛑 Shutting down server...');
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
    if (process.argv.length === 3) {
      showConfig();
      break;
    }
    if (process.argv.length !== 4 || !['edit', 'validate'].includes(process.argv[3])) {
      console.error('Usage: config edit | config validate. No additional arguments are accepted.');
      process.exitCode = 2;
      break;
    }
    {
      const controller = new globalThis.AbortController();
      const interrupt = () => {
        if (controller.signal.aborted)
          controller.signal.dispatchEvent(new globalThis.Event('abort'));
        else controller.abort('SIGINT');
      };
      const terminate = () => controller.abort('SIGTERM');
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', terminate);
      try {
        const subcommand = process.argv[3];
        const module = await import(
          subcommand === 'validate'
            ? './lib/cli/config-validation.js'
            : './lib/cli/config-editor.js'
        );
        process.exitCode = await (
          subcommand === 'validate' ? module.validateConfigCommand : module.editConfigCommand
        )({ signal: controller.signal });
      } catch {
        console.error('Configuration command failed.');
        process.exitCode = 2;
      } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
      }
    }
    break;
  case 'version':
  case '--version':
  case '-v':
    showVersion();
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
