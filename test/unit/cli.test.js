import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../../cli.js');

describe('CLI Security Tests', () => {
  const testConfigDir = path.join(__dirname, '../temp');
  const testConfigFile = path.join(testConfigDir, '.warp-sql-server-mcp.json');

  beforeEach(() => {
    // Ensure test directory exists
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    // Clean up any existing test config file
    if (fs.existsSync(testConfigFile)) {
      fs.unlinkSync(testConfigFile);
    }
  });

  afterEach(() => {
    // Clean up test config file
    if (fs.existsSync(testConfigFile)) {
      fs.unlinkSync(testConfigFile);
    }
  });

  test('should create config file atomically without TOCTOU race condition', async () => {
    // Test the atomic file creation by simulating concurrent init calls
    const promises = [];
    const results = [];

    // Spawn multiple concurrent processes trying to create the same config file
    for (let i = 0; i < 3; i++) {
      const promise = new Promise(resolve => {
        // Override HOME to use our test directory
        const env = { ...process.env, HOME: testConfigDir };
        const proc = spawn('node', [CLI_PATH, 'init'], {
          env,
          stdio: 'pipe'
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => {
          stdout += data.toString();
        });

        proc.stderr.on('data', data => {
          stderr += data.toString();
        });

        proc.on('close', code => {
          resolve({
            code,
            stdout,
            stderr,
            processId: i
          });
        });
      });

      promises.push(promise);
    }

    // Wait for all processes to complete
    const allResults = await Promise.all(promises);
    results.push(...allResults);

    // Verify results
    expect(results).toHaveLength(3);

    // Exactly one process should succeed (exit code 0)
    const successfulInits = results.filter(r => r.code === 0);

    // Either one process created the file and others detected it exists,
    // OR one created it and others gracefully handled the "already exists" case
    expect(successfulInits.length).toBeGreaterThanOrEqual(1);

    // Verify the config file was created
    expect(fs.existsSync(testConfigFile)).toBe(true);

    // Verify file has correct permissions (0o600)
    const stats = fs.statSync(testConfigFile);
    expect(stats.mode & 0o777).toBe(0o600);

    // Verify file contains valid JSON
    const configData = fs.readFileSync(testConfigFile, 'utf8');
    const config = JSON.parse(configData);
    expect(config).toHaveProperty('SQL_SERVER_HOST');
    expect(config).toHaveProperty('SQL_SERVER_USER');
    expect(config).toHaveProperty('SQL_SERVER_PASSWORD');
  });

  test('should handle existing config file gracefully', async () => {
    // Create initial config file
    const initialConfig = { test: 'initial' };
    fs.writeFileSync(testConfigFile, JSON.stringify(initialConfig), { mode: 0o600 });

    // Try to init again
    const env = { ...process.env, HOME: testConfigDir };
    const proc = spawn('node', [CLI_PATH, 'init'], {
      env,
      stdio: 'pipe'
    });

    let stdout = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    const exitCode = await new Promise(resolve => {
      proc.on('close', resolve);
    });

    // Should exit successfully and indicate file already exists
    expect(exitCode).toBe(0);
    expect(stdout).toContain('already exists');

    // Original file should be unchanged
    const configData = fs.readFileSync(testConfigFile, 'utf8');
    const config = JSON.parse(configData);
    expect(config).toEqual(initialConfig);
  });

  test('should show help when no command provided', async () => {
    const proc = spawn('node', [CLI_PATH], { stdio: 'pipe' });

    let stdout = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    const exitCode = await new Promise(resolve => {
      proc.on('close', resolve);
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Warp SQL Server MCP');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('Commands:');
  });

  test('should print the package version with --version', async () => {
    const proc = spawn('node', [CLI_PATH, '--version'], { stdio: 'pipe' });

    let stdout = '';
    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    const exitCode = await new Promise(resolve => {
      proc.on('close', resolve);
    });

    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    expect(exitCode).toBe(0);
    expect(stdout).toContain(pkg.version);
    expect(stdout).toContain('@egarcia74/warp-sql-server-mcp');
  });

  describe('start keeps its banners off stdout', () => {
    // `start` spawns index.js with `stdio: 'inherit'`, so this process's stdout is the
    // JSON-RPC channel. The environment here declares *nothing* - no MCP_TRANSPORT, no
    // VSCODE_* - which is exactly the configuration the deleted detection got wrong
    // (#1260). The banners must reach stderr anyway.
    const FORMER_MCP_SIGNALS = [
      'MCP_TRANSPORT',
      'VSCODE_MCP',
      'VSCODE_PID',
      'VSCODE_IPC_HOOK',
      'PARENT_PROCESS'
    ];

    /** The environment every spawn below uses: config in the test directory, nothing declared. */
    function cliEnv() {
      const env = { ...process.env, HOME: testConfigDir, USERPROFILE: testConfigDir };
      for (const name of FORMER_MCP_SIGNALS) delete env[name];
      return env;
    }

    /** Creates the config file the way a user would, with `warp-sql-server-mcp init`. */
    async function initConfig() {
      const proc = spawn('node', [CLI_PATH, 'init'], { env: cliEnv(), stdio: 'ignore' });
      await new Promise(resolve => proc.on('close', resolve));
    }

    /** Runs `cli.js start` briefly and returns whatever each stream received. */
    async function captureStart() {
      const proc = spawn('node', [CLI_PATH, 'start'], { env: cliEnv(), stdio: 'pipe' });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', data => (stdout += data.toString()));
      proc.stderr.on('data', data => (stderr += data.toString()));

      const closed = new Promise(resolve => proc.on('close', resolve));
      await new Promise(resolve => setTimeout(resolve, 1500));
      proc.kill('SIGTERM');
      await closed;

      return { stdout, stderr };
    }

    test('routes the startup and config banners to stderr, leaving stdout clean', async () => {
      await initConfig();
      expect(fs.existsSync(testConfigFile)).toBe(true);

      const { stdout, stderr } = await captureStart();

      expect(stderr).toContain('🚀 Starting Warp SQL Server MCP...');
      expect(stderr).toContain(`✅ Configuration loaded from: ${testConfigFile}`);
      expect(stdout).not.toContain('Starting Warp SQL Server MCP');
      expect(stdout).not.toContain('Configuration loaded from');
    }, 15000);

    test('routes the missing-config warning to stderr too', async () => {
      // No config file: loadConfigToEnv() takes its other branch, which has its own pair
      // of banners.
      const { stdout, stderr } = await captureStart();

      expect(stderr).toContain('No configuration file found at:');
      expect(stderr).toContain('Using environment variables only.');
      expect(stdout).not.toContain('No configuration file found at:');
      expect(stdout).not.toContain('Using environment variables only.');
    }, 15000);
  });
});
