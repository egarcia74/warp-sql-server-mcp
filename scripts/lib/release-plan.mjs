/**
 * The decisions behind `npm run release`, as pure functions.
 *
 * `scripts/release.mjs` is the CLI: it talks to gh and git, prompts, dispatches and watches.
 * Everything here takes plain values and returns plain values, so it can be unit tested
 * without a repository or a network (test/unit/release-script.test.js), and so the CLI
 * stays small enough to read in one sitting.
 *
 * The rules in detectReleaseType() and resolveNextVersion() are transcriptions of
 * `.github/workflows/release.yml` - its "Check conventional commits" and "Bump version"
 * steps - and must stay in step with them. The workflow makes the final decision on the
 * runner; this module exists so the operator sees the same decision before the tag exists.
 */

export const WORKFLOW = 'release.yml';
export const RELEASE_BRANCH = 'main';

/** The manual overrides `--type` accepts. `auto` is what the workflow gets when it is absent. */
export const RELEASE_TYPES = new Set(['patch', 'minor', 'major']);

/**
 * Plain X.Y.Z only. release.yml bumps with `npm version <type>`, which on a pre-release
 * version does something this preview does not model, so anything else is refused rather
 * than guessed at.
 */
export const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/** How many driving subjects to print before summarising the rest. */
const MAX_DRIVERS = 5;

/**
 * Parses the command line. Throws on anything it does not recognise, so a typo like
 * `--dry_run` cannot silently dispatch a real release.
 */
export function parseArgs(argv) {
  const options = { dryRun: false, type: null, yes: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--yes') {
      options.yes = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--type' || arg.startsWith('--type=')) {
      let value;
      if (arg === '--type') {
        index += 1;
        value = argv[index];
      } else {
        value = arg.slice('--type='.length);
      }
      if (value === undefined || value === '') {
        throw new Error('--type needs a value: patch, minor or major');
      }
      if (!RELEASE_TYPES.has(value)) {
        throw new Error(`--type must be patch, minor or major, not "${value}"`);
      }
      options.type = value;
    } else {
      throw new Error(`unknown flag "${arg}" (see --help)`);
    }
  }

  return options;
}

/**
 * The release type release.yml's "Check conventional commits" step would compute from these
 * commit subjects, plus the subjects that drove it.
 *
 * Each subject is lowercased and lands in the FIRST bucket it matches, so `feat!: x` is
 * breaking, not a feature:
 *
 *   - contains `breaking change` or `!:`                       -> breaking  -> major
 *   - starts with `feat:` / `feat(`, or contains `feature:`     -> feature   -> minor
 *   - starts with `fix:` / `fix(`, or contains `bugfix:`        -> fix       -> patch
 *   - starts with `docs:`/`docs(`/`chore:`/`chore(`, or contains `doc:` -> docs/chore -> patch
 *   - anything else                                             -> ignored
 *
 * Returns { type, rule, drivers }: `type` is major | minor | patch | none, `rule` names the
 * bucket that decided it, and `drivers` are that bucket's subjects in commit order.
 */
export function detectReleaseType(subjects) {
  const breaking = [];
  const features = [];
  const fixes = [];
  const docsOrChore = [];

  for (const subject of subjects) {
    const msg = subject.toLowerCase();
    const startsWith = type => msg.startsWith(`${type}:`) || msg.startsWith(`${type}(`);

    if (msg.includes('breaking change') || msg.includes('!:')) {
      breaking.push(subject);
    } else if (startsWith('feat') || msg.includes('feature:')) {
      features.push(subject);
    } else if (startsWith('fix') || msg.includes('bugfix:')) {
      fixes.push(subject);
    } else if (startsWith('docs') || msg.includes('doc:') || startsWith('chore')) {
      docsOrChore.push(subject);
    }
  }

  if (breaking.length > 0)
    return { type: 'major', rule: 'breaking change / !:', drivers: breaking };
  if (features.length > 0) return { type: 'minor', rule: 'feat / feature', drivers: features };
  if (fixes.length > 0) return { type: 'patch', rule: 'fix / bugfix', drivers: fixes };
  if (docsOrChore.length > 0) return { type: 'patch', rule: 'docs / chore', drivers: docsOrChore };
  return { type: 'none', rule: null, drivers: [] };
}

/**
 * `npm version <type>` for a plain X.Y.Z, without npm. Refuses anything else: a
 * pre-release or build suffix, a `v` prefix, a missing component.
 */
export function bumpVersion(version, type) {
  if (typeof version !== 'string' || !PLAIN_VERSION.test(version)) {
    throw new Error(`"${version}" is not a plain X.Y.Z version, so it cannot be bumped here`);
  }
  const [major, minor, patch] = version.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`"${type}" is not a release type this script bumps (patch, minor, major)`);
  }
}

/**
 * The version release.yml's "Bump version" step lands on: bump once by `type`, then while
 * the tag `v<candidate>` already exists bump PATCH from the candidate - not from the
 * original - until one is free. `tagExists` answers for one tag name at a time.
 *
 * Returns { version, collisions }, where `collisions` lists the occupied tags skipped so
 * the preview can say why the version is not the obvious one.
 */
export function resolveNextVersion(current, type, tagExists) {
  let candidate = bumpVersion(current, type);
  const collisions = [];

  // A `tagExists` that says yes to everything would loop forever; the workflow has the
  // same shape and the same theoretical problem, but here the bound costs one line.
  while (tagExists(`v${candidate}`)) {
    collisions.push(`v${candidate}`);
    if (collisions.length > 1000) {
      throw new Error('gave up looking for a free tag after 1000 collisions');
    }
    candidate = bumpVersion(candidate, 'patch');
  }

  return { version: candidate, collisions };
}

/**
 * The newest run created at or after `since` (a Date or epoch milliseconds), excluding
 * any id in `exclude`. `runs` is the parsed output of
 * `gh run list --json databaseId,createdAt,status`. Returns null when none qualifies.
 */
export function selectRun(runs, since, exclude = new Set()) {
  const threshold = since instanceof Date ? since.getTime() : Number(since);

  const candidates = runs.filter(run => {
    if (exclude.has(run.databaseId)) return false;
    const created = Date.parse(run.createdAt);
    return Number.isFinite(created) && created >= threshold;
  });

  candidates.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return candidates[0] ?? null;
}

/** The preview block, as printed. Pure so its shape is pinned by a test. */
export function renderPreview(preview) {
  const {
    currentVersion,
    nextVersion,
    releaseType,
    requestedType,
    rule,
    lastTag,
    commitCount,
    drivers,
    collisions,
    headSha,
    dryRun
  } = preview;

  const lines = [];
  lines.push('Release preview (computed locally with the rules release.yml applies)');
  lines.push('');
  lines.push(`  Version:        ${currentVersion} -> ${nextVersion}`);
  lines.push(
    `  Release type:   ${releaseType}${requestedType ? ` (forced by --type ${requestedType})` : rule ? ` (auto: ${rule})` : ' (auto: no release-worthy commits)'}`
  );
  lines.push(`  Last tag:       ${lastTag ?? '(none - every commit counts)'}`);
  lines.push(
    `  Commits:        ${commitCount} since ${lastTag ?? 'the beginning'} on origin/${RELEASE_BRANCH} (no merges)`
  );
  lines.push(`  Tag target:     origin/${RELEASE_BRANCH} @ ${headSha}`);
  if (dryRun) lines.push('  Mode:           DRY RUN - the workflow creates no tag, Release or PR');

  if (collisions.length > 0) {
    lines.push('');
    lines.push(`  Skipped ${collisions.length} existing tag(s): ${collisions.join(', ')}`);
  }

  if (drivers.length > 0) {
    lines.push('');
    lines.push(`  Decided by (${rule}):`);
    for (const subject of drivers.slice(0, MAX_DRIVERS)) lines.push(`    - ${subject}`);
    if (drivers.length > MAX_DRIVERS) {
      lines.push(`    ... and ${drivers.length - MAX_DRIVERS} more`);
    }
  }

  lines.push('');
  lines.push(
    'The workflow makes the final decision: it re-runs this detection on the runner and tags\n' +
      `origin/${RELEASE_BRANCH} as it stands then, currently ${headSha}.`
  );

  return lines.join('\n');
}

export function usage() {
  return `Usage: npm run release [-- --type <patch|minor|major>] [--yes]
       npm run release:dry [-- --type <patch|minor|major>]

Dispatches ${WORKFLOW} on ${RELEASE_BRANCH} after showing what it will do and asking you to type
the version back. Replaces:

  gh workflow run ${WORKFLOW} -f release_type=auto
  gh run watch <id>

Flags:
  --dry-run        Dispatch with dry_run=true: the workflow computes the version and changelog
                   but creates no tag, GitHub Release or version-bump PR. No confirmation.
  --type <t>       Force patch, minor or major instead of the conventional-commit detection.
  --yes            Skip the type-the-version confirmation (for non-interactive use).
  --help, -h       This text.

Afterwards: edit the CHANGELOG heading on the bump PR, merge it, and npm-publish.yml publishes.
`;
}
