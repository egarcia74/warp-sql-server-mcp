import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  verifyPublishTree,
  describeProblem,
  gitReader
} from '../../scripts/ci/verify-publish-tree.mjs';

/** A git reader backed by plain objects, so the logic is testable without a repository. */
function fakeGit({ changes = [], blobs = {}, tagError } = {}) {
  return {
    changes: () => {
      if (tagError) throw new Error(tagError);
      // Accept a bare filename as shorthand for a modification.
      return changes.map(entry =>
        typeof entry === 'string' ? { status: 'M', file: entry } : entry
      );
    },
    show: (rev, file) => {
      const key = `${rev}:${file}`;
      if (!(key in blobs)) throw new Error(`no such blob ${key}`);
      return blobs[key];
    }
  };
}

/** The tarball contents npm would report. Anything absent is unpacked. */
const packs =
  (...files) =>
  () =>
    new Set(files);
const packEverything = () => ({ has: () => true });

const pkg = (version, extra = {}) =>
  JSON.stringify({ name: '@egarcia74/warp-sql-server-mcp', version, ...extra });

const lock = (version, extra = {}) =>
  JSON.stringify({
    name: '@egarcia74/warp-sql-server-mcp',
    version,
    lockfileVersion: 3,
    packages: { '': { name: '@egarcia74/warp-sql-server-mcp', version }, ...extra }
  });

const bumpBlobs = (version, from = '1.7.20') => ({
  [`v${version}:package.json`]: pkg(from),
  ['HEAD:package.json']: pkg(version),
  [`v${version}:package-lock.json`]: lock(from),
  ['HEAD:package-lock.json']: lock(version)
});

describe('verifyPublishTree', () => {
  it('accepts the ordinary release: only the two bump files, only the version changed', () => {
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({ changes: ['package.json', 'package-lock.json'], blobs: bumpBlobs('1.8.0') }),
      packs('package.json', 'index.js')
    );
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.notices).toEqual([]);
  });

  it('accepts a tree identical to the tag, which is what a re-run sees', () => {
    const result = verifyPublishTree('1.8.0', fakeGit(), packs());
    expect(result.ok).toBe(true);
  });

  it('refuses when a packed file landed between the tag and the bump', () => {
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({
        changes: ['index.js', 'package.json', 'package-lock.json', 'lib/tools/registry.js'],
        blobs: bumpBlobs('1.8.0')
      }),
      packs('index.js', 'lib/tools/registry.js', 'package.json')
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      { kind: 'foreign-packed-files', files: ['index.js', 'lib/tools/registry.js'] }
    ]);
  });

  it('refuses a change to package.json beyond the version - the case #1189 describes', () => {
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({
        changes: ['package.json'],
        blobs: {
          'v1.8.0:package.json': pkg('1.7.20', { files: ['index.js'] }),
          'HEAD:package.json': pkg('1.8.0', { files: ['index.js', 'docs/**/*.md'] })
        }
      }),
      packs('package.json')
    );
    expect(result.problems).toEqual([{ kind: 'unexpected-change', file: 'package.json' }]);
  });

  it('refuses a lockfile-only dependency bump, which a diff-line check would pass', () => {
    // Every changed line here is spelled `"version": ...`, so a check that matched diff
    // lines against /"version":/ would wave this through. Reconstruction catches it.
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({
        changes: ['package-lock.json'],
        blobs: {
          'v1.8.0:package-lock.json': lock('1.7.20', {
            'node_modules/tedious': { version: '18.0.0' }
          }),
          'HEAD:package-lock.json': lock('1.8.0', {
            'node_modules/tedious': { version: '19.0.0' }
          })
        }
      }),
      packs()
    );
    expect(result.problems).toEqual([{ kind: 'unexpected-change', file: 'package-lock.json' }]);
  });

  it('refuses when the published version is not the one the tree declares', () => {
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({
        changes: ['package.json'],
        blobs: { 'v1.8.0:package.json': pkg('1.7.20'), 'HEAD:package.json': pkg('1.7.21') }
      }),
      packs()
    );
    expect(result.problems).toEqual([
      { kind: 'wrong-version', file: 'package.json', expected: '1.8.0', actual: '1.7.21' }
    ]);
  });

  it('refuses rather than skipping when the tag cannot be resolved', () => {
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({ tagError: "unknown revision 'v1.8.0'" }),
      packs()
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0].kind).toBe('unresolvable-tag');
  });

  it('refuses when a bump file cannot be parsed at both revisions', () => {
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({ changes: ['package.json'], blobs: { 'HEAD:package.json': pkg('1.8.0') } }),
      packs()
    );
    expect(result.problems[0].kind).toBe('unreadable');
  });

  it('tolerates key re-ordering, which cannot change what npm installs', () => {
    const result = verifyPublishTree(
      '1.8.0',
      fakeGit({
        changes: ['package.json'],
        blobs: {
          'v1.8.0:package.json': JSON.stringify({ name: 'x', version: '1.7.20', private: false }),
          'HEAD:package.json': JSON.stringify({ private: false, version: '1.8.0', name: 'x' })
        }
      }),
      packs()
    );
    expect(result.ok).toBe(true);
  });

  describe('the two tiers: only what reaches the tarball may block a publish', () => {
    it('reports, but does not fail, when the changed file is not packed', () => {
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: ['.markdownlint.json', '.github/workflows/ci.yml'] }),
        packs('index.js')
      );
      expect(result.ok).toBe(true);
      expect(result.notices).toEqual([
        {
          kind: 'foreign-unpacked-files',
          files: ['.markdownlint.json', '.github/workflows/ci.yml']
        }
      ]);
    });

    it('separates packed from unpacked in one run', () => {
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: ['index.js', '.markdownlint.json'] }),
        packs('index.js')
      );
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual([{ kind: 'foreign-packed-files', files: ['index.js'] }]);
      expect(result.notices).toEqual([
        { kind: 'foreign-unpacked-files', files: ['.markdownlint.json'] }
      ]);
    });

    it('treats a deletion as tarball-affecting, since HEAD cannot say if it was packed', () => {
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: [{ status: 'D', file: 'lib/gone.js' }] }),
        packs('index.js')
      );
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual([{ kind: 'foreign-packed-files', files: ['lib/gone.js'] }]);
    });

    it('fails closed when the packlist cannot be read at all', () => {
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: ['.markdownlint.json'] }),
        () => {
          throw new Error('npm unavailable');
        }
      );
      expect(result.ok).toBe(false);
      expect(result.problems.map(p => p.kind)).toEqual([
        'unknown-packlist',
        'foreign-packed-files'
      ]);
    });
  });

  describe('the three releases that diverged before this check existed', () => {
    // Measured on the real repository: a flat "nothing but the bump files" rule would
    // have blocked all three of these legitimate releases.
    it('v1.7.20 and v1.7.19 differed in CHANGELOG.md alone - must still publish', () => {
      const result = verifyPublishTree(
        '1.7.20',
        fakeGit({
          changes: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
          blobs: bumpBlobs('1.7.20', '1.7.19')
        }),
        packs('CHANGELOG.md', 'package.json')
      );
      expect(result.ok).toBe(true);
      expect(result.notices).toEqual([]);
    });

    it('v1.7.16 also touched .markdownlint.json - publishes, with that reported', () => {
      const result = verifyPublishTree(
        '1.7.16',
        fakeGit({
          changes: ['.markdownlint.json', 'CHANGELOG.md', 'package.json'],
          blobs: {
            'v1.7.16:package.json': pkg('1.7.15'),
            'HEAD:package.json': pkg('1.7.16')
          }
        }),
        packs('CHANGELOG.md', 'package.json')
      );
      expect(result.ok).toBe(true);
      expect(result.notices).toEqual([
        { kind: 'foreign-unpacked-files', files: ['.markdownlint.json'] }
      ]);
    });
  });

  it('gives every problem and notice kind a description', () => {
    const kinds = [
      { kind: 'unresolvable-tag', tag: 'v1', message: 'm' },
      { kind: 'foreign-packed-files', files: ['a'] },
      { kind: 'foreign-unpacked-files', files: ['a'] },
      { kind: 'unknown-packlist', message: 'm' },
      { kind: 'unreadable', file: 'a', message: 'm' },
      { kind: 'wrong-version', file: 'a', expected: '1', actual: '2' },
      { kind: 'unexpected-change', file: 'a' }
    ];
    for (const problem of kinds) {
      expect(describeProblem(problem)).not.toMatch(/unrecognised/);
      expect(describeProblem(problem).length).toBeGreaterThan(0);
    }
  });
});

describe('against a real repository, following the actual release sequence', () => {
  let repo;
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const commit = message => {
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message);
  };
  const write = (file, body) => writeFileSync(join(repo, file), body);

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'verify-publish-tree-'));
    git('init', '-q', '-b', 'main');
    write('package.json', pkg('1.7.20'));
    write('package-lock.json', lock('1.7.20'));
    write('index.js', 'export const a = 1;\n');
    write('doomed.js', 'export const b = 1;\n');
    commit('initial');
    // release.yml tags main as it stands, without committing the bump.
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('passes when only the version-bump commit follows the tag', () => {
    write('package.json', pkg('1.8.0'));
    write('package-lock.json', lock('1.8.0'));
    commit('chore(release): bump version to v1.8.0');

    const result = verifyPublishTree('1.8.0', gitReader(repo), packEverything);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('fails when a foreign commit landed inside the release window', () => {
    write('index.js', 'export const a = 2;\n');
    commit('feat: something else merged during the release');

    const result = verifyPublishTree('1.8.0', gitReader(repo), packEverything);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([{ kind: 'foreign-packed-files', files: ['index.js'] }]);
  });

  it('reads a real deletion as a change, with git reporting status D', () => {
    unlinkSync(join(repo, 'doomed.js'));
    commit('chore: delete a file during the release');

    const changes = gitReader(repo).changes('v1.8.0');
    expect(changes).toContainEqual({ status: 'D', file: 'doomed.js' });

    // Unpacked as far as HEAD is concerned, yet still blocking, because a deleted path
    // cannot be looked up in the packlist.
    const result = verifyPublishTree('1.8.0', gitReader(repo), packs('nothing-matching'));
    expect(result.problems[0].files).toContain('doomed.js');
  });

  it('fails on a missing tag rather than reporting clean', () => {
    const result = verifyPublishTree('9.9.9', gitReader(repo), packEverything);
    expect(result.problems[0].kind).toBe('unresolvable-tag');
  });
});
