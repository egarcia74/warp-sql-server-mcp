import { describe, it, expect, afterAll } from 'vitest';
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
function fakeGit({ changes = [], blobs = {}, tagError, worktree = [] } = {}) {
  return {
    worktreeChanges: () => worktree,
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

    it('treats a rename as tarball-affecting, naming both paths', () => {
      // Found by review: consulting the destination alone reports a move of a packed
      // file to an unpacked path as harmless, though the tarball loses the source.
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: [{ status: 'R', file: 'docs/notes.txt', from: 'lib/packed.js' }] }),
        packs('lib/packed.js')
      );
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual([
        { kind: 'foreign-packed-files', files: ['lib/packed.js -> docs/notes.txt'] }
      ]);
    });

    it('blocks an untracked packed file, invisible to a commit-level diff', () => {
      // npm packs the worktree, so a generated file matching the `files` globs reaches
      // the tarball while `git diff <tag> HEAD` shows nothing at all.
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: [], worktree: [{ status: '??', file: 'generated.js' }] }),
        packs('generated.js')
      );
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual([{ kind: 'foreign-packed-files', files: ['generated.js'] }]);
    });

    it('blocks an uncommitted edit to a packed file', () => {
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: [], worktree: [{ status: ' M', file: 'index.js' }] }),
        packs('index.js')
      );
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual([{ kind: 'foreign-packed-files', files: ['index.js'] }]);
    });

    it('blocks a worktree deletion, spelled with D in either status column', () => {
      for (const status of [' D', 'D ']) {
        const result = verifyPublishTree(
          '1.8.0',
          fakeGit({ changes: [], worktree: [{ status, file: 'lib/gone.js' }] }),
          packs('untouched.js')
        );
        expect(result.ok).toBe(false);
      }
    });

    it('reports an untracked file that npm would not pack', () => {
      const result = verifyPublishTree(
        '1.8.0',
        fakeGit({ changes: [], worktree: [{ status: '??', file: 'scratch.log' }] }),
        packs('index.js')
      );
      expect(result.ok).toBe(true);
      expect(result.notices).toEqual([{ kind: 'foreign-unpacked-files', files: ['scratch.log'] }]);
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

  describe('the version must look like a version before it reaches a git argument', () => {
    // Nothing here is attacker-controlled today, but the tag is built by interpolation
    // and these are the shapes that would reach `git` as something other than a rev.
    const rejected = ['', '1.8', 'v1.8.0', '--upload-pack=touch /tmp/x', '1.8.0 --exec', '../etc'];
    for (const version of rejected) {
      it(`rejects ${JSON.stringify(version)} without consulting git`, () => {
        let consulted = false;
        const git = {
          changes: () => {
            consulted = true;
            return [];
          },
          show: () => {
            consulted = true;
            return '{}';
          }
        };
        const result = verifyPublishTree(version, git, packs());
        expect(result.ok).toBe(false);
        expect(result.problems).toEqual([{ kind: 'malformed-version', version }]);
        expect(consulted).toBe(false);
      });
    }

    for (const version of ['1.8.0', '2.0.0-rc.1', '1.7.20+build.5']) {
      it(`accepts ${version}`, () => {
        const result = verifyPublishTree(version, fakeGit(), packs());
        expect(result.ok).toBe(true);
      });
    }
  });

  it('gives every problem and notice kind a description', () => {
    const kinds = [
      { kind: 'malformed-version', version: 'x' },
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
  const repos = [];

  /**
   * A throwaway repository with a committer identity set on the repo itself. `git init`
   * configures none, and `git tag -a` needs one - so a suite that passes identity only
   * to `git commit` works on a developer machine with a global identity and fails on a
   * bare CI runner. That is exactly how this was found.
   */
  function makeRepo(files) {
    const dir = mkdtempSync(join(tmpdir(), 'verify-publish-tree-'));
    repos.push(dir);
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    const write = (file, body) => writeFileSync(join(dir, file), body);
    for (const [file, body] of Object.entries(files)) write(file, body);
    const commit = message => {
      git('add', '-A');
      git('commit', '-q', '-m', message);
    };
    commit('initial');
    return { dir, git, write, commit };
  }

  afterAll(() => {
    for (const dir of repos) rmSync(dir, { recursive: true, force: true });
  });

  it('passes when only the version-bump commit follows the tag', () => {
    const { dir, git, write, commit } = makeRepo({
      'package.json': pkg('1.7.20'),
      'package-lock.json': lock('1.7.20'),
      'index.js': 'export const a = 1;\n'
    });
    // release.yml tags main as it stands, without committing the bump.
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    write('package.json', pkg('1.8.0'));
    write('package-lock.json', lock('1.8.0'));
    commit('chore(release): bump version to v1.8.0');

    const result = verifyPublishTree('1.8.0', gitReader(dir), packEverything);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('fails when a foreign commit landed inside the release window', () => {
    const { dir, git, write, commit } = makeRepo({
      'package.json': pkg('1.7.20'),
      'index.js': 'export const a = 1;\n'
    });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    write('package.json', pkg('1.8.0'));
    commit('chore(release): bump version to v1.8.0');
    write('index.js', 'export const a = 2;\n');
    commit('feat: something else merged during the release');

    const result = verifyPublishTree('1.8.0', gitReader(dir), packEverything);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([{ kind: 'foreign-packed-files', files: ['index.js'] }]);
  });

  it('blocks a deletion, which HEAD cannot classify against the packlist', () => {
    const { dir, git, commit } = makeRepo({
      'package.json': pkg('1.8.0'),
      'doomed.js': 'export const b = 1;\n'
    });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    unlinkSync(join(dir, 'doomed.js'));
    commit('chore: delete a file during the release');

    expect(gitReader(dir).changes('v1.8.0')).toContainEqual({ status: 'D', file: 'doomed.js' });
    const result = verifyPublishTree('1.8.0', gitReader(dir), packs('nothing-matching'));
    expect(result.problems[0].files).toContain('doomed.js');
  });

  it('blocks a pure rename, which git reports as R with both paths', () => {
    const { dir, git, commit } = makeRepo({
      'package.json': pkg('1.8.0'),
      'index.js': 'export const a = 1;\n'
    });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    git('mv', 'index.js', 'docs-notes.txt');
    commit('refactor: move a shipped file out of the package');

    expect(gitReader(dir).changes('v1.8.0')).toContainEqual({
      status: 'R',
      file: 'docs-notes.txt',
      from: 'index.js'
    });
    // The destination is unpacked, yet the source leaving the tarball must still block.
    const result = verifyPublishTree('1.8.0', gitReader(dir), packs('index.js'));
    expect(result.ok).toBe(false);
    expect(result.problems[0].files).toContain('index.js -> docs-notes.txt');
  });

  it('blocks a rename git reports as D+A, when a content change lowers similarity', () => {
    // Measured: `git mv` after a separate modifying commit is reported as D + A rather
    // than R, so the gate must be safe under both spellings. The D alone blocks.
    const { dir, git, write, commit } = makeRepo({
      'package.json': pkg('1.8.0'),
      'index.js': 'export const a = 1;\n'
    });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    write('index.js', 'export const a = 2;\n');
    commit('fix: change it');
    git('mv', 'index.js', 'moved.js');
    commit('refactor: then move it');

    const statuses = gitReader(dir).changes('v1.8.0');
    expect(statuses.map(c => c.status).sort()).toEqual(['A', 'D']);
    const result = verifyPublishTree('1.8.0', gitReader(dir), packs('nothing-matching'));
    expect(result.ok).toBe(false);
    expect(result.problems[0].files).toContain('index.js');
  });

  it('reads a non-ASCII pathname raw, not C-quoted', () => {
    // Reported by review, then measured: without `-z`, core.quotePath (on by default)
    // renders this path as `"docs/caf\303\251.md"`, which matches nothing in npm's
    // packlist - so a changed *packed* file was downgraded to an unpacked notice.
    const { dir, git, write, commit } = makeRepo({ 'package.json': pkg('1.8.0') });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    write('cafe\u0301.md', 'accented\n');
    commit('docs: add an accented filename');

    const changes = gitReader(dir).changes('v1.8.0');
    expect(changes).toHaveLength(1);
    expect(changes[0].file).not.toContain('\\');
    expect(changes[0].file.startsWith('"')).toBe(false);

    // Packed, so it must block rather than merely report.
    const result = verifyPublishTree('1.8.0', gitReader(dir), packs(changes[0].file));
    expect(result.ok).toBe(false);
    expect(result.problems[0].kind).toBe('foreign-packed-files');
  });

  it('reads a pathname containing a tab, which the tab-delimited format could not', () => {
    const { dir, git, write, commit } = makeRepo({ 'package.json': pkg('1.8.0') });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    write('od\td.md', 'x\n');
    commit('docs: a filename with a tab in it');

    const changes = gitReader(dir).changes('v1.8.0');
    expect(changes).toEqual([{ status: 'A', file: 'od\td.md' }]);
  });

  it('sees an untracked packed file that no commit contains', () => {
    const { dir, git, write } = makeRepo({ 'package.json': pkg('1.8.0') });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    write('generated.js', 'export const evil = 1;\n'); // never committed

    expect(gitReader(dir).changes('v1.8.0')).toEqual([]); // the commit diff sees nothing
    expect(gitReader(dir).worktreeChanges()).toEqual([{ status: '??', file: 'generated.js' }]);

    const result = verifyPublishTree('1.8.0', gitReader(dir), packs('generated.js'));
    expect(result.ok).toBe(false);
    expect(result.problems[0].files).toContain('generated.js');
  });

  it('fails on a missing tag rather than reporting clean', () => {
    const { dir, git } = makeRepo({ 'package.json': pkg('1.8.0') });
    git('tag', '-a', 'v1.8.0', '-m', 'Release v1.8.0');
    const result = verifyPublishTree('9.9.9', gitReader(dir), packEverything);
    expect(result.problems[0].kind).toBe('unresolvable-tag');
  });
});
