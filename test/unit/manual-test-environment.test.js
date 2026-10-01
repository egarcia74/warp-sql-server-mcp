import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const loaderUrl = new URL('../integration/manual/load-test-environment.js', import.meta.url).href;

function runLoader(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-manual-env-'));
  try {
    fs.mkdirSync(path.join(dir, 'test', 'docker'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'test', 'docker', '.env.docker'),
      'SQL_SERVER_PASSWORD=LocalDockerAa1!2026\n'
    );
    const probe = `
      import { loadTestEnvironment } from ${JSON.stringify(loaderUrl)};
      loadTestEnvironment();
      process.stdout.write(process.env.SQL_SERVER_PASSWORD === process.env.EXPECTED_PASSWORD ? 'matched' : 'mismatch');
    `;
    return spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: dir,
      env: {
        ...process.env,
        MCP_TESTING_MODE: mode,
        SQL_SERVER_PASSWORD: 'ParentPasswordAa1!2026',
        EXPECTED_PASSWORD: mode === 'docker' ? 'LocalDockerAa1!2026' : 'ParentPasswordAa1!2026'
      },
      encoding: 'utf8',
      timeout: 10000
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('manual integration test environment', () => {
  it('loads the generated credential before a Docker test creates its server', () => {
    const result = runLoader('docker');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('matched');
  });

  it('preserves external database credentials outside Docker mode', () => {
    const result = runLoader('external');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('matched');
  });
});
