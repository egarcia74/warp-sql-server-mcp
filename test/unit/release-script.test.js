import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  detectReleaseType,
  bumpVersion,
  isPlainVersion,
  resolveNextVersion,
  selectRun,
  renderPreview,
  sanitizeForTerminal,
  parseOriginRepo,
  parseRemoteTags,
  resolveReleasedVersion,
  parseRunUrl,
  assertRunId,
  guard,
  data,
  ALLOWED_FLAGS,
  decideConfirmation,
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
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '9007199254740992.0.0',
    '',
    undefined,
    null,
    1.7
  ])('rejects %j, which is not a plain X.Y.Z', bad => {
    expect(() => bumpVersion(bad, 'patch')).toThrow(/not a plain X\.Y\.Z/);
    expect(isPlainVersion(bad)).toBe(false);
  });

  it('accepts what npm version accepts: zero components and the largest safe integer', () => {
    expect(isPlainVersion('0.0.0')).toBe(true);
    expect(isPlainVersion('9007199254740991.0.0')).toBe(true);
    expect(bumpVersion('0.0.0', 'patch')).toBe('0.0.1');
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

  it.each([
    [0, [], '1.0.1'],
    [1, ['v1.0.1'], '1.0.2'],
    [3, ['v1.0.1', 'v1.0.2', 'v1.0.3'], '1.0.4']
  ])('walks past %i occupied tag(s) and stops at the first free one', (_, taken, expected) => {
    expect(resolveNextVersion('1.0.0', 'patch', tags(...taken))).toEqual({
      version: expected,
      collisions: taken
    });
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
  const id = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
  const run = (databaseId, createdAt, displayTitle) => ({
    databaseId,
    createdAt,
    status: 'queued',
    displayTitle
  });

  it('picks the run whose name carries [dispatch_id], wherever it sits in the listing', () => {
    const runs = [
      run(4, '2026-09-11T13:40:09Z', 'Release Automation'),
      run(3, '2026-09-11T13:40:05Z', `Release Automation [${id}]`),
      run(2, '2026-09-11T13:39:59Z', 'Release Automation [another-id]')
    ];
    expect(selectRun(runs, id)?.databaseId).toBe(3);
  });

  it('ignores a concurrent dispatch that carries no id, even when it is newer or older', () => {
    // Someone else ran the workflow by hand in the same interval: its run name has no
    // marker, so it can never be mistaken for ours, whatever its timestamp.
    const runs = [
      run(9, '2026-09-11T13:40:02Z', 'Release Automation'),
      run(8, '2026-09-11T13:39:58Z', 'Release Automation')
    ];
    expect(selectRun(runs, id)).toBeNull();
    expect(selectRun([...runs, run(10, '2026-09-11T13:40:03Z', `x [${id}]`)], id)?.databaseId).toBe(
      10
    );
  });

  it('is null while the run has not appeared yet', () => {
    expect(selectRun([], id)).toBeNull();
    expect(selectRun([run(1, '2026-09-11T13:40:00Z', undefined)], id)).toBeNull();
  });

  it('does not match a run whose id merely contains ours as a substring', () => {
    expect(
      selectRun([run(1, '2026-09-11T13:40:00Z', `Release Automation [${id}0]`)], id)
    ).toBeNull();
  });

  it('requires a dispatch id: correlation without one is refused, not guessed', () => {
    expect(() => selectRun([], '')).toThrow(/dispatch id is required/);
    expect(() => selectRun([], undefined)).toThrow(/dispatch id is required/);
  });
});

describe('renderPreview', () => {
  const base = {
    repo: 'egarcia74/warp-sql-server-mcp',
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
    expect(text).toContain('Repository:     egarcia74/warp-sql-server-mcp (from git remote origin');
    expect(text).toContain('Version:        1.7.20 -> 2.0.0');
    expect(text).toContain('Release type:   major (auto: breaking change / !:)');
    expect(text).toContain('Last tag:       v1.7.20');
    expect(text).toContain('Commits:        129 since v1.7.20 on origin/main (no merges)');
    expect(text).toContain('Tag target:     origin/main @ 4e18a53');
    expect(text).toContain('Decided by (breaking change / !:):');
    expect(text).toContain('    - feat!: remove providers');
    expect(text).toContain('The workflow makes the final decision');
    expect(text).toContain('It is told this SHA (expected_sha) and refuses to run');
    expect(text).not.toContain('DRY RUN');
  });

  it('strips terminal control characters from subjects, and only when rendering', () => {
    const hostile = 'fix: \u001b[31mred\u001b[0m and \u0007bell and \u009f c1';
    const text = renderPreview({ ...base, drivers: [hostile] });
    expect(text).toContain('    - fix: [31mred[0m and bell and  c1');
    expect(text).not.toContain('\u001b');
    // Detection is unaffected: the raw subject still classifies as a fix.
    expect(detectReleaseType([hostile]).type).toBe('patch');
    expect(sanitizeForTerminal('plain: text')).toBe('plain: text');
    expect(sanitizeForTerminal('a\u0000b\u007fc')).toBe('abc');
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

describe('parseOriginRepo', () => {
  const expected = {
    host: 'github.com',
    owner: 'egarcia74',
    name: 'warp-sql-server-mcp',
    slug: 'egarcia74/warp-sql-server-mcp'
  };

  it.each([
    'https://github.com/egarcia74/warp-sql-server-mcp.git',
    'https://github.com/egarcia74/warp-sql-server-mcp',
    'https://github.com/egarcia74/warp-sql-server-mcp/',
    'https://token@github.com/egarcia74/warp-sql-server-mcp.git',
    'git@github.com:egarcia74/warp-sql-server-mcp.git',
    'git@github.com:egarcia74/warp-sql-server-mcp',
    'ssh://git@github.com/egarcia74/warp-sql-server-mcp.git',
    'ssh://git@github.com:22/egarcia74/warp-sql-server-mcp.git',
    '  https://github.com/egarcia74/warp-sql-server-mcp.git\n'
  ])('reads owner/name from %s', url => {
    expect(parseOriginRepo(url)).toEqual(expected);
  });

  it('prefixes the host for a GitHub Enterprise remote, as --repo expects', () => {
    expect(parseOriginRepo('git@ghe.example.com:acme/tool.git').slug).toBe(
      'ghe.example.com/acme/tool'
    );
  });

  it.each([
    '',
    '/Users/me/repos/warp-sql-server-mcp',
    'https://github.com/egarcia74',
    'https://github.com/egarcia74/warp sql/x',
    'https://github.com/-egarcia74/repo.git',
    'https://github.com/egarcia74/..',
    'https://github.com/egarcia74/repo$name',
    'https://github.com/a/b/c'
  ])('rejects %j', url => {
    expect(() => parseOriginRepo(url)).toThrow(/origin URL/);
  });
});

describe('parseRemoteTags and resolveReleasedVersion', () => {
  const lsRemote = [
    'aaaa\trefs/tags/v1.7.19',
    'bbbb\trefs/tags/v1.7.20',
    'cccc\trefs/tags/v1.7.20^{}',
    'dddd\trefs/tags/combined-1153',
    ''
  ].join('\n');

  it('lists tag names once each, ignoring the peeled ^{} entries', () => {
    expect([...parseRemoteTags(lsRemote)].sort()).toEqual(['combined-1153', 'v1.7.19', 'v1.7.20']);
    expect(parseRemoteTags('')).toEqual(new Set());
  });

  const before = parseRemoteTags(lsRemote);

  it('reports the version from the tag that appeared, labelled as a tag', () => {
    const after = new Set([...before, 'v2.0.0']);
    expect(resolveReleasedVersion(before, after, '2.0.0')).toEqual({
      version: '2.0.0',
      source: 'tag'
    });
  });

  it('prefers a new tag over the expectation when the workflow chose differently', () => {
    const after = new Set([...before, 'v2.0.1']);
    expect(resolveReleasedVersion(before, after, '2.0.0')).toEqual({
      version: '2.0.1',
      source: 'tag'
    });
  });

  it('falls back to the expected version, labelled as such, when no new tag is seen', () => {
    expect(resolveReleasedVersion(before, before, '2.0.0')).toEqual({
      version: '2.0.0',
      source: 'expected'
    });
  });

  it('ignores new tags that are not plain v<X.Y.Z>, and picks the highest of several', () => {
    const after = new Set([...before, 'nightly', 'v2.0.0-rc.1', 'v2.0.1', 'v2.0.3']);
    expect(resolveReleasedVersion(before, after, '2.0.0')).toEqual({
      version: '2.0.3',
      source: 'tag'
    });
  });
});

describe('parseRunUrl and assertRunId', () => {
  it('finds the run id in the URL gh prints after a dispatch', () => {
    const out =
      '✓ Created workflow_dispatch event for release.yml at main\n' +
      'https://github.com/egarcia74/warp-sql-server-mcp/actions/runs/34605777694\n';
    expect(parseRunUrl(out)).toBe('34605777694');
  });

  it('is null when gh printed no run URL', () => {
    expect(parseRunUrl('✓ Created workflow_dispatch event for release.yml at main\n')).toBeNull();
    expect(parseRunUrl('')).toBeNull();
    expect(parseRunUrl(undefined)).toBeNull();
    expect(parseRunUrl('https://github.com/o/r/actions/workflows/release.yml')).toBeNull();
  });

  it('accepts a numeric id, as a number or a string, and returns it as a string', () => {
    expect(assertRunId(34605777694)).toBe('34605777694');
    expect(assertRunId('34605777694')).toBe('34605777694');
  });

  it.each(['--exit-status', '12a', '', undefined, null, '1.5', '-1'])('rejects %j', bad => {
    expect(() => assertRunId(bad)).toThrow(/not a number/);
  });
});

describe('guard', () => {
  it('passes listed flags and plain values through unchanged', () => {
    expect(guard('gh', ['run', 'watch', '123', '--exit-status'])).toEqual([
      'run',
      'watch',
      '123',
      '--exit-status'
    ]);
    expect(guard('git', ['log', '--format=%s', '--no-merges', 'v1..HEAD', '--'])).toEqual([
      'log',
      '--format=%s',
      '--no-merges',
      'v1..HEAD',
      '--'
    ]);
  });

  it('rejects a dash-prefixed argument that is not on the allowlist', () => {
    expect(() => guard('git', ['fetch', '--prune'])).toThrow(/refusing to pass "--prune"/);
    expect(() => guard('gh', ['run', 'list', '-L', '5'])).toThrow(/refusing to pass "-L"/);
    expect(() => guard('git', ['log', '--upload-pack=evil'])).toThrow(/refusing/);
  });

  it('rejects an allowlisted flag when it arrives in a data position', () => {
    // A run id read back from gh that happens to spell a flag must never reach gh as one.
    expect(() => guard('gh', ['run', 'watch', data('--exit-status')])).toThrow(
      /refusing to pass "--exit-status" to gh as data/
    );
    expect(() => guard('git', ['log', data('--')])).toThrow(/as data/);
    expect(() => guard('gh', ['pr', 'list', '--repo', data('-owner/repo')])).toThrow(/as data/);
  });

  it('unwraps data values that do not start with a dash', () => {
    expect(guard('gh', ['run', 'view', data('123'), '--repo', data('o/r')])).toEqual([
      'run',
      'view',
      '123',
      '--repo',
      'o/r'
    ]);
  });

  it('accepts --exclude= only with a plain ref-like value', () => {
    expect(guard('git', ['describe', '--exclude=combined-1153'])).toEqual([
      'describe',
      '--exclude=combined-1153'
    ]);
    expect(() => guard('git', ['describe', '--exclude=-x'])).toThrow(/refusing/);
    expect(() => guard('git', ['describe', '--exclude='])).toThrow(/refusing/);
    expect(() => guard('git', ['describe', '--exclude=a b'])).toThrow(/refusing/);
  });

  it('rejects non-string arguments and unknown commands', () => {
    expect(() => guard('git', ['log', 5])).toThrow(/refusing to pass 5/);
    expect(() => guard('git', ['log', undefined])).toThrow(/refusing/);
    expect(() => guard('git', ['log', { other: 'x' }])).toThrow(/refusing/);
    expect(() => guard('npm', ['publish'])).toThrow(/no argument allowlist/);
  });

  it('has no --short entry, which nothing used, and pins gh with --repo', () => {
    expect(ALLOWED_FLAGS.git.has('--short')).toBe(false);
    expect(ALLOWED_FLAGS.gh.has('--repo')).toBe(true);
  });
});

describe('decideConfirmation', () => {
  const version = '2.0.0';

  it('proceeds on --yes without asking, terminal or not', () => {
    expect(decideConfirmation({ yes: true, isTTY: false, version })).toEqual({
      proceed: true,
      reason: null
    });
    expect(decideConfirmation({ yes: true, isTTY: true, version }).proceed).toBe(true);
  });

  it('aborts with a reason when stdin is not a terminal and --yes was not given', () => {
    const result = decideConfirmation({ yes: false, isTTY: false, version });
    expect(result.proceed).toBe(false);
    expect(result.reason).toMatch(/not a terminal/);
    expect(result.reason).toMatch(/--yes/);
  });

  it('asks first on a terminal: no answer yet means neither proceed nor a reason', () => {
    expect(decideConfirmation({ yes: false, isTTY: true, version })).toEqual({
      proceed: false,
      reason: null
    });
  });

  it('proceeds only on the exact version, whitespace aside', () => {
    expect(decideConfirmation({ isTTY: true, version, answer: '2.0.0' }).proceed).toBe(true);
    expect(decideConfirmation({ isTTY: true, version, answer: ' 2.0.0\n' }).proceed).toBe(true);
  });

  it.each(['v2.0.0', '2.0.1', '2.0', 'yes', 'y', '', '2.0.0 please'])(
    'aborts on %j, which is not 2.0.0',
    answer => {
      const result = decideConfirmation({ isTTY: true, version, answer });
      expect(result.proceed).toBe(false);
      expect(result.reason).toMatch(/is not 2\.0\.0/);
    }
  );
});
