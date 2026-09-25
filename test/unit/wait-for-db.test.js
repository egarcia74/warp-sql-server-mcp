import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, test } from 'vitest';

const cliPath = fileURLToPath(new URL('../docker/wait-for-db.js', import.meta.url));
const preloadPath = fileURLToPath(new URL('./fixtures/wait-db-preload.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const isAppleSilicon = process.arch === 'arm64' && process.platform === 'darwin';
const initialDelay = isAppleSilicon ? 2000 : 1000;
const maxAttempts = isAppleSilicon ? 25 : 15;
const maxRetryDelay = isAppleSilicon ? 8000 : 5000;

function runReadiness(scenario) {
  const result = spawnSync(process.execPath, ['--import', preloadPath, cliPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WAIT_DB_SCENARIO: scenario,
      SQL_SERVER_HOST: 'fixture-host',
      SQL_SERVER_PORT: '14330'
    },
    encoding: 'utf8',
    timeout: 10000
  });
  expect(result.error).toBeUndefined();

  const trace = result.stderr
    .split('\n')
    .filter(line => line.startsWith('WAIT_DB_TRACE:'))
    .map(line => JSON.parse(line.slice('WAIT_DB_TRACE:'.length)));
  const stderr = result.stderr
    .split('\n')
    .filter(line => !line.startsWith('WAIT_DB_TRACE:'))
    .join('\n');
  return { status: result.status, stdout: result.stdout, stderr, trace };
}

function events(trace, event) {
  return trace.filter(item => item.event === event);
}

function cliOutput(stdout) {
  const start = '🚀 Starting SQL Server readiness check...';
  expect(stdout).toContain(start);
  return stdout.slice(stdout.indexOf(start));
}

function expectedPreamble() {
  const lines = [
    '🚀 Starting SQL Server readiness check...',
    '🔧 Configuration: fixture-host:14330',
    `⏳ Brief startup delay (${initialDelay / 1000}s)...`,
    '🔄 Waiting for SQL Server container to be ready...'
  ];
  if (isAppleSilicon) {
    lines.push('🍎 Apple Silicon detected - using intelligent retry with exponential backoff');
  }
  return `${lines.join('\n')}\n`;
}

describe('Docker database readiness CLI', () => {
  test('uses one pool and closes it after an immediate successful query', () => {
    const result = runReadiness('immediate-success');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Configuration: fixture-host:14330');
    expect(result.stdout).toContain('✅ Database connection successful!');
    expect(result.stdout).toContain('🎉 SQL Server container is ready!');
    expect(result.stdout).not.toContain('Attempt 4/');
    expect(result.trace).toEqual([
      { event: 'sleep', delay: initialDelay },
      { event: 'construct', id: 1 },
      { event: 'connect', id: 1 },
      { event: 'request', id: 1 },
      { event: 'query', id: 1, statement: 'SELECT @@VERSION' },
      { event: 'close', id: 1 }
    ]);
  });

  test('suppresses early errors, then reports the fifth attempt and its prior wait', () => {
    const result = runReadiness('success-fifth');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`🔍 Attempt 4/${maxAttempts}: Testing database connection...`);
    expect(result.stdout).toContain(
      `⚠️ Connection attempt 4/${maxAttempts} failed: connect failure 4`
    );
    expect(result.stdout).toContain(`🔍 Attempt 5/${maxAttempts}: Testing database connection...`);
    expect(result.stdout).not.toContain('Connection attempt 1/');
    expect(result.stdout).not.toContain('Connection attempt 2/');
    expect(result.stdout).not.toContain('Connection attempt 3/');
    expect(events(result.trace, 'construct')).toHaveLength(5);
    expect(events(result.trace, 'close').map(item => item.id)).toEqual([1, 2, 3, 4, 5]);
    const delays = events(result.trace, 'sleep').map(item => item.delay);
    const expected = isAppleSilicon
      ? [2000, 1500, 1950, 2535, 3295.5]
      : [1000, 1000, 1400, 1960, 2744];
    expect(delays).toHaveLength(expected.length);
    expected.forEach((value, index) => expect(delays[index]).toBeCloseTo(value));

    expect(cliOutput(result.stdout)).toBe(
      `${expectedPreamble()}...🔍 Attempt 4/${maxAttempts}: Testing database connection...\n` +
        `⚠️ Connection attempt 4/${maxAttempts} failed: connect failure 4\n` +
        `⏳ Waiting ${(expected[4] / 1000).toFixed(1)}s before next attempt...\n` +
        `🔍 Attempt 5/${maxAttempts}: Testing database connection...\n` +
        '✅ Database connection successful!\n' +
        '🎉 SQL Server container is ready!\n'
    );
  });

  test('closes a failed query pool before retrying the same SQL with a new pool', () => {
    const result = runReadiness('query-fails-once');

    expect(result.status).toBe(0);
    expect(events(result.trace, 'query').map(item => item.statement)).toEqual([
      'SELECT @@VERSION',
      'SELECT @@VERSION'
    ]);
    expect(events(result.trace, 'close').map(item => item.id)).toEqual([1, 2]);
    expect(events(result.trace, 'sleep').map(item => item.delay)).toEqual([
      initialDelay,
      isAppleSilicon ? 1500 : 1000
    ]);
  });

  test('retries a success-path close failure within the existing catch boundary', () => {
    const result = runReadiness('close-fails-once');

    expect(result.status).toBe(0);
    expect(result.stdout.match(/✅ Database connection successful!/g)).toHaveLength(2);
    expect(events(result.trace, 'close').map(item => item.id)).toEqual([1, 1, 2]);
    expect(events(result.trace, 'construct')).toHaveLength(2);
  });

  test('exhausts retries without sleeping after the last failure', () => {
    const result = runReadiness('always-fail');

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('🎉 SQL Server container is ready!');
    expect(result.stderr).toContain(`❌ Failed to connect after ${maxAttempts} attempts`);
    expect(result.stderr).toContain(`💥 Last error: connect failure ${maxAttempts}`);
    expect(events(result.trace, 'construct')).toHaveLength(maxAttempts);
    expect(events(result.trace, 'connect')).toHaveLength(maxAttempts);
    expect(events(result.trace, 'close')).toHaveLength(maxAttempts);
    const delays = events(result.trace, 'sleep').map(item => item.delay);
    expect(delays).toHaveLength(maxAttempts);
    expect(delays[0]).toBe(initialDelay);
    expect(delays.at(-1)).toBe(maxRetryDelay);

    let expectedOutput = `${expectedPreamble()}...`;
    for (let attempt = 4; attempt <= maxAttempts; attempt++) {
      expectedOutput += `🔍 Attempt ${attempt}/${maxAttempts}: Testing database connection...\n`;
      expectedOutput += `⚠️ Connection attempt ${attempt}/${maxAttempts} failed: connect failure ${attempt}\n`;
      if (attempt < maxAttempts) {
        expectedOutput += `⏳ Waiting ${(delays[attempt] / 1000).toFixed(1)}s before next attempt...\n`;
      }
    }
    expect(cliOutput(result.stdout)).toBe(expectedOutput);
  });
});
