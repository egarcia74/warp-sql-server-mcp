import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { validateLcov } from '../../scripts/ci/sonar-lcov.mjs';
import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';
import { runGit } from '../helpers/git.js';

const tracked = new Set(['index.js', 'lib/config/server-config.js']);
const record = path => `SF:${path}\nDA:1,1\nBRDA:1,0,0,1\nend_of_record\n`;
const report = record('index.js') + record('lib/config/server-config.js');
const cli = resolve('scripts/ci/sonar-lcov.mjs');
let root;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('validateLcov', () => {
  it('accepts tracked LCOV and hashes the original report bytes', () => {
    expect(validateLcov(report, tracked)).toEqual({
      sourcePaths: ['index.js', 'lib/config/server-config.js'],
      sha256: createHash('sha256').update(report).digest('hex')
    });
    expect(validateLcov(report, tracked).sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([undefined, '', ' \n'])('rejects missing or empty input: %s', input => {
    expect(() => validateLcov(input, tracked)).toThrow(/empty|missing/i);
  });

  it.each(['SF', 'DA', 'BRDA', 'end_of_record garbage', 'unknown:value', ' '])(
    'rejects unknown or malformed nonempty line %s after a valid report',
    line => {
      expect(() => validateLcov(`${report}${line}\n`, tracked)).toThrow(/LCOV/i);
    }
  );

  it('rejects the malformed structural-token sequence from review', () => {
    expect(() => validateLcov(`${report}SF\nDA\nBRDA\nend_of_record garbage\n`, tracked)).toThrow();
  });

  it('rejects a malformed DA token inside an otherwise valid record', () => {
    expect(() => validateLcov(report.replace('DA:1,1', 'DA:1,1\nDA '), tracked)).toThrow();
  });

  it('accepts supported optional LCOV metadata and blank separator lines', () => {
    const metadata = [
      'FN:1,first',
      'FN:2,4,second',
      'FNDA:1,first',
      'FNDA:0,second',
      'FNF:2',
      'FNH:1',
      'LF:1',
      'LH:1',
      'BRF:1',
      'BRH:1'
    ].join('\n');
    const input = `TN:unit\n\n${report.replace('DA:1,1', `${metadata}\nDA:1,1`)}\n`;
    expect(validateLcov(input, tracked).sourcePaths).toEqual([
      'index.js',
      'lib/config/server-config.js'
    ]);
  });

  it.each(['FN:no,name', 'FNDA:no,name', 'FNF:no', 'LH:-1', 'TN'])(
    'rejects malformed optional field %s',
    line => {
      expect(() => validateLcov(report.replace('DA:1,1', `${line}\nDA:1,1`), tracked)).toThrow();
    }
  );

  it('rejects source metadata outside a source record', () => {
    expect(() => validateLcov(`${report}LF:1\n`, tracked)).toThrow();
  });

  it.each([
    ['traversal', '../index.js'],
    ['embedded traversal', 'lib/../index.js'],
    ['absolute', '/index.js'],
    ['Windows absolute', 'C:\\index.js'],
    ['backslash', 'lib\\config\\server-config.js'],
    ['control character', 'index.js\0'],
    ['untracked', 'lib/untracked.js']
  ])('rejects unsafe SF path: %s', (_name, path) => {
    expect(() => validateLcov(report + record(path), tracked)).toThrow(/path/i);
  });

  it('rejects a report missing index.js', () => {
    expect(() => validateLcov(record('lib/config/server-config.js'), tracked)).toThrow(/index/i);
  });

  it('rejects a report missing lib sources', () => {
    expect(() => validateLcov(record('index.js'), tracked)).toThrow(/lib/i);
  });

  it.each([
    ['source records', 'TN:unit\n'],
    ['line coverage', report.replaceAll('DA:1,1\n', '')],
    ['branch coverage', report.replaceAll('BRDA:1,0,0,1\n', '')],
    ['record terminator', report.replaceAll('end_of_record\n', '')],
    ['invalid line count', report.replace('DA:1,1', 'DA:1,no')],
    ['invalid branch count', report.replace('BRDA:1,0,0,1', 'BRDA:1,0,0,no')]
  ])('rejects missing or malformed %s', (_name, input) => {
    expect(() => validateLcov(input, tracked)).toThrow();
  });
});

describe('LCOV CLI', () => {
  function fixture() {
    root = mkdtempSync(join(tmpdir(), 'sonar-lcov-'));
    mkdirSync(join(root, 'lib/config'), { recursive: true });
    writeFileSync(join(root, 'index.js'), '// fixture\n');
    writeFileSync(join(root, 'lib/config/server-config.js'), '// fixture\n');
    runGit(['init', '--quiet'], { cwd: root });
    runGit(['add', 'index.js', 'lib'], { cwd: root });
    writeFileSync(join(root, 'lcov.info'), report);
  }

  function validate(path = 'lcov.info') {
    return spawnSync(process.execPath, [cli, 'validate', path], {
      cwd: root,
      env: scrubbedEnv(),
      encoding: 'utf8'
    });
  }

  it('validates tracked regular files in a real checkout', () => {
    fixture();
    const result = validate();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).sourcePaths).toEqual([
      'index.js',
      'lib/config/server-config.js'
    ]);
  });

  it('exits nonzero for a missing report', () => {
    fixture();
    const result = validate('missing.info');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing|ENOENT/i);
  });

  it('rejects a tracked symlink even when its target is inside the checkout', () => {
    fixture();
    symlinkSync('config/server-config.js', join(root, 'lib/link.js'));
    runGit(['add', 'lib/link.js'], { cwd: root });
    writeFileSync(join(root, 'lcov.info'), report + record('lib/link.js'));
    const result = validate();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/path|symlink/i);
  });

  it('rejects a tracked path whose parent directory is a symlink', () => {
    fixture();
    symlinkSync('config', join(root, 'lib/link'));
    // The index may still describe a regular file after a working-tree directory is replaced.
    runGit(
      [
        'update-index',
        '--add',
        '--cacheinfo',
        '100644',
        runGit(['hash-object', 'index.js'], { cwd: root }).trim(),
        'lib/link/server-config.js'
      ],
      { cwd: root }
    );
    writeFileSync(join(root, 'lcov.info'), report + record('lib/link/server-config.js'));
    const result = validate();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/path|symlink/i);
  });

  it('rejects a tracked source absent from the working tree', () => {
    fixture();
    rmSync(join(root, 'index.js'));
    expect(validate().status).not.toBe(0);
  });

  it('rejects unsupported CLI arguments', () => {
    fixture();
    const result = spawnSync(process.execPath, [cli, 'scan', 'lcov.info'], {
      cwd: root,
      env: scrubbedEnv(),
      encoding: 'utf8'
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });
});
