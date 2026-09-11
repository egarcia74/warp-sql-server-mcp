import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  detectReleaseType,
  bumpVersion,
  resolveNextVersion,
  selectRun,
  renderPreview,
  RELEASE_TYPES
} from '../../scripts/lib/release-plan.mjs';

// The pure parts only. main() spawns gh and git and is deliberately left untested here;
// nothing in this file starts a process.

describe('detectReleaseType', () => {
  it('is none when nothing matches', () => {
    expect(detectReleaseType([])).toEqual({ type: 'none', rule: null, drivers: [] });
    expect(
      detectReleaseType(['refactor: tidy', 'test: add cases', 'ci: pin action', 'style: fmt'])
    ).toEqual({ type: 'none', rule: null, drivers: [] });
  });

  it('is patch for fix and bugfix', () => {
    const result = detectReleaseType(['fix: a', 'refactor: b', 'bugfix: c']);
    expect(result.type).toBe('patch');
    expect(result.rule).toBe('fix / bugfix');
    expect(result.drivers).toEqual(['fix: a', 'bugfix: c']);
  });

  it('is patch for docs and chore, which the workflow treats as release-worthy', () => {
    expect(detectReleaseType(['docs: readme']).type).toBe('patch');
    expect(detectReleaseType(['chore(deps): bump x']).type).toBe('patch');
    expect(detectReleaseType(['update doc: thing']).type).toBe('patch');
    expect(detectReleaseType(['docs: readme']).rule).toBe('docs / chore');
  });

  it('reports fixes, not docs, as the drivers when both are present', () => {
    const result = detectReleaseType(['docs: a', 'fix: b', 'chore: c']);
    expect(result.type).toBe('patch');
    expect(result.drivers).toEqual(['fix: b']);
  });

  it('is minor for feat and feature, which beats fix and chore', () => {
    const result = detectReleaseType(['fix: a', 'feat(cli): b', 'chore: c', 'feature: d']);
    expect(result.type).toBe('minor');
    expect(result.rule).toBe('feat / feature');
    expect(result.drivers).toEqual(['feat(cli): b', 'feature: d']);
  });

  it('is major for BREAKING CHANGE, which beats everything', () => {
    const result = detectReleaseType(['feat: a', 'fix: b', 'refactor: BREAKING CHANGE drop x']);
    expect(result.type).toBe('major');
    expect(result.rule).toBe('breaking change / !:');
    expect(result.drivers).toEqual(['refactor: BREAKING CHANGE drop x']);
  });

  it('treats "!:" anywhere in the subject as breaking, and puts a feat!: in the breaking bucket only', () => {
    const result = detectReleaseType([
      'feat!: remove providers',
      'fix!: change defaults',
      'feat: x'
    ]);
    expect(result.type).toBe('major');
    // Every breaking subject is a driver, and neither appears as a feature.
    expect(result.drivers).toEqual(['feat!: remove providers', 'fix!: change defaults']);
  });

  it('is case-insensitive, as the workflow lowercases the subject', () => {
    expect(detectReleaseType(['FEAT: shout']).type).toBe('minor');
    expect(detectReleaseType(['Fix: quiet']).type).toBe('patch');
    expect(detectReleaseType(['Breaking Change: yes']).type).toBe('major');
    expect(detectReleaseType(['Chore: x']).type).toBe('patch');
  });

  it('matches the type prefix only at the start, with a colon or scope', () => {
    // "feat" appearing later, or without a delimiter, is not a feature commit.
    expect(detectReleaseType(['refactor: prefer feat flags']).type).toBe('none');
    expect(detectReleaseType(['feature flags']).type).toBe('none');
    expect(detectReleaseType(['fixture: add']).type).toBe('none');
    expect(detectReleaseType(['feat(scope): yes']).type).toBe('minor');
  });

  it('keeps drivers in commit order and does not deduplicate', () => {
    const result = detectReleaseType(['fix: same', 'fix: same', 'fix: other']);
    expect(result.drivers).toEqual(['fix: same', 'fix: same', 'fix: other']);
  });
});

describe('bumpVersion', () => {
  it.each([
    ['1.7.20', 'patch', '1.7.21'],
    ['1.7.20', 'minor', '1.8.0'],
    ['1.7.20', 'major', '2.0.0'],
    ['0.0.9', 'patch', '0.0.10'],
    ['0.9.9', 'minor', '0.10.0'],
    ['9.9.9', 'major', '10.0.0']
  ])('%s + %s = %s', (from, type, expected) => {
    expect(bumpVersion(from, type)).toBe(expected);
  });

  it.each([
    '1.7',
    '1.7.20-beta.1',
    '1.7.20+build.5',
    'v1.7.20',
    '1.7.20.1',
    ' 1.7.20',
    '1.7.x',
    '',
    undefined,
    null,
    1.7
  ])('rejects %j, which is not a plain X.Y.Z', bad => {
    expect(() => bumpVersion(bad, 'patch')).toThrow(/not a plain X\.Y\.Z/);
  });

  it('rejects a release type it does not bump', () => {
    expect(() => bumpVersion('1.0.0', 'prerelease')).toThrow(/not a release type/);
    expect(() => bumpVersion('1.0.0', 'auto')).toThrow(/not a release type/);
    expect(() => bumpVersion('1.0.0', undefined)).toThrow(/not a release type/);
  });
});

describe('resolveNextVersion', () => {
  const tags =
    (...names) =>
    tag =>
      names.includes(tag);

  it('is the plain bump when the tag is free', () => {
    expect(resolveNextVersion('1.7.20', 'minor', tags())).toEqual({
      version: '1.8.0',
      collisions: []
    });
  });

  it('bumps patch from the candidate, as the workflow does, until a tag is free', () => {
    // A major bump that collides lands on 2.0.1, not on 3.0.0 and not on 1.7.21.
    expect(resolveNextVersion('1.7.20', 'major', tags('v2.0.0'))).toEqual({
      version: '2.0.1',
      collisions: ['v2.0.0']
    });
    expect(resolveNextVersion('1.7.20', 'patch', tags('v1.7.21', 'v1.7.22'))).toEqual({
      version: '1.7.23',
      collisions: ['v1.7.21', 'v1.7.22']
    });
  });

  it('asks about the v-prefixed tag name, which is what this repo tags', () => {
    const asked = [];
    resolveNextVersion('1.7.20', 'patch', tag => {
      asked.push(tag);
      return false;
    });
    expect(asked).toEqual(['v1.7.21']);
  });

  it('gives up rather than loop forever if every tag is taken', () => {
    expect(() => resolveNextVersion('1.0.0', 'patch', () => true)).toThrow(/gave up/);
  });
});

describe('parseArgs', () => {
  it('defaults to auto detection, a real release and an interactive confirmation', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, type: null, yes: false, help: false });
  });

  it('recognises each flag', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--yes']).yes).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--type', 'minor']).type).toBe('minor');
    expect(parseArgs(['--type=major']).type).toBe('major');
    expect(parseArgs(['--dry-run', '--type', 'patch', '--yes'])).toEqual({
      dryRun: true,
      type: 'patch',
      yes: true,
      help: false
    });
  });

  it('rejects an unknown flag, so a typo cannot dispatch a real release', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown flag "--bogus"/);
    expect(() => parseArgs(['--dry_run'])).toThrow(/unknown flag "--dry_run"/);
    expect(() => parseArgs(['-y'])).toThrow(/unknown flag "-y"/);
    expect(() => parseArgs(['release'])).toThrow(/unknown flag "release"/);
  });

  it('validates --type strictly against patch, minor and major', () => {
    expect([...RELEASE_TYPES].sort()).toEqual(['major', 'minor', 'patch']);
    expect(() => parseArgs(['--type', 'prerelease'])).toThrow(/must be patch, minor or major/);
    expect(() => parseArgs(['--type', 'auto'])).toThrow(/must be patch, minor or major/);
    expect(() => parseArgs(['--type', 'Minor'])).toThrow(/must be patch, minor or major/);
    expect(() => parseArgs(['--type=none'])).toThrow(/must be patch, minor or major/);
  });

  it('rejects --type without a value', () => {
    expect(() => parseArgs(['--type'])).toThrow(/--type needs a value/);
    expect(() => parseArgs(['--type='])).toThrow(/--type needs a value/);
    // A following flag is consumed as the value and then rejected, never silently applied.
    expect(() => parseArgs(['--type', '--dry-run'])).toThrow(/must be patch, minor or major/);
  });
});

describe('selectRun', () => {
  const run = (databaseId, createdAt, status = 'queued') => ({ databaseId, createdAt, status });
  const dispatchedAt = Date.parse('2026-09-11T13:40:00Z');

  it('picks the newest run created at or after the dispatch time', () => {
    const runs = [
      run(3, '2026-09-11T13:40:05Z'),
      run(4, '2026-09-11T13:40:09Z'),
      run(2, '2026-09-11T13:39:59Z', 'completed'),
      run(1, '2026-09-11T13:32:28Z', 'completed')
    ];
    expect(selectRun(runs, dispatchedAt)?.databaseId).toBe(4);
  });

  it('accepts a run created exactly at the dispatch time', () => {
    expect(selectRun([run(7, '2026-09-11T13:40:00Z')], dispatchedAt)?.databaseId).toBe(7);
  });

  it('is null when every run predates the dispatch', () => {
    const runs = [run(1, '2026-09-11T13:32:28Z'), run(2, '2026-09-11T13:39:59Z')];
    expect(selectRun(runs, dispatchedAt)).toBeNull();
    expect(selectRun([], dispatchedAt)).toBeNull();
  });

  it('accepts the dispatch time as a Date too', () => {
    const runs = [run(5, '2026-09-11T13:40:01Z')];
    expect(selectRun(runs, new Date(dispatchedAt))?.databaseId).toBe(5);
  });

  it('skips runs listed in the pre-dispatch snapshot, whatever their timestamp', () => {
    // Clock skew allowance can reach back before the dispatch; the snapshot keeps an older
    // run from being mistaken for the new one.
    const runs = [run(9, '2026-09-11T13:40:02Z'), run(8, '2026-09-11T13:40:01Z')];
    expect(selectRun(runs, dispatchedAt, new Set([9]))?.databaseId).toBe(8);
    expect(selectRun(runs, dispatchedAt, new Set([8, 9]))).toBeNull();
  });

  it('ignores a run whose createdAt does not parse', () => {
    expect(selectRun([run(1, 'yesterday')], dispatchedAt)).toBeNull();
  });
});

describe('renderPreview', () => {
  const base = {
    currentVersion: '1.7.20',
    nextVersion: '2.0.0',
    releaseType: 'major',
    requestedType: null,
    rule: 'breaking change / !:',
    lastTag: 'v1.7.20',
    commitCount: 129,
    drivers: ['feat!: remove providers', 'fix!: honour the settings'],
    collisions: [],
    headSha: '4e18a53',
    dryRun: false
  };

  it('prints the version transition, type, tag, count, drivers and the tag target', () => {
    const text = renderPreview(base);
    expect(text).toContain('Version:        1.7.20 -> 2.0.0');
    expect(text).toContain('Release type:   major (auto: breaking change / !:)');
    expect(text).toContain('Last tag:       v1.7.20');
    expect(text).toContain('Commits:        129 since v1.7.20 on origin/main (no merges)');
    expect(text).toContain('Tag target:     origin/main @ 4e18a53');
    expect(text).toContain('Decided by (breaking change / !:):');
    expect(text).toContain('    - feat!: remove providers');
    expect(text).toContain('The workflow makes the final decision');
    expect(text).not.toContain('DRY RUN');
  });

  it('summarises drivers beyond the first five', () => {
    const drivers = Array.from({ length: 8 }, (_, i) => `fix: number ${i}`);
    const text = renderPreview({ ...base, drivers });
    expect(text).toContain('    - fix: number 4');
    expect(text).not.toContain('fix: number 5');
    expect(text).toContain('... and 3 more');
  });

  it('says when the type was forced, when tags were skipped, and when it is a dry run', () => {
    const text = renderPreview({
      ...base,
      requestedType: 'minor',
      releaseType: 'minor',
      rule: null,
      drivers: [],
      nextVersion: '1.8.1',
      collisions: ['v1.8.0'],
      dryRun: true
    });
    expect(text).toContain('Release type:   minor (forced by --type minor)');
    expect(text).toContain('Skipped 1 existing tag(s): v1.8.0');
    expect(text).toContain('DRY RUN');
    expect(text).not.toContain('Decided by');
  });

  it('handles a repository with no tag yet', () => {
    const text = renderPreview({ ...base, lastTag: null });
    expect(text).toContain('Last tag:       (none - every commit counts)');
    expect(text).toContain('since the beginning');
  });
});
