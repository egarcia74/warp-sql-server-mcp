/**
 * The decisions behind `npm run release`, as pure functions.
 *
 * `scripts/release.mjs` is the CLI: it talks to gh and git, prompts, dispatches and watches.
 * Everything here takes plain values and returns plain values, so it can be unit tested
 * without a repository or a network (test/unit/release-script.test.js), and so the CLI
 * stays small enough to read in one sitting.
 *
 * detectReleaseType() and groupForChangelog() are the ONLY copy of the conventional-commit
 * rules: `.github/workflows/release.yml` reaches them on the runner through
 * `scripts/ci/classify-release-commits.mjs`, which imports this file, so its "Check
 * conventional commits" and "Generate changelog" steps and this preview cannot disagree
 * (#1158 - they used to be three separate transcriptions, and two of them had drifted).
 *
 * resolveNextVersion() is still a transcription, of the workflow's "Bump version" step,
 * and must be kept in step with it by hand. The workflow makes the final decision on the
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

  // Unbounded on purpose: the workflow's loop is, and the remote's tag set is finite.
  while (tagExists(`v${candidate}`)) {
    collisions.push(`v${candidate}`);
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
 * The conventional-commit classification, in ONE place.
 *
 * Three consumers must agree or the release is wrong:
 *   1. release.yml's "Check conventional commits" step - decides the release type,
 *   2. release.yml's "Generate changelog" step - groups the same commits for the notes,
 *   3. `npm run release`'s preview - tells the operator what (1) will decide.
 * (1) and (2) reach these rules through scripts/ci/classify-release-commits.mjs, which
 * imports this module; (3) imports it directly. There is no second copy to drift.
 *
 * Rules are ordered and the FIRST match wins, so `feat!: x` is breaking, not a feature.
 * The first four rules are the historical ones, unchanged and in their original order, so
 * no subject that classified before classifies differently now; the rules after them only
 * ever capture subjects that used to fall through unrecognised (#1158).
 *
 * `release` is the version bump the rule asks for:
 *
 *   major  breaking change / !:                          a compatibility break
 *   minor  feat / feature                                new functionality
 *   patch  fix / bugfix, docs / chore, perf, refactor,    can change what the published
 *          revert, build                                 tarball contains or does
 *   none   test, ci, style                                cannot: `test/` and `.github/`
 *                                                        are not in package.json "files",
 *                                                        and `style` is formatting only
 *
 * Why `perf` is patch and not minor: SemVer's MINOR is "functionality added in a
 * backwards compatible manner", and Conventional Commits maps only `feat` to it. A faster
 * implementation of the same API adds no functionality, and this project already puts
 * every other shipping-but-not-new change (`docs`, `chore`) in patch.
 *
 * Why `test`/`ci`/`style` release NOTHING while `refactor`/`perf`/`build` do: the line is
 * "could a consumer of the npm package observe this?". `refactor` can - #1155 removed a
 * module that shipped in the tarball and a field from a public MCP tool response under a
 * `refactor:` subject, which is the bug that prompted #1158. `test:` and `ci:` provably
 * cannot: neither `test/` nor `.github/` is published. Their commits are still recognised
 * and counted, so a window made only of them reports "N commits, none of a type that
 * triggers a release" instead of looking like an empty window - which is the real defect
 * #1158 describes. Force one with `npm run release -- --type patch` if you want it.
 */
const startsWithType = (msg, type) => msg.startsWith(`${type}:`) || msg.startsWith(`${type}(`);

export const CLASSIFICATION_RULES = [
  {
    id: 'breaking',
    label: 'breaking change / !:',
    release: 'major',
    match: msg => msg.includes('breaking change') || msg.includes('!:')
  },
  {
    id: 'feat',
    label: 'feat / feature',
    release: 'minor',
    match: msg => startsWithType(msg, 'feat') || msg.includes('feature:')
  },
  {
    id: 'fix',
    label: 'fix / bugfix',
    release: 'patch',
    match: msg => startsWithType(msg, 'fix') || msg.includes('bugfix:')
  },
  {
    id: 'docs',
    label: 'docs / chore',
    release: 'patch',
    match: msg =>
      startsWithType(msg, 'docs') || msg.includes('doc:') || startsWithType(msg, 'chore')
  },
  { id: 'perf', label: 'perf', release: 'patch', match: msg => startsWithType(msg, 'perf') },
  {
    id: 'refactor',
    label: 'refactor',
    release: 'patch',
    match: msg => startsWithType(msg, 'refactor')
  },
  {
    id: 'revert',
    label: 'revert',
    release: 'patch',
    // `Revert "..."` is the subject git and GitHub's revert button generate; a revert of a
    // `feat!:` still reads as breaking above, which is the right answer.
    match: msg => startsWithType(msg, 'revert') || msg.startsWith('revert "')
  },
  { id: 'build', label: 'build', release: 'patch', match: msg => startsWithType(msg, 'build') },
  { id: 'test', label: 'test', release: 'none', match: msg => startsWithType(msg, 'test') },
  { id: 'ci', label: 'ci', release: 'none', match: msg => startsWithType(msg, 'ci') },
  { id: 'style', label: 'style', release: 'none', match: msg => startsWithType(msg, 'style') }
];

/** The first rule `subject` matches, or null when nothing recognises it. */
export function classifySubject(subject) {
  const msg = String(subject).toLowerCase();
  return CLASSIFICATION_RULES.find(rule => rule.match(msg)) ?? null;
}

/** Release levels in descending precedence: one breaking subject outranks any number of feats. */
const LEVELS = ['major', 'minor', 'patch'];

/**
 * The release type release.yml's "Check conventional commits" step computes from these
 * commit subjects, plus the evidence behind it.
 *
 * Returns { type, rule, drivers, counts, unclassified, nonReleasing }:
 *   type          major | minor | patch | none
 *   rule          the label of the bucket that decided it, or null for none
 *   drivers       that bucket's subjects, in commit order, not deduplicated
 *   counts        commits per rule id, plus `unclassified`, for the "why not" message
 *   unclassified  subjects no rule recognised (a malformed or unprefixed subject)
 *   nonReleasing  subjects of a recognised type that deliberately triggers no release
 *
 * `type: 'none'` with a non-empty `counts` is NOT the same as an empty window, and every
 * caller must say which one it is - that ambiguity is the whole of #1158.
 */
export function detectReleaseType(subjects) {
  const buckets = new Map();
  const unclassified = [];

  for (const subject of subjects) {
    const rule = classifySubject(subject);
    if (!rule) {
      unclassified.push(subject);
      continue;
    }
    if (!buckets.has(rule.id)) buckets.set(rule.id, []);
    buckets.get(rule.id).push(subject);
  }

  const counts = {};
  for (const rule of CLASSIFICATION_RULES) {
    if (buckets.has(rule.id)) counts[rule.id] = buckets.get(rule.id).length;
  }
  if (unclassified.length > 0) counts.unclassified = unclassified.length;

  const nonReleasing = CLASSIFICATION_RULES.filter(
    rule => rule.release === 'none' && buckets.has(rule.id)
  ).flatMap(rule => buckets.get(rule.id));

  const evidence = { counts, unclassified, nonReleasing };

  for (const level of LEVELS) {
    const rule = CLASSIFICATION_RULES.find(
      candidate => candidate.release === level && buckets.has(candidate.id)
    );
    if (rule) return { type: level, rule: rule.label, drivers: buckets.get(rule.id), ...evidence };
  }

  return { type: 'none', rule: null, drivers: [], ...evidence };
}

/**
 * The commit mix as one line - `ci: 8, test: 3, unclassified: 1` - so a run that releases
 * nothing can say what it saw instead of just "none". Empty string for no commits.
 */
export function describeCommitMix(detected) {
  const parts = CLASSIFICATION_RULES.filter(rule => detected.counts[rule.id]).map(
    rule => `${rule.label}: ${detected.counts[rule.id]}`
  );
  if (detected.counts.unclassified) parts.push(`unclassified: ${detected.counts.unclassified}`);
  return parts.join(', ');
}

/** `<hash> <subject>` lines, as `git log --pretty=format:'%h %s'` writes them. */
export function parseCommitLines(text) {
  return String(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const space = line.indexOf(' ');
      if (space === -1) return { hash: line, subject: '' };
      return { hash: line.slice(0, space), subject: line.slice(space + 1) };
    });
}

/** The conventional-commit type prefix removed, scope and `!` included. */
export function stripTypePrefix(subject) {
  return String(subject).replace(/^\s*(feat|feature|fix|bugfix)(\([^)]*\))?!?:\s*/i, '');
}

/** Which changelog section each rule id feeds; anything unlisted is "other". */
const CHANGELOG_SECTIONS = { breaking: 'breaking', feat: 'features', fix: 'fixes' };

/**
 * Commits grouped for the GitHub Release notes, by the SAME rules that pick the release
 * type. This used to be a second, narrower copy inside release.yml that tested
 * `startsWith('feat:')` and so filed every `feat(scope):` under "Other Changes" (#1158).
 *
 * Takes { hash, subject } and returns { breaking, features, fixes, other } of
 * { hash, text }, where `text` has the type prefix stripped in the feature and fix
 * sections (the heading already says which they are) and is left whole elsewhere.
 */
export function groupForChangelog(commits) {
  const groups = { breaking: [], features: [], fixes: [], other: [] };

  for (const { hash, subject } of commits) {
    const rule = classifySubject(subject);
    const section = (rule && CHANGELOG_SECTIONS[rule.id]) ?? 'other';
    const text = section === 'features' || section === 'fixes' ? stripTypePrefix(subject) : subject;
    groups[section].push({ hash, text });
  }

  return groups;
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
 * The run whose name carries `[<dispatchId>]`. release.yml sets `run-name` from the
 * `dispatch_id` input the CLI passes, so the run it created is identifiable exactly - a run
 * dispatched by someone else in the same moment has a different id, or none. `runs` is the
 * parsed output of `gh run list --json databaseId,createdAt,status,displayTitle`. Returns
 * null when no run matches yet; the oldest wins in the (impossible) case of two matches.
 * Used when gh did not print the created run's URL, which is the primary path.
 */
export function selectRun(runs, dispatchId) {
  if (typeof dispatchId !== 'string' || dispatchId === '') {
    throw new Error('a dispatch id is required to correlate the run');
  }
  const marker = `[${dispatchId}]`;
  const matches = runs.filter(run => String(run.displayTitle ?? '').includes(marker));
  matches.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return matches[0] ?? null;
}

// ---------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------

/**
 * `text` with C0 and C1 control characters removed, for terminal output only. Commit
 * subjects are attacker-adjacent text that the preview echoes; an escape sequence in one
 * could recolour or rewrite the confirmation prompt. Detection always runs on the raw
 * subject - only what is printed is cleaned.
 */
export function sanitizeForTerminal(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

/** The preview block, as printed. Pure so its shape is pinned by a test. */
/**
 * Why the preview shows the release type it does: an explicit --type, the rule that matched,
 * or nothing having matched at all.
 */
function releaseTypeReason(requestedType, rule) {
  if (requestedType) {
    return ` (forced by --type ${requestedType})`;
  }

  if (rule) {
    return ` (auto: ${rule})`;
  }

  return ' (auto: no commit of a type that triggers a release)';
}

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
    dryRun,
    breakdown
  } = preview;

  const lines = [
    'Release preview (computed locally with the rules release.yml applies)',
    '',
    `  Repository:     ${repo} (from git remote origin; every gh call is pinned to it)`,
    `  Version:        ${currentVersion} -> ${nextVersion}`,
    `  Release type:   ${releaseType}${releaseTypeReason(requestedType, rule)}`,
    `  Last tag:       ${lastTag ?? '(none - every commit counts)'}`,
    `  Commits:        ${commitCount} since ${lastTag ?? 'the beginning'} on origin/${RELEASE_BRANCH} (no merges)`
  ];
  // The mix is printed whatever the outcome: when the type is `none` it is the only thing
  // that distinguishes "commits, none of them release-triggering" from an empty window.
  if (breakdown) lines.push(`  Commit mix:     ${breakdown}`);
  lines.push(`  Tag target:     origin/${RELEASE_BRANCH} @ ${headSha}`);
  if (dryRun) lines.push('  Mode:           DRY RUN - the workflow creates no tag, Release or PR');

  if (collisions.length > 0) {
    lines.push('');
    lines.push(`  Skipped ${collisions.length} existing tag(s): ${collisions.join(', ')}`);
  }

  if (drivers.length > 0) {
    lines.push('');
    lines.push(`  Decided by (${rule}):`);
    for (const subject of drivers.slice(0, MAX_DRIVERS)) {
      lines.push(`    - ${sanitizeForTerminal(subject)}`);
    }
    if (drivers.length > MAX_DRIVERS) {
      lines.push(`    ... and ${drivers.length - MAX_DRIVERS} more`);
    }
  }

  lines.push('');
  lines.push(
    'The workflow makes the final decision: it re-runs this detection on the runner and tags\n' +
      `origin/${RELEASE_BRANCH} at ${headSha}. It is told this SHA (expected_sha) and refuses to run\n` +
      `if ${RELEASE_BRANCH} has moved since this preview.`
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
