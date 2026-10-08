import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cliUrl = new URL('../../cli.js', import.meta.url);
const cliPath = fileURLToPath(cliUrl);
const exitSentinel = new Error('CLI requested process exit');
const signals = ['SIGINT', 'SIGTERM'];

let home;
let configFile;
let savedArgv;
let savedEnvironment;
let savedSignalListeners;
let child;
let spawnMock;
let stdout;
let stdoutInfo;
let stdoutDebug;
let stdoutWrite;
let stderr;
let exitMock;

async function runCli(...args) {
  process.argv = [process.execPath, cliPath, ...args];
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ spawn: spawnMock }));
  await import(cliUrl.href);
}

function output(spy) {
  return spy.mock.calls.map(args => args.join(' ')).join('\n');
}

function expectNoProtocolStdout() {
  expect(stdout).not.toHaveBeenCalled();
  expect(stdoutInfo).not.toHaveBeenCalled();
  expect(stdoutDebug).not.toHaveBeenCalled();
  expect(stdoutWrite).not.toHaveBeenCalled();
}

// Each import temporarily changes process-global state, so the suite must not run concurrently.
describe('shipped CLI entry point under in-process coverage', { concurrent: false }, () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'wssm-cli-entry-'));
    configFile = join(home, '.warp-sql-server-mcp.json');
    savedArgv = process.argv;
    savedEnvironment = { ...process.env };
    savedSignalListeners = new Map(signals.map(signal => [signal, process.listeners(signal)]));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SQL_SERVER_')) delete process.env[key];
    }
    process.env.HOME = home;
    process.env.USERPROFILE = home;

    child = new EventEmitter();
    child.kill = vi.fn();
    spawnMock = vi.fn(() => child);
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    stdoutDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exitSentinel;
    });
  });

  afterEach(() => {
    for (const signal of signals) {
      const prior = savedSignalListeners.get(signal);
      for (const listener of process.listeners(signal)) {
        if (!prior.includes(listener)) process.removeListener(signal, listener);
      }
    }
    process.argv = savedArgv;
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, savedEnvironment);
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs');
    vi.resetModules();
    vi.restoreAllMocks();
    rmSync(home, { recursive: true });
  });

  it.each([{ args: [] }, { args: ['help'] }, { args: ['--help'] }])(
    'prints help without launching for arguments $args',
    async ({ args }) => {
      await runCli(...args);
      expect(output(stdout)).toContain('Usage:');
      expect(output(stdout)).toContain(`Config file location: ${configFile}`);
      expect(spawnMock).not.toHaveBeenCalled();
    }
  );

  it.each([{ args: ['version'] }, { args: ['--version'] }, { args: ['-v'] }])(
    'prints the package version for $args',
    async ({ args }) => {
      await runCli(...args);
      const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
      expect(output(stdout)).toContain(`@egarcia74/warp-sql-server-mcp v${version}`);
    }
  );

  it('atomically initializes an owner-only config and preserves it on a second init', async () => {
    await runCli('init');
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(config.SQL_SERVER_READ_ONLY).toBe('true');
    expect(config.SQL_SERVER_PASSWORD).toBe('your_password');

    writeFileSync(configFile, '{"SQL_SERVER_HOST":"preserved"}', { mode: 0o600 });
    await runCli('init');
    expect(readFileSync(configFile, 'utf8')).toBe('{"SQL_SERVER_HOST":"preserved"}');
    expect(output(stdout)).toContain('already exists');
  });

  it('masks a saved password in config output', async () => {
    writeFileSync(
      configFile,
      JSON.stringify({
        SQL_SERVER_HOST: 'localhost',
        SQL_SERVER_PASSWORD: 'synthetic-test-password'
      })
    );
    await runCli('config');
    expect(output(stdout)).toContain('localhost');
    expect(output(stdout)).toContain('***MASKED***');
    expect(output(stdout)).not.toContain('synthetic-test-password');
  });

  it('guides the user to initialize when config is missing', async () => {
    await runCli('config');
    expect(output(stdout)).toContain('Run: warp-sql-server-mcp init');
  });

  it('launches the MCP server with inherited stdio and keeps startup banners off stdout', async () => {
    writeFileSync(configFile, JSON.stringify({ SQL_SERVER_HOST: 'from-config' }));
    await runCli('start');
    expect(spawnMock).toHaveBeenCalledWith(process.execPath, [resolve(cliPath, '../index.js')], {
      stdio: 'inherit',
      env: process.env
    });
    expect(process.env.SQL_SERVER_HOST).toBe('from-config');
    expect(output(stderr)).toContain('Starting Warp SQL Server MCP');
    expect(output(stderr)).toContain('Configuration loaded from:');
    expectNoProtocolStdout();
  });

  it('retains existing environment values over saved configuration', async () => {
    process.env.SQL_SERVER_HOST = 'from-environment';
    writeFileSync(configFile, JSON.stringify({ SQL_SERVER_HOST: 'from-config' }));
    await runCli('start');
    expect(process.env.SQL_SERVER_HOST).toBe('from-environment');
    expectNoProtocolStdout();
  });

  it('starts with environment-only configuration when no file exists', async () => {
    await runCli('start');
    expect(output(stderr)).toContain('Using environment variables only');
    expectNoProtocolStdout();
  });

  it('stops on malformed config and never spawns a child', async () => {
    writeFileSync(configFile, '{invalid-json');
    await expect(runCli('start')).rejects.toBe(exitSentinel);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(output(stderr)).toContain('Failed to load configuration file');
    expectNoProtocolStdout();
  });

  it('stops on malformed config display', async () => {
    writeFileSync(configFile, '{invalid-json');
    await expect(runCli('config')).rejects.toBe(exitSentinel);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(output(stderr)).toContain('Failed to read configuration file');
  });

  it('stops when the package version cannot be read', async () => {
    const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
    vi.doMock('node:fs', async importOriginal => {
      const actual = await importOriginal();
      return {
        ...actual,
        default: {
          ...actual.default,
          readFileSync: (...args) => {
            if (args[0] === packagePath) throw new Error('synthetic package read failure');
            return actual.default.readFileSync(...args);
          }
        }
      };
    });
    await expect(runCli('version')).rejects.toBe(exitSentinel);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(output(stderr)).toContain('Failed to read version');
  });

  it('stops when initialization cannot create the config file', async () => {
    const blockedHome = join(home, 'not-a-directory');
    writeFileSync(blockedHome, 'synthetic file');
    process.env.HOME = blockedHome;
    await expect(runCli('init')).rejects.toBe(exitSentinel);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(output(stderr)).toContain('Failed to create configuration file');
  });

  it('stops on an unknown command after printing help', async () => {
    await expect(runCli('not-a-command')).rejects.toBe(exitSentinel);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(output(stderr)).toContain('Unknown command');
    expect(output(stdout)).toContain('Usage:');
  });

  it('exits when the server emits a spawn error', async () => {
    await runCli('start');
    expect(() => child.emit('error', new Error('synthetic spawn failure'))).toThrow(exitSentinel);
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(output(stderr)).toContain('Failed to start server');
    expectNoProtocolStdout();
  });

  it('forwards the child exit code', async () => {
    await runCli('start');
    expect(() => child.emit('exit', 17)).toThrow(exitSentinel);
    expect(exitMock).toHaveBeenCalledWith(17);
    expectNoProtocolStdout();
  });

  it.each(signals)('forwards %s to the child without writing stdout', async signal => {
    await runCli('start');
    const prior = savedSignalListeners.get(signal);
    const added = process.listeners(signal).filter(listener => !prior.includes(listener));
    expect(added).toHaveLength(1);
    added[0]();
    expect(child.kill).toHaveBeenCalledWith(signal);
    expect(output(stderr)).toContain('Shutting down server');
    expectNoProtocolStdout();
  });
});
