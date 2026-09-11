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
 * What it previews is origin/main, not the local checkout: the workflow is dispatched with
 * `--ref main`, so the runner checks out origin/main's HEAD, and that is the commit the tag
 * will point at. A local `main` that is behind or ahead is reported as a warning, because
 * it means the preview and the operator's mental model can disagree.
 *
 * This file is the CLI only: preconditions, subprocess plumbing, the prompt, the dispatch
 * and the watch. Every decision - flag parsing, the release-type rules, the version bump,
 * run selection, the preview text - is a pure function in scripts/lib/release-plan.mjs,
 * unit tested in test/unit/release-script.test.js. Every subprocess is spawned with an
 * argument array - never a shell string - and every value read back from gh or git is data.
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import {
  WORKFLOW,
  RELEASE_BRANCH,
  PLAIN_VERSION,
  parseArgs,
  detectReleaseType,
  resolveNextVersion,
  selectRun,
  renderPreview,
  usage
} from './lib/release-plan.mjs';

const REMOTE_HEAD = `refs/remotes/origin/${RELEASE_BRANCH}`;
const PACKAGE_NAME = '@egarcia74/warp-sql-server-mcp';

/** How long to wait for the dispatched run to appear in `gh run list`. */
const POLL_INTERVAL_MS = 3_000;
const POLL_ATTEMPTS = 20;

/**
 * The run is matched by creation time against the local clock, and the two clocks are not
 * the same clock. Selecting from a little before the dispatch keeps a slow local clock
 * from hiding the run; the pre-dispatch snapshot of run ids keeps that slack from picking
 * up an older run instead.
 */
const CLOCK_SKEW_MS = 15_000;

// ---------------------------------------------------------------------------------------
// Subprocesses
// ---------------------------------------------------------------------------------------

/**
 * Every dash-prefixed argument this file passes to either tool. A value that arrives from
 * outside - a tag name from `git describe`, a run id from `gh run list` - is data, and if
 * it started with a dash the tool would read it as an option. Checking at the boundary
 * keeps that guarantee in one place instead of at each call site.
 */
const ALLOWED_FLAGS = {
  git: new Set([
    '--is-inside-work-tree',
    '--quiet',
    '--tags',
    '--verify',
    '--short',
    '--format=%s',
    '--no-merges',
    '--abbrev=0',
    '--'
  ]),
  gh: new Set([
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

function guard(command, args) {
  const offending = args.filter(
    arg => typeof arg !== 'string' || (arg.startsWith('-') && !ALLOWED_FLAGS[command].has(arg))
  );
  if (offending.length > 0) {
    throw new Error(`refusing to pass ${JSON.stringify(offending)} to ${command} as an argument`);
  }
}

class CommandError extends Error {
  constructor(command, args, result) {
    super(
      result.error
        ? `${command} could not be started: ${result.error.message}`
        : `${command} ${args.join(' ')} exited ${result.status}${result.stderr?.trim() ? `\n${result.stderr.trim()}` : ''}`
    );
    this.command = command;
    this.status = result.status;
    this.notFound = result.error?.code === 'ENOENT';
  }
}

/** Runs `command` with `args` and returns its stdout; throws a CommandError otherwise. */
function capture(command, args) {
  guard(command, args);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new CommandError(command, args, result);
  return result.stdout;
}

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
function inherit(command, args) {
  guard(command, args);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw new CommandError(command, args, result);
  return result.status;
}

const git = (...args) => capture('git', args).trim();
const gh = (...args) => capture('gh', args);
const ghJson = (...args) => JSON.parse(gh(...args));

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
    gh('auth', 'status');
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
    git('fetch', '--quiet', '--tags', 'origin', RELEASE_BRANCH);
  } catch (error) {
    fail(`could not fetch origin/${RELEASE_BRANCH}.\n${error.message}`);
  }

  const remoteHead = git('rev-parse', REMOTE_HEAD);
  const localHead = tryCapture('git', [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${RELEASE_BRANCH}`
  ])?.trim();

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

  return { remoteHead };
}

function buildPreview(options, remoteHead) {
  const lastTag =
    tryCapture('git', ['describe', '--tags', '--abbrev=0', REMOTE_HEAD])?.trim() || null;
  const range = lastTag ? `${lastTag}..${REMOTE_HEAD}` : REMOTE_HEAD;
  const subjects = git('log', '--format=%s', '--no-merges', range, '--')
    .split('\n')
    .filter(line => line.trim());

  const currentVersion = JSON.parse(git('show', `${REMOTE_HEAD}:package.json`)).version;
  if (!PLAIN_VERSION.test(currentVersion)) {
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
    const tagExists = tag =>
      tryCapture('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]) !== null;
    ({ version: nextVersion, collisions } = resolveNextVersion(
      currentVersion,
      releaseType,
      tagExists
    ));
  }

  return {
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
    dryRun: options.dryRun
  };
}

async function confirm(version, options) {
  if (options.yes) return true;

  if (!process.stdin.isTTY) {
    console.error(
      'stdin is not a terminal, so the version cannot be typed back. Re-run from a terminal, ' +
        'or pass --yes to skip the confirmation.'
    );
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      'Type the version to release (X.Y.Z), or anything else to abort: '
    );
    return answer.trim() === version;
  } finally {
    rl.close();
  }
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
    '5',
    '--json',
    'databaseId,createdAt,status'
  );

async function dispatchAndFind(releaseType, dryRun) {
  const before = new Set(listRuns().map(run => run.databaseId));
  const dispatchedAt = Date.now();

  const args = [
    'workflow',
    'run',
    WORKFLOW,
    '--ref',
    RELEASE_BRANCH,
    '-f',
    `release_type=${releaseType}`
  ];
  if (dryRun) args.push('-f', 'dry_run=true');
  gh(...args);
  console.log(
    `Dispatched ${WORKFLOW} on ${RELEASE_BRANCH} with release_type=${releaseType}${dryRun ? ' dry_run=true' : ''}.`
  );

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const run = selectRun(listRuns(), dispatchedAt - CLOCK_SKEW_MS, before);
    if (run) return run;
    await sleep(POLL_INTERVAL_MS);
  }

  fail(
    `the run did not appear within ${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000} s. It was ` +
      `dispatched; find it with \`gh run list --workflow=${WORKFLOW}\` and watch it with \`gh run watch <id>\`.`
  );
}

function report(run, preview) {
  const id = String(run.databaseId);
  if (!/^\d+$/.test(id))
    fail(`gh returned a run id that is not a number: ${JSON.stringify(run.databaseId)}`);

  const { conclusion, url } = ghJson('run', 'view', id, '--json', 'conclusion,url');
  console.log('');
  console.log(`Run ${id} finished: ${conclusion}`);
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

  const version = preview.nextVersion;
  const tag = `v${version}`;
  const branch = `chore/release/${tag}`;

  console.log('');
  const releaseUrl = tryCapture('gh', [
    'release',
    'view',
    tag,
    '--json',
    'url',
    '-q',
    '.url'
  ])?.trim();
  console.log(
    releaseUrl
      ? `Release:  ${releaseUrl}`
      : `Release:  ${tag} not found - the workflow may have chosen another version or skipped; ` +
          'check the run summary and `gh release list --limit 3`.'
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

  console.log('');
  console.log('Next steps:');
  console.log(
    `  1. On the bump PR, edit CHANGELOG.md: \`## [Unreleased]\` -> \`## [${version}] - ${new Date().toISOString().slice(0, 10)}\``
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

  const { remoteHead } = checkPreconditions();
  const preview = buildPreview(options, remoteHead);

  console.log('');
  console.log(renderPreview(preview));
  console.log('');

  if (!options.dryRun) {
    const confirmed = await confirm(preview.nextVersion, options);
    if (!confirmed) fail('aborted - nothing was dispatched.');
  }

  const releaseType = options.type ?? 'auto';
  const run = await dispatchAndFind(releaseType, options.dryRun);
  console.log(`Watching run ${run.databaseId} ...`);
  console.log('');

  inherit('gh', ['run', 'watch', String(run.databaseId), '--exit-status']);
  report(run, preview);
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
