import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const script = new URL('../../scripts/ci/verify-lcov.mjs', import.meta.url);
const temporaryDirectories = [];

function verify(contents) {
  const directory = mkdtempSync(join(tmpdir(), 'wssm-lcov-'));
  temporaryDirectories.push(directory);
  const report = join(directory, 'lcov.info');
  if (contents !== undefined) writeFileSync(report, contents);
  return spawnSync(process.execPath, [fileURLToPath(script), report], { encoding: 'utf8' });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe('LCOV report verification', () => {
  it('rejects a missing report', () => {
    const result = verify();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LCOV report');
  });

  it('rejects an empty report', () => {
    const result = verify('');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LCOV report');
  });

  it('rejects a report with no source-file coverage records', () => {
    const result = verify('TN:\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LCOV report');
  });

  it('rejects an incomplete source-file record', () => {
    const result = verify('SF:lib/example.js\nDA:1,1\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LCOV report');
  });

  it('accepts a report with a source-file coverage record', () => {
    const result = verify('TN:\nSF:lib/example.js\nDA:1,1\nend_of_record\n');
    expect(result.status).toBe(0);
  });
});
