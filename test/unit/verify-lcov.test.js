import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const script = new URL('../../scripts/ci/verify-lcov.mjs', import.meta.url);
const absoluteCli = fileURLToPath(new URL('../../cli.js', import.meta.url));
const temporaryDirectories = [];
const coveredCli = 'SF:cli.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,0\nLF:4\nLH:3\nend_of_record\n';

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
  it('keeps the developer coverage command open to Vitest options while CI verifies the report', () => {
    const { scripts } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
    expect(scripts['test:coverage']).toBe('vitest run --coverage');
    expect(scripts['test:coverage:verified']).toBe(
      'npm run test:coverage && node scripts/ci/verify-lcov.mjs'
    );
    expect(scripts.ci).toContain('npm run test:coverage:verified');
  });

  it.each([
    ['missing report', undefined],
    ['empty report', ''],
    ['no source-file records', 'TN:\n'],
    ['incomplete source-file record', `${coveredCli}SF:lib/example.js\nDA:1,1\n`],
    [
      'malformed later record',
      `${coveredCli}SF:lib/valid.js\nDA:1,1\nend_of_record\nSF:lib/broken.js\nDA:broken\nend_of_record\n`
    ],
    [
      'non-numeric coverage total',
      `${coveredCli}SF:lib/example.js\nDA:1,1\nLF:not-a-number\nend_of_record\n`
    ],
    ['zero line number', `${coveredCli}SF:lib/example.js\nDA:0,1\nend_of_record\n`],
    ['leading junk', 'junk\nSF:lib/example.js\nDA:1,1\nend_of_record\n'],
    ['trailing junk', `${coveredCli}SF:lib/example.js\nDA:1,1\nend_of_record\njunk\n`],
    ['only empty source files', 'SF:lib/empty.js\nLF:0\nend_of_record\n']
  ])('rejects %s', (_description, contents) => {
    const result = verify(contents);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LCOV report');
  });

  it('rejects a caller-supplied report path outside the fixed coverage location', () => {
    const externalDirectory = mkdtempSync(join(tmpdir(), 'wssm-lcov-external-'));
    temporaryDirectories.push(externalDirectory);
    const externalReport = join(externalDirectory, 'lcov.info');
    writeFileSync(externalReport, coveredCli);
    const result = verify(undefined, [externalReport]);
    expect(result.status).toBe(1);
  });

  it.each([
    ['one source record', `TN:\n${coveredCli}`],
    [
      'multiple source records',
      `TN:\nSF:lib/one.js\nDA:1,0\nend_of_record\nTN:\nSF:lib/two.js\nDA:2,1\nend_of_record\n${coveredCli}`
    ],
    [
      'an empty source file alongside covered files',
      `SF:lib/one.js\nDA:1,1\nend_of_record\nSF:lib/empty.js\nLF:0\nend_of_record\n${coveredCli}`
    ]
  ])('accepts %s', (_description, contents) => {
    const result = verify(contents);
    expect(result.status).toBe(0);
  });

  it.each([
    ['missing root CLI', 'SF:lib/example.js\nDA:1,1\nend_of_record\n'],
    ['nested CLI misidentified as root', coveredCli.replace('SF:cli.js', 'SF:lib/cli.js')],
    ['CLI with LF=0', coveredCli.replace('LF:4', 'LF:0')],
    [
      'CLI with zero hits',
      coveredCli
        .replaceAll('DA:1,1', 'DA:1,0')
        .replaceAll('DA:2,1', 'DA:2,0')
        .replaceAll('DA:3,1', 'DA:3,0')
        .replace('LH:3', 'LH:0')
    ],
    ['CLI with inconsistent line count', coveredCli.replace('LF:4', 'LF:5')],
    ['CLI with inconsistent hit count', coveredCli.replace('LH:3', 'LH:2')],
    ['CLI with duplicate line data', coveredCli.replace('DA:4,0', 'DA:3,0')],
    ['CLI below 70 percent', coveredCli.replace('DA:3,1', 'DA:3,0').replace('LH:3', 'LH:2')],
    [
      'duplicate CLI records',
      `${coveredCli}${coveredCli.replace('SF:cli.js', `SF:${absoluteCli}`)}`
    ]
  ])('rejects %s', (_description, contents) => {
    const result = verify(contents);
    expect(result.status).toBe(1);
  });

  it('accepts exactly 70 percent CLI line coverage from an absolute source path', () => {
    const record = `SF:${absoluteCli}\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nDA:5,1\nDA:6,1\nDA:7,1\nDA:8,0\nDA:9,0\nDA:10,0\nLF:10\nLH:7\nend_of_record\n`;
    expect(verify(record).status).toBe(0);
  });
});
