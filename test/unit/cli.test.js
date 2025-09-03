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
});
