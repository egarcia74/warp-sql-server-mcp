/**
 * Tests for the #1235 path gate: does a release window change anything npm packs?
 *
 * Two layers, matching the split in the code:
 *   - `shipsToConsumers` is pure, so every case here is a plain object. No git, no npm, no repo.
 *   - `windowShips` does the I/O, so its readers are injected as fakes. The `--from-git` path in
 *     classify-release-commits.mjs was previously untested; this is the part that wires the rule to
 *     git and npm, and it is where the two-catch polarity lives.
 *
 * A gate that cannot be shown to REFUSE is the #1265 failure mode, so the refusing cases here are
 * the point, not the passing ones.
 */

import { describe, expect, it } from 'vitest';

import {
  removesSomething,
  sameContent,
  shipsToConsumers,
  withVersion
} from '../../scripts/lib/packed-window.mjs';
import { windowShips } from '../../scripts/ci/classify-release-commits.mjs';

/** The packlist is a flat set of exact paths - npm's own, never a glob reimplementation. */
const packs = (...files) => new Set(files);

const change = (status, file, from) => (from ? { status, file, from } : { status, file });

const manifest = (version, rest = {}) => ({ name: 'pkg', version, ...rest });

describe('shipsToConsumers', () => {
  it('ships when a packed file changed', () => {
    const result = shipsToConsumers({
      changes: [change('M', 'lib/utils/csv.js')],
      packed: packs('lib/utils/csv.js'),
      manifestBefore: manifest('1.0.0'),
      manifestAfter: manifest('1.0.0')
    });

    expect(result.ships).toBe(true);
    expect(result.reason).toBe('ships');
    expect(result.shipped).toEqual(['lib/utils/csv.js']);
  });

  it('refuses when every change is unpacked', () => {
    const result = shipsToConsumers({
      changes: [
        change('M', '.github/workflows/release.yml'),
        change('M', 'WARP.md'),
        change('M', 'test/unit/logger.test.js')
      ],
      packed: packs('lib/index.js', 'package.json'),
      manifestBefore: manifest('1.7.6'),
      manifestAfter: manifest('1.7.6')
    });

    expect(result.ships).toBe(false);
    expect(result.reason).toBe('nothing-packed');
    expect(result.unshipped).toHaveLength(3);
  });

  it('does not count CHANGELOG.md, which the release process writes itself', () => {
    const result = shipsToConsumers({
      changes: [change('M', 'CHANGELOG.md')],
      packed: packs('CHANGELOG.md', 'package.json'),
      manifestBefore: manifest('1.0.0'),
      manifestAfter: manifest('1.0.0')
    });

    expect(result.ships).toBe(false);
  });

  // The load-bearing case. release.yml tags BEFORE the bump PR merges, so the previous release's
  // version bump lands inside the next window. Counting it would make the gate pass on every
  // post-release window automatically - vacuous exactly where it is needed.
  it('does not count a version-only package.json change', () => {
    const result = shipsToConsumers({
      changes: [change('M', 'package.json'), change('M', '.github/workflows/release.yml')],
      packed: packs('package.json'),
      manifestBefore: manifest('1.7.6', { dependencies: { mssql: '^11.0.0' } }),
      manifestAfter: manifest('1.7.9', { dependencies: { mssql: '^11.0.0' } })
    });

    expect(result.ships).toBe(false);
    expect(result.reason).toBe('nothing-packed');
  });

  it('does count package.json when a dependency changed alongside the version', () => {
    const result = shipsToConsumers({
      changes: [change('M', 'package.json')],
      packed: packs('package.json'),
      manifestBefore: manifest('1.7.6', { dependencies: { mssql: '^11.0.0' } }),
      manifestAfter: manifest('1.7.9', { dependencies: { mssql: '^11.1.0' } })
    });

    expect(result.ships).toBe(true);
  });

  // npm-packlist forcibly EXCLUDES lockfiles, so the tarball is byte-identical and consumers
  // resolve from unchanged package.json ranges. Counter-intuitive for a security bump, which is
  // why the refusal message names it.
  it('refuses a lock-only dependency bump', () => {
    const result = shipsToConsumers({
      changes: [change('M', 'package-lock.json')],
      packed: packs('package.json', 'lib/index.js'),
      manifestBefore: manifest('1.7.6'),
      manifestAfter: manifest('1.7.6')
    });

    expect(result.ships).toBe(false);
  });

  // Codex, round 2 on #1273. The exemptions are for a file being EDITED; filtering before
  // shipsChange would drop a DELETION before its handling ever ran, so removing a packed file
  // would report `nothing-packed` while the tarball genuinely changed. Same shape as the
  // packlist-control gap.
  it('ships when CHANGELOG.md is deleted, though a modification to it is exempt', () => {
    const packed = packs('CHANGELOG.md', 'package.json');
    const m = manifest('1.0.0');

    expect(
      shipsToConsumers({
        changes: [change('M', 'CHANGELOG.md')],
        packed,
        manifestBefore: m,
        manifestAfter: m
      }).ships
    ).toBe(false);

    expect(
      shipsToConsumers({
        changes: [change('D', 'CHANGELOG.md')],
        packed,
        manifestBefore: m,
        manifestAfter: m
      }).ships
    ).toBe(true);
  });

  it('ships when package.json is deleted, though a version-only edit is exempt', () => {
    const result = shipsToConsumers({
      changes: [change('D', 'package.json')],
      packed: packs('package.json'),
      manifestBefore: manifest('1.7.6'),
      manifestAfter: manifest('1.7.9')
    });

    expect(result.ships).toBe(true);
  });

  // A deleted path cannot be looked up in a packlist built from the worktree, so whether it used
  // to be packed is unknowable and is assumed. Otherwise removing a shipped file would read as
  // "nothing changed".
  it('ships when a packed file is deleted, even though it is gone from the packlist', () => {
    const result = shipsToConsumers({
      changes: [change('D', 'lib/removed.js')],
      packed: packs('package.json'),
      manifestBefore: manifest('1.0.0'),
      manifestAfter: manifest('1.0.0')
    });

    expect(result.ships).toBe(true);
  });

  it('ships when a rename moves a packed file out of the package', () => {
    const result = shipsToConsumers({
      changes: [change('R100', 'docs/notes.txt', 'lib/packed.js')],
      packed: packs('package.json'),
      manifestBefore: manifest('1.0.0'),
      manifestAfter: manifest('1.0.0')
    });

    expect(result.ships).toBe(true);
    expect(result.shipped).toEqual(['lib/packed.js -> docs/notes.txt']);
  });

  // Codex caught this one on #1273 and no amount of desk review had: a nested .gitignore or
  // .npmignore decides what npm packs, so editing one changes the tarball while its own path is
  // never in it. Intersecting only changed paths with the final packlist misses it entirely.
  it('ships when a file that CONTROLS the packlist changed, though it is never packed itself', () => {
    for (const file of ['.gitignore', '.npmignore', 'docs/.npmignore', 'lib/nested/.gitignore']) {
      const result = shipsToConsumers({
        changes: [change('M', file)],
        packed: packs('package.json'),
        manifestBefore: manifest('1.0.0'),
        manifestAfter: manifest('1.0.0')
      });

      expect(result.ships, `${file} controls the packlist`).toBe(true);
    }
  });

  it('does not treat an ordinary unpacked file as packlist control', () => {
    const result = shipsToConsumers({
      changes: [change('M', 'docs-internal/gitignore-notes.md')],
      packed: packs('package.json'),
      manifestBefore: manifest('1.0.0'),
      manifestAfter: manifest('1.0.0')
    });

    expect(result.ships).toBe(false);
  });

  // Opposite polarity to verify-publish-tree.mjs on purpose: a wrongly blocked release is
  // re-dispatched, a wrongly permitted publish cannot be undone.
  it('fails OPEN when the packlist could not be derived', () => {
    const result = shipsToConsumers({
      changes: [change('M', '.github/workflows/release.yml')],
      packed: null,
      manifestBefore: manifest('1.0.0'),
      manifestAfter: manifest('1.0.0')
    });

    expect(result.ships).toBe(true);
    expect(result.reason).toBe('unknown-packlist');
  });

  it('treats a missing manifest as not-version-only rather than throwing', () => {
    const result = shipsToConsumers({
      changes: [change('M', 'package.json')],
      packed: packs('package.json'),
      manifestBefore: null,
      manifestAfter: null
    });

    expect(result.ships).toBe(true);
  });
});

describe('the helpers shared with the publish gate', () => {
  it('removesSomething handles both the one-letter and porcelain status shapes', () => {
    expect(removesSomething('D')).toBe(true);
    expect(removesSomething('R100')).toBe(true);
    expect(removesSomething(' D')).toBe(true);
    expect(removesSomething('M')).toBe(false);
    expect(removesSomething('??')).toBe(false);
  });

  it('sameContent ignores key order but not content', () => {
    expect(sameContent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameContent([1, 2], [2, 1])).toBe(false);
  });

  it('withVersion rewrites the lockfile package entry too', () => {
    const lock = { version: '1.0.0', packages: { '': { version: '1.0.0' }, node_modules: {} } };
    expect(withVersion(lock, 'package-lock.json', '1.1.0').packages['']).toEqual({
      version: '1.1.0'
    });
  });
});

describe('windowShips (the gathering, with injected readers)', () => {
  const fakeGit = (changes, manifests) => ({
    changes: () => changes,
    show: rev => JSON.stringify(manifests[rev] ?? manifest('1.0.0'))
  });

  it('refuses when nothing packed changed', () => {
    const result = windowShips({
      tag: 'v1.0.0',
      git: fakeGit([change('M', 'WARP.md')], {}),
      readPacked: () => packs('package.json', 'lib/index.js')
    });

    expect(result.ships).toBe(false);
    expect(result.reason).toBe('nothing-packed');
  });

  // The two-catch split. A reader failure must surface as unknown-PACKLIST; if one try/catch wrapped
  // the whole block it would arrive as unknown-window, and the workflow's warning on the former
  // would be unreachable.
  it('reports unknown-packlist when the reader throws, not unknown-window', () => {
    const result = windowShips({
      tag: 'v1.0.0',
      git: fakeGit([change('M', 'WARP.md')], {}),
      readPacked: () => {
        throw new Error('npm pack --json returned no recognisable packlist');
      }
    });

    expect(result.ships).toBe(true);
    expect(result.reason).toBe('unknown-packlist');
  });

  it('reports unknown-window when a git read throws', () => {
    const result = windowShips({
      tag: 'v1.0.0',
      git: {
        changes: () => {
          throw new Error('fatal: bad revision');
        },
        show: () => '{}'
      },
      readPacked: () => packs('package.json')
    });

    expect(result.ships).toBe(true);
    expect(result.reason).toBe('unknown-window');
  });

  it('ships without checking when there is no tag at all', () => {
    const result = windowShips({
      tag: null,
      git: fakeGit([], {}),
      readPacked: () => {
        throw new Error('must not be called');
      }
    });

    expect(result.ships).toBe(true);
    // The repository under test has release tags, so a null tag here means describe failed rather
    // than "first release" - and those must not read alike.
    expect(['no-window', 'unknown-window']).toContain(result.reason);
  });
});
