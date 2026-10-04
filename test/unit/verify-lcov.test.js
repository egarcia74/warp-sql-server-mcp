import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const script = new URL('../../scripts/ci/verify-lcov.mjs', import.meta.url);
const temporaryDirectories = [];

function verify(contents, args = []) {
  const directory = mkdtempSync(join(tmpdir(), 'wssm-lcov-'));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, 'coverage'));
  const report = join(directory, 'coverage', 'lcov.info');
  if (contents !== undefined) writeFileSync(report, contents);
  return spawnSync(process.execPath, [fileURLToPath(script), ...args], {
    cwd: directory,
    encoding: 'utf8'
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe('LCOV report verification', () => {
  it.each([
    ['missing report', undefined],
    ['empty report', ''],
    ['no source-file records', 'TN:\n'],
    ['incomplete source-file record', 'SF:lib/example.js\nDA:1,1\n'],
    [
      'malformed later record',
      'SF:lib/valid.js\nDA:1,1\nend_of_record\nSF:lib/broken.js\nDA:broken\nend_of_record\n'
    ],
    ['non-numeric coverage total', 'SF:lib/example.js\nDA:1,1\nLF:not-a-number\nend_of_record\n'],
    ['zero line number', 'SF:lib/example.js\nDA:0,1\nend_of_record\n'],
    ['leading junk', 'junk\nSF:lib/example.js\nDA:1,1\nend_of_record\n'],
    ['trailing junk', 'SF:lib/example.js\nDA:1,1\nend_of_record\njunk\n']
  ])('rejects %s', (_description, contents) => {
    const result = verify(contents);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LCOV report');
  });

  it('rejects a caller-supplied report path outside the fixed coverage location', () => {
    const externalDirectory = mkdtempSync(join(tmpdir(), 'wssm-lcov-external-'));
    temporaryDirectories.push(externalDirectory);
    const externalReport = join(externalDirectory, 'lcov.info');
    writeFileSync(externalReport, 'SF:lib/example.js\nDA:1,1\nend_of_record\n');
    const result = verify(undefined, [externalReport]);
    expect(result.status).toBe(1);
  });

  it.each([
    ['one source record', 'TN:\nSF:lib/example.js\nDA:1,1\nend_of_record\n'],
    [
      'multiple source records',
      'TN:\nSF:lib/one.js\nDA:1,0\nend_of_record\nTN:\nSF:lib/two.js\nDA:2,1\nend_of_record\n'
    ]
  ])('accepts %s', (_description, contents) => {
    const result = verify(contents);
    expect(result.status).toBe(0);
  });
});
