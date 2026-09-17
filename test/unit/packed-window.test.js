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
 *
 * Several cases are marked with the review round that found them. Four of the defects on #1273 were
 * the same shape - a rule that reads correctly in isolation, evaluated at the wrong point relative
 * to another rule - and two were regressions introduced by the fix to the round before. That is
 * what those cases pin.
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

/**
 * One call shape for every case below.
 *
 * Repeating the four-field call object per test made this file 18% duplicated by SonarCloud's
 * count - enough on its own to fail the quality gate on new code - and buried the single line that
 * actually differs between cases. The manifest pair defaults to "irrelevant here", which is true
 * everywhere except the version-only cases.
 */
const verdict = (changes, packed, before = manifest('1.0.0'), after = before) =>
  shipsToConsumers({ changes, packed, manifestBefore: before, manifestAfter: after });

describe('shipsToConsumers', () => {
  it('ships when a packed file changed', () => {
    const result = verdict([change('M', 'lib/utils/csv.js')], packs('lib/utils/csv.js'));

    expect(result.ships).toBe(true);
    expect(result.reason).toBe('ships');
    expect(result.shipped).toEqual(['lib/utils/csv.js']);
  });

  it('refuses when every change is unpacked', () => {
    const result = verdict(
      [
        change('M', '.github/workflows/release.yml'),
        change('M', 'WARP.md'),
        change('M', 'test/unit/logger.test.js')
      ],
      packs('lib/index.js', 'package.json')
    );

    expect(result.ships).toBe(false);
    expect(result.reason).toBe('nothing-packed');
    expect(result.unshipped).toHaveLength(3);
  });

  it('does not count CHANGELOG.md, which the release process writes itself', () => {
    const packed = packs('CHANGELOG.md', 'package.json');

    expect(verdict([change('M', 'CHANGELOG.md')], packed).ships).toBe(false);
  });

  // The load-bearing case. release.yml tags BEFORE the bump PR merges, so the previous release's
  // version bump lands inside the next window. Counting it would make the gate pass on every
  // post-release window automatically - vacuous exactly where it is needed.
  it('does not count a version-only package.json change', () => {
    const deps = { dependencies: { mssql: '^11.0.0' } };
    const result = verdict(
      [change('M', 'package.json'), change('M', '.github/workflows/release.yml')],
      packs('package.json'),
      manifest('1.7.6', deps),
      manifest('1.7.9', deps)
    );

    expect(result.ships).toBe(false);
    expect(result.reason).toBe('nothing-packed');
  });

  it('does count package.json when a dependency changed alongside the version', () => {
    const result = verdict(
      [change('M', 'package.json')],
      packs('package.json'),
      manifest('1.7.6', { dependencies: { mssql: '^11.0.0' } }),
      manifest('1.7.9', { dependencies: { mssql: '^11.1.0' } })
    );

    expect(result.ships).toBe(true);
  });

  // npm-packlist forcibly EXCLUDES lockfiles, so the tarball is byte-identical and consumers
  // resolve from unchanged package.json ranges. Counter-intuitive for a security bump, which is
  // why the refusal message names it.
  it('refuses a lock-only dependency bump', () => {
    const packed = packs('package.json', 'lib/index.js');

    expect(verdict([change('M', 'package-lock.json')], packed).ships).toBe(false);
  });

  // Round 1. A nested .gitignore/.npmignore decides what npm packs, so editing one changes the
  // tarball while its own path is never in it.
  it('ships when a file that CONTROLS the packlist changed, though it is never packed', () => {
    for (const file of ['.gitignore', '.npmignore', 'docs/.npmignore', 'lib/nested/.gitignore']) {
      expect(verdict([change('M', file)], packs('package.json')).ships, file).toBe(true);
    }
  });

  it('does not treat an ordinary unpacked file as packlist control', () => {
    const changes = [change('M', 'docs-internal/gitignore-notes.md')];

    expect(verdict(changes, packs('package.json')).ships).toBe(false);
  });

  // Round 2. The exemptions are for a file being EDITED; filtering before shipsChange would drop a
  // DELETION before its handling ran, so removing a packed file reported `nothing-packed` while the
  // tarball genuinely changed.
  it('ships when CHANGELOG.md is deleted, though a modification to it is exempt', () => {
    const packed = packs('CHANGELOG.md', 'package.json');

    expect(verdict([change('M', 'CHANGELOG.md')], packed).ships).toBe(false);
    expect(verdict([change('D', 'CHANGELOG.md')], packed).ships).toBe(true);
  });

  it('ships when package.json is deleted, though a version-only edit is exempt', () => {
    const result = verdict(
      [change('D', 'package.json')],
      packs('package.json'),
      manifest('1.7.6'),
      manifest('1.7.9')
    );

    expect(result.ships).toBe(true);
  });

  // Round 3 - a gap the round-2 fix opened. `removesSomething` short-circuits ahead of packlist
  // membership, so once deletions stopped being swallowed, deleting a lockfile npm never packed in
  // any era started reading as a shipping change.
  it('refuses a lockfile deletion, which npm never packed in any era', () => {
    const packed = packs('package.json', 'lib/a.js');

    for (const file of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']) {
      expect(verdict([change('D', file)], packed).ships, file).toBe(false);
    }
  });

  // Round 4 - that exemption checked the rename DESTINATION and short-circuited before the source
  // could be accounted for. A rename does two things and both need judging.
  it('ships a rename whose packed source disappears, even into a lockfile name', () => {
    const changes = [change('R100', 'yarn.lock', 'README.md')];

    expect(verdict(changes, packs('package.json')).ships).toBe(true);
  });

  it('ships a rename that moves a packlist-control file away', () => {
    const changes = [change('R100', 'notes.txt', '.npmignore')];

    expect(verdict(changes, packs('package.json')).ships).toBe(true);
  });

  it('treats a lockfile inside a packed subdirectory as an ordinary file', () => {
    // Root-anchored, matching npm's own strict rules.
    const changes = [change('D', 'docs/vendor/yarn.lock')];

    expect(verdict(changes, packs('package.json')).ships).toBe(true);
  });

  // Round 5. git reports T when a file's type changes; npm omits symlinks from the tarball, so a
  // packed regular file becoming a symlink removes it from the package.
  it('ships when a packed file changes type, which drops it from the tarball', () => {
    expect(verdict([change('T', 'lib/a.js')], packs('package.json')).ships).toBe(true);
  });

  // A deleted path cannot be looked up in a packlist built from the worktree, so whether it used
  // to be packed is unknowable and is assumed.
  it('ships when a packed file is deleted, though it is gone from the packlist', () => {
    expect(verdict([change('D', 'lib/removed.js')], packs('package.json')).ships).toBe(true);
  });

  it('names a rename by both ends', () => {
    const changes = [change('R100', 'docs/notes.txt', 'lib/packed.js')];
    const result = verdict(changes, packs('package.json'));

    expect(result.ships).toBe(true);
    expect(result.shipped).toEqual(['lib/packed.js -> docs/notes.txt']);
  });

  // Opposite polarity to verify-publish-tree.mjs on purpose: a wrongly blocked release is
  // re-dispatched, a wrongly permitted publish cannot be undone.
  it('fails OPEN when the packlist could not be derived', () => {
    const result = verdict([change('M', '.github/workflows/release.yml')], null);

    expect(result.ships).toBe(true);
    expect(result.reason).toBe('unknown-packlist');
  });

  it('treats a missing manifest as not-version-only rather than throwing', () => {
    const result = verdict([change('M', 'package.json')], packs('package.json'), null, null);

    expect(result.ships).toBe(true);
  });
});

describe('the helpers shared with the publish gate', () => {
  it('removesSomething handles both the one-letter and porcelain status shapes', () => {
    expect(removesSomething('D')).toBe(true);
    expect(removesSomething('R100')).toBe(true);
    expect(removesSomething(' D')).toBe(true);
    expect(removesSomething('T')).toBe(true);
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
  const fakeGit = changes => ({
    changes: () => changes,
    show: () => JSON.stringify(manifest('1.0.0'))
  });

  const gather = (changes, readPacked, tag = 'v1.0.0') =>
    windowShips({ tag, git: fakeGit(changes), readPacked });

  it('refuses when nothing packed changed', () => {
    const result = gather([change('M', 'WARP.md')], () => packs('package.json', 'lib/index.js'));

    expect(result.ships).toBe(false);
    expect(result.reason).toBe('nothing-packed');
  });

  // The two-catch split. A reader failure must surface as unknown-PACKLIST; if one try/catch
  // wrapped the whole block it would arrive as unknown-window, and the workflow's warning on the
  // former would be unreachable.
  it('reports unknown-packlist when the reader throws, not unknown-window', () => {
    const result = gather([change('M', 'WARP.md')], () => {
      throw new Error('npm pack --json returned no recognisable packlist');
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
    const result = gather(
      [],
      () => {
        throw new Error('must not be called');
      },
      null
    );

    expect(result.ships).toBe(true);
    // The repository under test has release tags, so a null tag here means describe failed rather
    // than "first release" - and those must not read alike.
    expect(['no-window', 'unknown-window']).toContain(result.reason);
  });
});
