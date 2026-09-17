#!/usr/bin/env node
/**
 * Classifies a release window's commits for `.github/workflows/release.yml`.
 *
 * Why this exists: the workflow used to carry the conventional-commit rules TWICE, once in
 * the "Check conventional commits" step (which picks the release type) and once in the
 * "Generate changelog" step (which groups the same commits for the release notes), and the
 * two had already drifted - the changelog copy matched `feat:` but not `feat(scope):`, so a
 * scoped feature counted as a minor release and was then filed under "Other Changes"
 * (#1158). A third copy lives in `npm run release`'s preview. All three now call the same
 * rules: this script is a thin CLI over `detectReleaseType()` and `groupForChangelog()` in
 * scripts/lib/release-plan.mjs, which is where the rules and the reasoning behind the
 * mapping live, and which is unit-tested in test/unit/release-script.test.js.
 *
 * Usage:
 *   node scripts/ci/classify-release-commits.mjs --from-git   # reads the window itself
 *   git log --pretty=format:'%h %s' --no-merges <range> | node scripts/ci/...
 *
 * `--from-git` uses exactly the window release.yml has always used: everything since the
 * nearest tag `git describe --tags --abbrev=0` reports, or the whole history when the
 * repository has no tag. It needs the full history, so the checkout must use fetch-depth 0.
 *
 * stdout one JSON object (see planFromLog).
 * exit   0 unless git or the input could not be read - "nothing to release" is a result,
 *        not a failure, and the caller decides what to do about it.
 *
 * Commit subjects are untrusted text: no subject is ever interpolated into a shell here
 * (git is spawned with an argument array), and a caller must pass this JSON on through
 * files or `core.setOutput`, never by echoing a subject into `$GITHUB_OUTPUT`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { gitReader, packedFilesReader } from './verify-publish-tree.mjs';
import { shipsToConsumers } from '../lib/packed-window.mjs';
import {
  describeCommitMix,
  detectReleaseType,
  groupForChangelog,
  parseCommitLines
} from '../lib/release-plan.mjs';

/** Commit logs are small, but a first release from a long history is not. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** How many example subjects a caller should name when warning about unclassified ones. */
export const MAX_EXAMPLES = 10;

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER });

/**
 * The tag the release window starts after, or null when the repository has none.
 *
 * `--match 'v[0-9]*'` because a non-`v` tag would otherwise become both the window boundary and
 * the diff base, and the path gate would then refuse a release while blaming the packlist. The
 * repository does contain one such tag, `combined-1153`, though it is local-only - `git ls-remote
 * --tags origin` does not list it, and the runner only ever sees what it fetches - so this is
 * hardening against a shape that exists rather than a live fault.
 */
export function lastTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Whether any release tag exists at all.
 *
 * `lastTag()` returning null means two different things - a repository with no tags, which is a
 * first release and a legitimate reason to skip the path check, and a `describe` that failed,
 * which is an error. Conflating them would let a shallow clone or a failed fetch masquerade as
 * "first release", skip the gate and compute a release type from the entire history. Filtered the
 * same way `--match` filters, so a repository whose only tags are non-`v` does not report "tags
 * exist" and warn on every run.
 */
export function hasReleaseTags() {
  try {
    return git(['tag', '--list', 'v[0-9]*']).trim().length > 0;
  } catch {
    return false;
  }
}

/** `<hash> <subject>` lines for the window, straight from git. */
export function readWindow(tag) {
  const args = ['log', '--pretty=format:%h %s', '--no-merges'];
  if (tag) args.push(`${tag}..HEAD`);
  return git(args);
}

/**
 * The whole decision for one window, as data:
 *
 *   commitCount   commits in the window
 *   commits       [{ hash, subject }] in commit order, for logging
 *   releaseType   major | minor | patch | none - what the workflow should bump
 *   rule          the label of the bucket that decided it, null when none did
 *   drivers       the subjects in that bucket
 *   counts        commits per rule id, plus `unclassified`
 *   unclassified  subjects no rule recognised at all
 *   summary       the same decision as one line of prose, for the log and the job summary
 *   changelog     { breaking, features, fixes, other } of { hash, text }
 *
 * Every recognised conventional-commit type releases at least a patch, so
 * `releaseType: 'none'` with `commitCount > 0` means no subject in the window matched any
 * type. That is a DIFFERENT outcome from an empty window, and `summary` is worded so the
 * two can never read alike (#1158).
 *
 * Subjects are no longer the whole story: with `--ships`, this CLI also reports whether the
 * window's PATHS reach anything npm packs, and `release.yml` refuses a window that ships
 * nothing even when its subjects classify cleanly (#1235).
 */
export function planFromLog(text) {
  const commits = parseCommitLines(text);
  const detected = detectReleaseType(commits.map(commit => commit.subject));
  const mix = describeCommitMix(detected);

  let summary;
  if (commits.length === 0) {
    summary = 'No commits in this window - nothing to release.';
  } else if (detected.type === 'none') {
    summary =
      `${commits.length} commit(s), none of them carrying a recognised conventional-commit ` +
      `type (${mix}). Nothing will be tagged or published - retitle them, or dispatch with ` +
      'an explicit release_type to force a release.';
  } else {
    summary = `${commits.length} commit(s) -> ${detected.type}, decided by ${detected.rule} (${mix}).`;
  }

  return {
    commitCount: commits.length,
    commits,
    releaseType: detected.type,
    rule: detected.rule,
    drivers: detected.drivers,
    counts: detected.counts,
    unclassified: detected.unclassified,
    summary,
    changelog: groupForChangelog(commits)
  };
}

/**
 * Whether the window ships anything npm packs, as `{ ships, shipped, unshipped, reason }`.
 *
 * Readers are injected so this is testable without a repository or npm - `git` is anything shaped
 * like `gitReader()`, `readPacked` anything returning a Set of packed paths, mirroring
 * `verifyPublishTree(version, git, readPackedFiles)`.
 *
 * TWO catches, and the split is load-bearing. A single try/catch round the whole block would turn
 * a packlist failure into `unknown-window`, `packed` would never be null, and `unknown-packlist`
 * would be produced by nothing - leaving the workflow's warning on it dead code.
 *
 * Both outcomes ship (`ships: true`): this gate can only refuse when it has actually compared
 * something. That is the opposite polarity to `verify-publish-tree.mjs`, deliberately - see
 * `shipsToConsumers`.
 */
export function windowShips({ tag, git, readPacked }) {
  if (!tag) {
    const reason = hasReleaseTags() ? 'unknown-window' : 'no-window';
    return { ships: true, shipped: [], unshipped: [], reason };
  }

  try {
    const changes = git.changes(tag);
    const manifestBefore = JSON.parse(git.show(tag, 'package.json'));
    const manifestAfter = JSON.parse(git.show('HEAD', 'package.json'));

    // INNER catch: only the packlist. A throw here - including the shape canary in
    // packedFilesReader - means "could not derive what npm packs", which shipsToConsumers turns
    // into unknown-packlist and fails open.
    let packed = null;
    try {
      packed = readPacked();
    } catch {
      packed = null;
    }

    return shipsToConsumers({ changes, packed, manifestBefore, manifestAfter });
  } catch {
    // OUTER catch: the git reads. gitReader().run throws on any non-zero git exit, and an escape
    // here would exit non-zero and fail the workflow job - violating this script's contract that
    // only an unreadable input is a failure.
    return { ships: true, shipped: [], unshipped: [], reason: 'unknown-window' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const fromGit = argv.includes('--from-git');
  const tag = fromGit ? lastTag() : null;
  const log = fromGit ? readWindow(tag) : readFileSync(0, 'utf8');
  const plan = { lastTag: tag, ...planFromLog(log) };

  // `--ships` is opt-in so only the caller that reads the verdict pays for the packlist. The
  // changelog step runs this same CLI and wants only plan.changelog, so it would otherwise spawn
  // `npm pack` for a field it never reads - and two derivations that can disagree.
  //
  // The keys below are present IFF --ships was passed. A caller that passes the flag can rely on
  // all four being there; one that does not must not read them, and must never treat an absent
  // `ships` as false.
  if (fromGit && argv.includes('--ships')) {
    Object.assign(plan, windowShips({ tag, git: gitReader(), readPacked: packedFilesReader() }));
  }

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}
