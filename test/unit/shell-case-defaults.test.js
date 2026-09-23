import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptsDir = fileURLToPath(new URL('../../scripts/', import.meta.url));
const shellDescribe = process.platform === 'win32' ? describe.skip : describe;
let fixtureDir;
let traceFile;

function executable(name, contents) {
  const file = path.join(fixtureDir, name);
  writeFileSync(file, `#!/bin/sh\n${contents}\n`);
  chmodSync(file, 0o755);
}

function runScript(name, args = [], sourceOverride) {
  let script = path.join(scriptsDir, name);
  if (sourceOverride) {
    script = path.join(fixtureDir, name);
    writeFileSync(script, sourceOverride);
  }

  return spawnSync('bash', [script, ...args], {
    cwd: fixtureDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PATH: `${fixtureDir}${path.delimiter}${process.env.PATH}`,
      TRACE_FILE: traceFile
    },
    timeout: 15_000
  });
}

function trace() {
  return readFileSync(traceFile, 'utf8').trim().split('\n');
}

beforeEach(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'shell-case-defaults-'));
  traceFile = path.join(fixtureDir, 'trace.txt');
  writeFileSync(traceFile, '');
  executable(
    'docker',
    'printf "docker:%s\\n" "$*" >> "$TRACE_FILE"\nprintf "warp-mcp-sqlserver\\n"'
  );
  executable('npm', 'printf "npm:%s\\n" "$*" >> "$TRACE_FILE"');
  executable('node', 'printf "node:%s\\n" "$*" >> "$TRACE_FILE"');
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

shellDescribe('docker test runner phase dispatch', () => {
  it.each([
    ['phase1', 'test/integration/manual/phase1-readonly-security.test.js'],
    ['phase2', 'test/integration/manual/phase2-dml-operations.test.js'],
    ['phase3', 'test/integration/manual/phase3-ddl-operations.test.js'],
    ['protocol', 'test/protocol/mcp-server-startup-test.js']
  ])('runs the %s phase', (phase, file) => {
    const result = runScript('docker-test-runner.sh', [phase]);
    expect(result.status).toBe(0);
    expect(trace()).toContain(`node:${file}`);
  });

  it('defaults to phase1', () => {
    const result = runScript('docker-test-runner.sh');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('defaulting to phase1');
    expect(trace()).toContain('node:test/integration/manual/phase1-readonly-security.test.js');
  });

  it('rejects an unknown public argument before Docker work', () => {
    const result = runScript('docker-test-runner.sh', ['unexpected']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Unknown argument: unexpected');
    expect(readFileSync(traceFile, 'utf8')).toBe('');
  });

  it('fails closed if an unexpected phase reaches the internal dispatch', () => {
    const original = readFileSync(path.join(scriptsDir, 'docker-test-runner.sh'), 'utf8');
    const source = original.replace('case $PHASE in', 'PHASE=unrecognized\ncase $PHASE in');
    expect(source).not.toBe(original);

    const result = runScript('docker-test-runner.sh', [], source);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Unexpected phase: unrecognized');
    expect(trace().some(line => line.startsWith('node:'))).toBe(false);
  });
});

shellDescribe('log viewer type dispatch', () => {
  it.each([
    ['server', './logs/server.log'],
    ['audit', './logs/security-audit.log']
  ])('shows the expected path for missing %s logs', (type, expectedPath) => {
    const result = runScript('show-logs.sh', [type]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(expectedPath);
    expect(result.stdout).toContain(`All possible paths for ${type} logs:`);
  });

  it('rejects an unknown public type', () => {
    const result = runScript('show-logs.sh', ['unexpected']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Unknown argument: unexpected');
  });

  it('fails closed if an unexpected type reaches the missing-log dispatch', () => {
    const original = readFileSync(path.join(scriptsDir, 'show-logs.sh'), 'utf8');
    const source = original.replace(
      'case "$LOG_TYPE" in',
      'LOG_TYPE=unrecognized\n        case "$LOG_TYPE" in'
    );
    expect(source).not.toBe(original);

    const result = runScript('show-logs.sh', [], source);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Unexpected log type: unrecognized');
  });
});
