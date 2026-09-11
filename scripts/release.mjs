#!/usr/bin/env node
/**
 * Dispatches the release workflow with a preview and an explicit confirmation step.
 *
 * Why this exists: cutting a release was two hand-typed commands -
 *
 *   gh workflow run release.yml -f release_type=auto
 *   gh run watch $(gh run list --workflow=release.yml -L1 --json databaseId -q '.[0].databaseId')
 *
 * - with nothing in between showing what was about to be tagged. `release.yml` decides the
 * version on the runner, from the commit history of the ref it was dispatched on, so the
 * person dispatching it learns the version after the tag and the GitHub Release exist. Both
 * are cheap to create and awkward to retract, and the version number is spent either way.
 *
 * This script computes the same decision locally, with the rules release.yml's "Check
 * conventional commits" step applies, prints it, and asks the operator to type the version
 * back before dispatching. The workflow still makes the final decision - the preview is
 * there so a surprise shows up before the tag, not after. Then it finds the run it started
 * and watches it to completion, and prints where the release and the version-bump PR are.
 *
 * What it previews is origin/main on the repository that remote `origin` names, not the
 * local checkout: every gh call is pinned to that repository with `--repo`, the workflow is
 * dispatched with `--ref main`, so the runner checks out origin/main's HEAD, and that is the
 * commit the tag will point at. Tags are read from the remote (`git ls-remote`), because a
 * tag kept locally after being deleted upstream would otherwise skip a version the runner's
 * fresh checkout will use. A local `main` that is behind or ahead is reported as a warning.
 *
 * This file is the CLI only: preconditions, subprocess plumbing, the prompt, the dispatch
 * and the watch. Every decision - flag parsing, the release-type rules, the version bump,
 * run selection, the argument guard, the preview text - is a pure function in
 * scripts/lib/release-plan.mjs, unit tested in test/unit/release-script.test.js. Every
 * subprocess is spawned with an argument array - never a shell string - and every value
 * read back from gh or git is passed on as data().
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import {
  WORKFLOW,
  RELEASE_BRANCH,
  assertRunId,
  data,
  decideConfirmation,
  detectReleaseType,
  guard,
  isPlainVersion,
  parseArgs,
  parseOriginRepo,
  parseRemoteTags,
  parseRunUrl,
  renderPreview,
  resolveNextVersion,
  resolveReleasedVersion,
  selectRun,
  usage
} from './lib/release-plan.mjs';

const REMOTE_HEAD = `refs/remotes/origin/${RELEASE_BRANCH}`;
const PACKAGE_NAME = '@egarcia74/warp-sql-server-mcp';

/** How long to keep looking for the dispatched run when gh did not print its URL. */
const POLL_INTERVAL_MS = 3_000;
const POLL_WINDOW_MS = 60_000;

const FULL_SHA = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------------------
// Subprocesses
// ---------------------------------------------------------------------------------------

class CommandError extends Error {
  constructor(command, args, result) {
    super(
      result.error
        ? `${command} could not be started: ${result.error.message}`
        : `${command} ${args.join(' ')} exited ${result.status}${result.stderr?.trim() ? `\n${result.stderr.trim()}` : ''}`
    );
    this.notFound = result.error?.code === 'ENOENT';
  }
}

/** Runs `command`; returns { stdout, stderr } or throws a CommandError. */
function captureAll(command, rawArgs) {
  const args = guard(command, rawArgs);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new CommandError(command, args, result);
  return { stdout: result.stdout, stderr: result.stderr };
}

const capture = (command, args) => captureAll(command, args).stdout;

/** Like capture(), but a non-zero exit returns null instead of throwing. */
function tryCapture(command, args) {
  try {
    return capture(command, args);
  } catch (error) {
    if (error instanceof CommandError && !error.notFound) return null;
    throw error;
  }
}

/** Runs `command` with the terminal attached, so the user sees its output live. */
function inherit(command, rawArgs) {
  const args = guard(command, rawArgs);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw new CommandError(command, args, result);
  return result.status;
}

const git = (...args) => capture('git', args).trim();

/** Set once the origin repository is known; every gh call after `auth status` is pinned to it. */
let REPO = null;
const pinned = args => {
  if (!REPO) throw new Error('gh called before the origin repository was resolved');
  return [...args, '--repo', data(REPO)];
};
const gh = (...args) => capture('gh', pinned(args));
const ghAll = (...args) => captureAll('gh', pinned(args));
const ghJson = (...args) => JSON.parse(gh(...args));
const remoteTags = () => parseRemoteTags(capture('git', ['ls-remote', '--tags', 'origin']));

// ---------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------

const warn = message => console.warn(`WARNING: ${message}`);
const note = message => console.log(`NOTE: ${message}`);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function checkPreconditions() {
  try {
    capture('gh', ['auth', 'status']);
  } catch (error) {
    if (error instanceof CommandError && error.notFound) {
      fail('GitHub CLI (gh) is not installed or not on PATH. See https://cli.github.com/');
    }
    fail(`gh is not authenticated - run \`gh auth login\`.\n${error.message}`);
  }

  if (tryCapture('git', ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') {
    fail('not inside a git repository - run this from a checkout of the repo.');
  }

  try {
    REPO = parseOriginRepo(git('remote', 'get-url', 'origin')).slug;
  } catch (error) {
    fail(`${error.message}. The release is pinned to the repository remote "origin" names.`);
  }

  // release.yml checks out with fetch-depth 0, so its `git describe` sees the whole history.
  // A shallow clone can describe a different last tag and so compute a different type.
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    note('this clone is shallow; fetching the full history so the preview matches the runner.');
    try {
      git('fetch', '--quiet', '--unshallow', 'origin');
    } catch (error) {
      fail(`could not unshallow the clone.\n${error.message}`);
    }
  }

  // An explicit refspec, so a narrowed remote.origin.fetch cannot leave origin/main stale.
  // --tags adds the remote's tags without deleting local ones: the remote is consulted
  // directly for every tag decision below, so nothing here needs to prune.
  try {
    git('fetch', '--quiet', '--tags', 'origin', `+refs/heads/${RELEASE_BRANCH}:${REMOTE_HEAD}`);
  } catch (error) {
    fail(`could not fetch origin/${RELEASE_BRANCH}.\n${error.message}`);
  }

  const remoteHead = git('rev-parse', REMOTE_HEAD);
  if (!FULL_SHA.test(remoteHead)) {
    fail(`git rev-parse ${REMOTE_HEAD} returned "${remoteHead}", not a full commit SHA.`);
  }
  const localRef = `refs/heads/${RELEASE_BRANCH}`;
  const localHead = tryCapture('git', ['rev-parse', '--verify', '--quiet', localRef])?.trim();

  if (localHead && localHead !== remoteHead) {
    warn(
      `local ${RELEASE_BRANCH} (${localHead.slice(0, 7)}) is not at origin/${RELEASE_BRANCH} ` +
        `(${remoteHead.slice(0, 7)}). The workflow releases origin/${RELEASE_BRANCH}'s HEAD; ` +
        'the preview below is computed from that, not from your checkout.'
    );
  }

  const openPrs = ghJson(
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '50',
    '--json',
    'number,title'
  );
  if (openPrs.length > 0) {
    warn(
      `${openPrs.length} open PR(s). ${RELEASE_BRANCH} must stay frozen until the version-bump PR ` +
        'merges: the publish gate compares the tree against the tag and refuses a tarball that ' +
        'carries anything else.'
    );
    for (const pr of openPrs) console.warn(`    #${pr.number}  ${pr.title}`);
  } else {
    note(
      `no open PRs. Keep ${RELEASE_BRANCH} frozen until the version-bump PR merges - the publish ` +
        'gate compares the tree against the tag.'
    );
  }

  return { remoteHead, tags: remoteTags() };
}

/**
 * What `git describe --tags --abbrev=0` reports on the runner: the nearest tag reachable
 * from origin/main among the REMOTE's tags. Local-only tags are excluded by name so they
 * cannot shorten the commit range the release type is computed from.
 */
function lastRemoteTag(tags) {
  // Only names the argument guard will accept as an `--exclude=` value; a stranger name
  // would make the guard refuse the whole describe, which is worse than not excluding it.
  const localOnly = git('tag', '--list')
    .split('\n')
    .filter(tag => tag && !tags.has(tag) && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(tag));
  if (localOnly.length > 0) {
    note(
      `ignoring ${localOnly.length} local-only tag(s) the runner will not see: ${localOnly.join(', ')}`
    );
  }
  const excludes = localOnly.map(tag => `--exclude=${tag}`);
  const described = tryCapture('git', [
    'describe',
    '--tags',
    '--abbrev=0',
    ...excludes,
    REMOTE_HEAD
  ]);
  return described?.trim() || null;
}

function buildPreview(options, { remoteHead, tags }) {
  const lastTag = lastRemoteTag(tags);
  const range = lastTag ? data(`${lastTag}..${REMOTE_HEAD}`) : REMOTE_HEAD;
  const subjects = git('log', '--format=%s', '--no-merges', range, '--')
    .split('\n')
    .filter(line => line.trim());

  const currentVersion = JSON.parse(git('show', `${REMOTE_HEAD}:package.json`)).version;
  if (!isPlainVersion(currentVersion)) {
    fail(
      `package.json on origin/${RELEASE_BRANCH} declares version "${currentVersion}", which is not a ` +
        'plain X.Y.Z. This script only previews plain versions; dispatch the workflow by hand.'
    );
  }

  const detected = detectReleaseType(subjects);
  const releaseType = options.type ?? detected.type;

  if (subjects.length === 0) {
    fail(
      `no commits since ${lastTag ?? 'the beginning'} on origin/${RELEASE_BRANCH}. The workflow ` +
        'would find nothing to release and skip every job.'
    );
  }

  let nextVersion = currentVersion;
  let collisions = [];
  if (releaseType === 'none') {
    if (!options.dryRun) {
      fail(
        `none of the ${subjects.length} commit(s) since ${lastTag ?? 'the beginning'} is ` +
          'release-worthy under the conventional-commit rules, so the workflow would skip. ' +
          'Pass --type <patch|minor|major> to force a release, or --dry-run to see what it reports.'
      );
    }
  } else {
    const resolved = resolveNextVersion(currentVersion, releaseType, tag => tags.has(tag));
    ({ version: nextVersion, collisions } = resolved);
  }

  return {
    repo: REPO,
    currentVersion,
    nextVersion,
    releaseType,
    requestedType: options.type,
    rule: options.type ? null : detected.rule,
    lastTag,
    commitCount: subjects.length,
    drivers: options.type ? [] : detected.drivers,
    collisions,
    headSha: remoteHead.slice(0, 7),
    fullSha: remoteHead,
    dryRun: options.dryRun
  };
}

async function confirm(version, options) {
  const input = { yes: options.yes, isTTY: Boolean(process.stdin.isTTY), version };
  let decision = decideConfirmation(input);

  if (!decision.proceed && !decision.reason) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(
        'Type the version to release (X.Y.Z), or anything else to abort: '
      );
      decision = decideConfirmation({ ...input, answer });
    } finally {
      rl.close();
    }
  }

  if (!decision.proceed) fail(decision.reason);
}

const listRuns = () =>
  ghJson(
    'run',
    'list',
    '--workflow',
    WORKFLOW,
    '--event',
    'workflow_dispatch',
    '--limit',
    '10',
    '--json',
    'databaseId,createdAt,status,displayTitle'
  );

/**
 * Dispatches the workflow and returns the validated id of the run it created. Two inputs
 * bind the run to this preview: `expected_sha` makes the workflow refuse if main has moved,
 * and `dispatch_id` goes into the run name so the run can be found exactly.
 */
async function dispatch(releaseType, dryRun, expectedSha) {
  const dispatchId = randomUUID();
  const args = ['workflow', 'run', WORKFLOW, '--ref', RELEASE_BRANCH];
  args.push('-f', data(`release_type=${releaseType}`));
  args.push('-f', data(`expected_sha=${expectedSha}`));
  args.push('-f', data(`dispatch_id=${dispatchId}`));
  if (dryRun) args.push('-f', 'dry_run=true');
  const { stdout, stderr } = ghAll(...args);
  console.log(
    `Dispatched ${WORKFLOW} on ${RELEASE_BRANCH} with release_type=${releaseType}${dryRun ? ' dry_run=true' : ''} ` +
      `expected_sha=${expectedSha.slice(0, 7)} dispatch_id=${dispatchId}.`
  );

  // gh prints the created run's URL when the API returns it; that is the exact match.
  const fromUrl = parseRunUrl(`${stdout}\n${stderr}`);
  if (fromUrl) return assertRunId(fromUrl);

  // Otherwise the run name carries the dispatch id: still exact, just not immediate.
  note('gh did not report the run URL; looking for the run named with this dispatch id.');
  const deadline = Date.now() + POLL_WINDOW_MS;
  for (;;) {
    const run = selectRun(listRuns(), dispatchId);
    if (run) return assertRunId(run.databaseId);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
  }

  fail(
    `the run did not appear within ${POLL_WINDOW_MS / 1000} s. It was dispatched; find it with ` +
      `\`gh run list --repo ${REPO} --workflow=${WORKFLOW}\` and watch it with \`gh run watch <id>\`.`
  );
}

function report(runId, preview, tagsBefore) {
  const { conclusion, url } = ghJson('run', 'view', data(runId), '--json', 'conclusion,url');
  console.log('');
  console.log(`Run ${runId} finished: ${conclusion}`);
  console.log(`  ${url}`);

  if (conclusion !== 'success') {
    fail(`the release run did not succeed (${conclusion}). Inspect it at the URL above.`);
  }

  if (preview.dryRun) {
    console.log('');
    console.log('Dry run only: no tag, GitHub Release or version-bump PR was created.');
    console.log(
      'The computed version and changelog preview are in the run summary at the URL above.'
    );
    return;
  }

  // The version the workflow actually tagged, not the one the preview expected.
  const released = resolveReleasedVersion(tagsBefore, remoteTags(), preview.nextVersion);
  const version = released.version;
  const label = released.source === 'tag' ? '' : ' (expected - no new tag seen on the remote yet)';
  const tag = `v${version}`;
  const branch = `chore/release/${tag}`;

  console.log('');
  console.log(`Version:  ${version}${label}`);
  const releaseUrl = tryCapture(
    'gh',
    pinned(['release', 'view', tag, '--json', 'url', '-q', '.url'])
  );
  console.log(
    releaseUrl
      ? `Release:  ${releaseUrl.trim()}`
      : `Release:  ${tag} not found - check the run summary and \`gh release list --repo ${REPO} --limit 3\`.`
  );

  const prs = ghJson(
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'all',
    '--limit',
    '1',
    '--json',
    'number,url'
  );
  console.log(
    prs.length > 0
      ? `Bump PR:  #${prs[0].number}  ${prs[0].url}`
      : `Bump PR:  none open for ${branch} yet.`
  );

  const today = new Date().toISOString().slice(0, 10);
  console.log('');
  console.log('Next steps:');
  console.log(
    `  1. On the bump PR, edit CHANGELOG.md: \`## [Unreleased]\` -> \`## [${version}] - ${today}\``
  );
  console.log(
    '     (add a fresh empty `## [Unreleased]` above it), and update the compare link at the bottom.'
  );
  console.log('  2. Merge the bump PR. That push to main is what runs npm-publish.yml.');
  console.log(`  3. Verify:  npm view ${PACKAGE_NAME} version        # must report ${version}`);
  console.log(`              npm view ${PACKAGE_NAME}@${version} dist.attestations`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error('');
    console.error(usage());
    process.exit(2);
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const state = checkPreconditions();
  const preview = buildPreview(options, state);

  console.log('');
  console.log(renderPreview(preview));
  console.log('');

  if (!options.dryRun) await confirm(preview.nextVersion, options);

  const runId = await dispatch(options.type ?? 'auto', options.dryRun, preview.fullSha);
  console.log(`Watching run ${runId} ...`);
  console.log('');

  inherit('gh', pinned(['run', 'watch', data(runId), '--exit-status']));
  report(runId, preview, state.tags);
}

// Compare as file URLs: process.argv[1] is a plain filesystem path while import.meta.url is
// percent-encoded, so a hand-built `file://` + path string fails to match whenever the
// checkout contains a space (and on Windows), and main() would be skipped silently.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
