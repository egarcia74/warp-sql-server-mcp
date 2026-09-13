import { describe, it, expect } from 'vitest';
import { join, resolve, sep } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  filesVitestWouldRun,
  resolveTestFile,
  resolveVitest
} from '../../scripts/ci/run-one-test.mjs';

// The point of scripts/ci/run-one-test.mjs is that the Claude review Action can
// be granted `Bash(npm run test:one:*)` without that being arbitrary code
// execution. vitest executes whatever --config, --setupFiles and --globalSetup
// name, so these tests pin the refusals, not just the happy path.
describe('resolveTestFile (guard for npm run test:one, #1213)', () => {
  const root = resolve(process.cwd(), 'test');
  const opts = { root, exists: () => true, isFile: () => true, realpath: p => p };

  it('accepts an existing test file inside test/', () => {
    const result = resolveTestFile(['test/unit/example.test.js'], opts);
    expect(result.ok).toBe(true);
    expect(result.file).toBe(resolve(root, 'unit/example.test.js'));
  });

  it.each([
    ['--globalSetup=/tmp/evil.mjs'],
    ['--setupFiles=/tmp/evil.mjs'],
    ['--config=/tmp/evil.config.js'],
    ['--reporter=/tmp/evil.mjs'],
    ['-c']
  ])('refuses the option-shaped argument %s', argument => {
    const result = resolveTestFile([argument], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/option-shaped/);
  });

  it('refuses a flag even when a legitimate file is also given', () => {
    const result = resolveTestFile(
      ['test/unit/example.test.js', '--globalSetup=/tmp/evil.mjs'],
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exactly one test file/);
  });

  it('refuses zero arguments', () => {
    expect(resolveTestFile([], opts)).toMatchObject({ ok: false });
  });

  it.each([
    ['test/../../../etc/passwd.test.js'],
    ['../outside/thing.test.js'],
    ['/etc/passwd.test.js']
  ])('refuses %s, which resolves outside test/', argument => {
    const result = resolveTestFile([argument], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/outside/);
  });

  it('refuses a file that is not a .test.js', () => {
    const result = resolveTestFile(['test/unit/helper.js'], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not a test file/);
  });

  it('refuses a null byte', () => {
    const result = resolveTestFile(['test/unit/a\0b.test.js'], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/null byte/);
  });

  it('refuses a path that passes every shape check but does not exist', () => {
    const result = resolveTestFile(['test/unit/missing.test.js'], { ...opts, exists: () => false });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no such test file/);
  });

  it('refuses a directory that is named like a test file', () => {
    const result = resolveTestFile(['test/unit/dir.test.js'], { ...opts, isFile: () => false });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no such test file/);
  });

  it('refuses a file inside test/ that is a symlink pointing outside it', () => {
    // Lexically fine, canonically not: exactly the gap a lexical-only check misses.
    const result = resolveTestFile(['test/unit/link.test.js'], {
      ...opts,
      realpath: p => (p === root ? root : '/tmp/elsewhere/link.test.js')
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/resolves outside/);
  });

  it('accepts a file whose canonical path is still inside test/', () => {
    const result = resolveTestFile(['test/unit/real.test.js'], {
      ...opts,
      realpath: p => p
    });
    expect(result.ok).toBe(true);
    expect(result.file).toBe(resolve(root, 'unit/real.test.js'));
  });

  it('tolerates a symlinked checkout by canonicalising the root too', () => {
    // /var -> /private/var on macOS: the root moves, so containment must be
    // judged against the canonical root, not the configured one.
    const result = resolveTestFile(['test/unit/real.test.js'], {
      ...opts,
      realpath: p => p.replace('/var/', '/private/var/')
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a path realpath cannot resolve', () => {
    const result = resolveTestFile(['test/unit/broken.test.js'], {
      ...opts,
      realpath: () => {
        throw new Error('ELOOP');
      }
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cannot resolve/);
  });

  it('containment is checked on the resolved path, not the raw string', () => {
    const sneaky = `unit${sep}..${sep}..${sep}package.json.test.js`;
    const result = resolveTestFile([`test/${sneaky}`], opts);
    expect(result.ok).toBe(false);
  });
});

// Codex on #1231: createRequire anchors lookup at a directory but does not confine it
// there, so with the dependency absent or NODE_PATH set it can reach an ancestor or
// global install - and that package's entry point would then run with the job's
// credentials.
describe('resolveVitest confines the runner to this repository', () => {
  const root = process.cwd();

  it('accepts the vitest installed in this repo', () => {
    expect(resolveVitest().endsWith(join('node_modules', 'vitest', 'vitest.mjs'))).toBe(true);
  });

  it('refuses a node_modules that is itself a symlink out of the repository', () => {
    // Canonicalising node_modules would otherwise move the trusted boundary with it.
    const repo = mkdtempSync(join(tmpdir(), 'rot-repo-'));
    const outside = mkdtempSync(join(tmpdir(), 'rot-out-'));
    mkdirSync(join(outside, 'node_modules', 'vitest'), { recursive: true });
    writeFileSync(join(outside, 'node_modules', 'vitest', 'package.json'), '{}');
    writeFileSync(join(outside, 'node_modules', 'vitest', 'vitest.mjs'), '');
    symlinkSync(join(outside, 'node_modules'), join(repo, 'node_modules'));

    try {
      expect(() =>
        resolveVitest({
          root: repo,
          require: { resolve: () => join(repo, 'node_modules', 'vitest', 'package.json') }
        })
      ).toThrow(/refusing a node_modules outside/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a vitest resolved outside the repo node_modules', () => {
    expect(() =>
      resolveVitest({
        root,
        require: { resolve: () => '/somewhere/else/vitest/package.json' }
      })
    ).toThrow(/cannot resolve vitest|refusing a vitest outside/);
  });

  it('refuses rather than falling back when resolution throws', () => {
    expect(() =>
      resolveVitest({
        root,
        require: {
          resolve: () => {
            throw new Error('MODULE_NOT_FOUND');
          }
        }
      })
    ).toThrow();
  });
});

// Codex on #1231: vitest's filter is not a plain prefix match - it falls through to a
// case-insensitive relative-path `includes`, and its traversal follows directory symlinks.
// A hand-written prefix check missed both (a nested test/nested/test/unit/a.test.js was run
// alongside the request while the check saw no ambiguity), so the wrapper asks vitest.
describe('filesVitestWouldRun asks vitest rather than modelling its filter', () => {
  const vitest = '/r/node_modules/vitest/vitest.mjs';

  it('resolves the relative paths vitest prints against the working directory', () => {
    const run = () => 'test/unit/a.test.js\ntest/unit/b.test.js\n';
    expect(filesVitestWouldRun(vitest, '/r/test/unit/a.test.js', { run, cwd: '/r' })).toEqual([
      '/r/test/unit/a.test.js',
      '/r/test/unit/b.test.js'
    ]);
  });

  it('ignores blank lines and surrounding whitespace', () => {
    const run = () => '\n  test/unit/a.test.js  \n\n';
    expect(filesVitestWouldRun(vitest, '/r/test/unit/a.test.js', { run, cwd: '/r' })).toEqual([
      '/r/test/unit/a.test.js'
    ]);
  });

  it('returns nothing when vitest selects nothing', () => {
    expect(
      filesVitestWouldRun(vitest, '/r/test/unit/a.test.js', { run: () => '', cwd: '/r' })
    ).toEqual([]);
  });

  it('passes list --filesOnly and the file, and nothing else', () => {
    const seen = [];
    const run = (bin, args) => {
      seen.push([bin, args]);
      return 'test/unit/a.test.js\n';
    };
    filesVitestWouldRun(vitest, '/r/test/unit/a.test.js', { run, cwd: '/r' });
    expect(seen[0][1]).toEqual([vitest, 'list', '--filesOnly', '/r/test/unit/a.test.js']);
  });

  it('agrees with the real vitest on this repository, selecting exactly this file', () => {
    const file = resolve(process.cwd(), 'test/unit/run-one-test.test.js');
    expect(filesVitestWouldRun(resolveVitest(), file)).toEqual([file]);
  });
});
