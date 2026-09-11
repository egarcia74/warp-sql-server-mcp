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

/** How many driving subjects to print before summarising the rest. */
const MAX_DRIVERS = 5;

// ---------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------

const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Plain X.Y.Z only, as `npm version` accepts it: no leading zeros, every component within
 * Number.MAX_SAFE_INTEGER, no pre-release or build suffix and no `v`. release.yml bumps with
 * `npm version <type>`, which on a pre-release does something this preview does not model,
 * so anything else is refused rather than guessed at.
 */
export function isPlainVersion(version) {
  return (
    typeof version === 'string' &&
    PLAIN_VERSION.test(version) &&
    version.split('.').every(part => Number(part) <= Number.MAX_SAFE_INTEGER)
  );
}

/** `npm version <type>` for a plain X.Y.Z, without npm. Refuses anything isPlainVersion() does. */
export function bumpVersion(version, type) {
  if (!isPlainVersion(version)) {
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
 * original - until one is free. `tagExists` answers for one tag name at a time and should
 * answer from the REMOTE's tags, which is what the runner's fresh checkout sees.
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
 * Tag names from `git ls-remote --tags origin`. Each line is `<sha>\t<ref>`; an annotated
 * tag also lists its peeled commit as `<ref>^{}`, which is not a second tag.
 */
export function parseRemoteTags(output) {
  const tags = new Set();
  for (const line of output.split('\n')) {
    const ref = line.split('\t')[1];
    if (ref?.startsWith('refs/tags/') && !ref.endsWith('^{}')) tags.add(ref.slice(10));
  }
  return tags;
}

/**
 * The version the workflow actually released, read from the tags that appeared on the
 * remote while the run was in flight rather than assumed from the preview. Returns
 * { version, source } with source `tag` when a new `v<X.Y.Z>` tag was found (preferring the
 * expected one if several appeared) and `expected` when none was, so the caller can label
 * the number as a guess. Anything that is not a plain `v<X.Y.Z>` tag is ignored.
 */
export function resolveReleasedVersion(tagsBefore, tagsAfter, expected) {
  const created = [...tagsAfter]
    .filter(tag => !tagsBefore.has(tag) && tag.startsWith('v') && isPlainVersion(tag.slice(1)))
    .map(tag => tag.slice(1));

  if (created.includes(expected)) return { version: expected, source: 'tag' };
  if (created.length === 0) return { version: expected, source: 'expected' };
  return { version: created.sort(compareVersions).at(-1), source: 'tag' };
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// ---------------------------------------------------------------------------------------
// Repository, flags, subjects
// ---------------------------------------------------------------------------------------

/**
 * The GitHub repository a remote URL names, so every gh call can be pinned to it with
 * `--repo`. Without the pin, GH_REPO or `gh repo set-default` could make the preview
 * describe one repository while the dispatch hits another.
 *
 * Accepts the forms git itself writes for GitHub remotes - `https://host/owner/name[.git]`,
 * `ssh://git@host[:port]/owner/name[.git]` and `git@host:owner/name[.git]` - and validates
 * owner and name against GitHub's own rules (owner: alphanumerics and inner hyphens, at
 * most 39; name: alphanumerics, `.`, `_`, `-`). Returns { host, owner, name, slug }, where
 * `slug` is what `--repo` takes: `owner/name`, prefixed with the host when it is not
 * github.com. Throws on anything else.
 */
export function parseOriginRepo(url) {
  const match =
    /^(?:(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/|(?:[^@/]+@)?([^/:]+):)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
      String(url).trim()
    );
  if (!match) throw new Error(`cannot read a GitHub owner/name from origin URL "${url}"`);

  const [, urlHost, scpHost, owner, name] = match;
  const host = urlHost ?? scpHost;
  const ownerOk = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
  const nameOk = /^[A-Za-z0-9_.-]{1,100}$/.test(name) && name !== '.' && name !== '..';
  if (!ownerOk || !nameOk) {
    throw new Error(
      `origin URL "${url}" names "${owner}/${name}", which is not a valid repository`
    );
  }

  const slug = host === 'github.com' ? `${owner}/${name}` : `${host}/${owner}/${name}`;
  return { host, owner, name, slug };
}

/**
 * Every dash-prefixed argument the CLI may pass to either tool. An entry ending in `=` is a
 * prefix whose value must be a plain ref-like token (`--exclude=<tag>`); everything else is
 * matched exactly.
 */
export const ALLOWED_FLAGS = {
  git: new Set([
    '--is-inside-work-tree',
    '--is-shallow-repository',
    '--quiet',
    '--tags',
    '--list',
    '--unshallow',
    '--verify',
    '--format=%s',
    '--no-merges',
    '--abbrev=0',
    '--exclude=',
    '--'
  ]),
  gh: new Set([
    '--repo',
    '--json',
    '-q',
    '--limit',
    '--workflow',
    '--event',
    '-f',
    '--ref',
    '--exit-status',
    '--head',
    '--state'
  ])
};

const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Marks a value that came from outside - gh or git output - as data, never an option. */
export const data = value => ({ data: value });

/**
 * Returns `args` as plain strings, or throws. A value read back from gh or git - a tag
 * name, a run id, a repository slug - is data, and if it started with a dash the tool
 * would read it as an option; wrapping it in data() makes the guard reject a leading dash
 * even when the text happens to equal an allowed flag. Everything else must be a string,
 * and a dash-prefixed one must be in the allowlist for `command`.
 */
export function guard(command, args) {
  const allowed = ALLOWED_FLAGS[command];
  if (!allowed) throw new Error(`no argument allowlist for "${command}"`);

  return args.map(arg => {
    if (arg !== null && typeof arg === 'object' && 'data' in arg) {
      const value = arg.data;
      if (typeof value !== 'string' || value.startsWith('-')) {
        throw new Error(`refusing to pass ${JSON.stringify(value)} to ${command} as data`);
      }
      return value;
    }
    if (typeof arg !== 'string') {
      throw new Error(`refusing to pass ${JSON.stringify(arg)} to ${command} as an argument`);
    }
    if (!arg.startsWith('-') || (allowed.has(arg) && !arg.endsWith('='))) return arg;

    const prefix = [...allowed].find(entry => entry.endsWith('=') && arg.startsWith(entry));
    if (prefix && SAFE_VALUE.test(arg.slice(prefix.length))) return arg;
    throw new Error(`refusing to pass ${JSON.stringify(arg)} to ${command} as an option`);
  });
}

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

// ---------------------------------------------------------------------------------------
// Confirmation and run correlation
// ---------------------------------------------------------------------------------------

/**
 * Whether to dispatch. `--yes` proceeds; without a terminal nothing can be typed back, so
 * that aborts with a reason; otherwise the typed `answer` must equal `version` exactly
 * (surrounding whitespace aside). With no `answer` yet and a terminal, the result is
 * neither proceed nor a reason: the caller should ask and call again.
 */
export function decideConfirmation({ yes = false, isTTY = false, answer, version }) {
  if (yes) return { proceed: true, reason: null };
  if (!isTTY) {
    return {
      proceed: false,
      reason:
        'stdin is not a terminal, so the version cannot be typed back. Re-run from a ' +
        'terminal, or pass --yes to skip the confirmation.'
    };
  }
  if (answer === undefined) return { proceed: false, reason: null };

  const typed = answer.trim();
  if (typed === version) return { proceed: true, reason: null };
  return { proceed: false, reason: `"${typed}" is not ${version} - aborted, nothing dispatched.` };
}

/** The run id in a `.../actions/runs/<id>` URL, as gh prints after a dispatch; null if none. */
export function parseRunUrl(text) {
  return /\/actions\/runs\/(\d+)\b/.exec(String(text ?? ''))?.[1] ?? null;
}

/** A run id as a validated string, or a thrown error - checked before it reaches gh. */
export function assertRunId(value) {
  const id = String(value);
  if (!/^\d+$/.test(id)) {
    throw new Error(`gh returned a run id that is not a number: ${JSON.stringify(value)}`);
  }
  return id;
}

/**
 * The OLDEST run created at or after `since` (a Date or epoch milliseconds) that is not in
 * `exclude` - the ids seen before the dispatch. `runs` is the parsed output of
 * `gh run list --json databaseId,createdAt,status`. Returns null when none qualifies.
 *
 * Oldest, not newest: this is the fallback when gh did not print the run URL, and if
 * someone else dispatches the same workflow a moment later, theirs is the newer one. The
 * residual race - two dispatches inside the same polling interval - cannot be told apart
 * from the listing, which is why the URL gh prints is used first whenever it is there.
 */
export function selectRun(runs, since, exclude = new Set()) {
  const threshold = since instanceof Date ? since.getTime() : Number(since);

  const candidates = runs.filter(run => {
    if (exclude.has(run.databaseId)) return false;
    const created = Date.parse(run.createdAt);
    return Number.isFinite(created) && created >= threshold;
  });

  candidates.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------

/** The preview block, as printed. Pure so its shape is pinned by a test. */
export function renderPreview(preview) {
  const {
    repo,
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
  lines.push(`  Repository:     ${repo} (from git remote origin; every gh call is pinned to it)`);
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

Dispatches ${WORKFLOW} on ${RELEASE_BRANCH} of the repository that git remote "origin" points at,
after showing what it will do and asking you to type the version back. Replaces:

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
