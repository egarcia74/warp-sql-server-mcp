#!/usr/bin/env node
/**
 * Refuses to publish a tarball that diverges from its release tag.
 *
 * Why this exists: `npm-publish.yml` fires on a push to `main` that touches
 * `package.json`, and publishes whatever is checked out - which is `main`, not the
 * tagged tree. The tag is consulted only as an existence gate. So any pull request
 * that lands between the tag being pushed and the version-bump PR merging ships
 * inside that release's tarball, while the tag and the GitHub Release still point at
 * the earlier commit. npm does not allow republishing a version, so the divergence
 * cannot be corrected afterwards. See issue #1189.
 *
 * The obvious check - "assert HEAD is the tagged commit" - cannot work here. The
 * release deliberately tags *before* the bump: `release.yml`'s "Create Git tag
 * (without committing version bump)" step tags `main` as it stands, and `version-pr`
 * only then opens the PR that writes the new version. HEAD at publish time is
 * therefore always the bump merge commit and never the tagged commit, so that
 * assertion would fail every release.
 *
 * What is enforced instead, in two tiers, because only one of them is irreversible:
 *
 *   - **Fails** when a file that npm actually packs differs from the tagged tree by
 *     anything other than the version bump. That is the harm #1189 describes: the
 *     published artifact carries code in neither the tag nor the Release, and it can
 *     never be replaced.
 *   - **Reports** when an unpacked file differs. Nothing reaches the tarball, so
 *     failing the publish would cost a whole version number - the tag and Release
 *     already exist by this point - to protect an artifact that is not affected.
 *
 * Measured against the last eight releases before this check existed, three had
 * differences here: v1.7.20 and v1.7.19 in CHANGELOG.md alone, and v1.7.16 in
 * CHANGELOG.md plus `.markdownlint.json`. A flat "nothing but the bump files may
 * differ" rule would have blocked all three. CHANGELOG.md is landed separately during
 * the release and is legitimately part of it, so it is allowed to differ; the two
 * bump files are held to the version bump exactly; `.markdownlint.json` is unpacked
 * and so becomes a report rather than a failure.
 *
 * The bump files are checked by reconstruction rather than by matching diff lines:
 * take the tagged file, set the version to the one being published, and require the
 * result to equal HEAD's file. A line-matching check would pass a lockfile-only
 * dependency bump, whose changed lines are also spelled `"version": ...`.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * A version must look like a version before it is pasted into a git revision. Nothing
 * here is attacker-controlled today - it arrives from `package.json` on `main` or from
 * the workflow's own step output - but a value carrying a path, a space or a leading
 * dash would reach `git` as an argument, and the cost of rejecting those is one regex.
 * Deliberately narrower than full semver: this repo's tags are `v<semver>`.
 */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Held to the version bump exactly: nothing in them may differ but the version. */
const BUMP_FILES = new Set(['package.json', 'package-lock.json']);

/**
 * Allowed to differ freely. CHANGELOG.md documents the release being published and is
 * committed separately from the bump, so it legitimately moves inside the window.
 */
const RELEASE_FILES = new Set(['CHANGELOG.md']);

/**
 * Content equality that ignores object key order, since re-ordering keys cannot alter
 * what npm installs and reporting it as divergence would only train maintainers to
 * bypass this gate.
 *
 * Compared structurally rather than by sorting keys into a canonical string. Sorting
 * needs a comparator, and both available spellings are worse: the default one orders by
 * code unit but is flagged, and `localeCompare` can rank two distinct keys as equal -
 * `"\u00e4"` against `"a\u0308"`, say - leaving their relative order to fall out of
 * whichever order they happened to arrive in, so two files with identical content could
 * canonicalise differently and fail the gate. Comparing key sets sidesteps the question.
 *
 * JSON has no cycles, no NaN and no undefined values, so a plain recursive walk is total
 * over what JSON.parse can return.
 */
function sameContent(left, right) {
  if (left === right) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameContent(item, right[index]))
    );
  }

  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every(key => Object.hasOwn(right, key) && sameContent(left[key], right[key]));
  }

  return false;
}

/**
 * The tagged file as it would look after the bump: `npm version` writes the root
 * `version` in both files, plus `packages[""].version` in a lockfileVersion 2/3 lock.
 * Those are the only two places in this repo's lockfile that carry the package's own
 * version, confirmed against `package-lock.json` (lockfileVersion 3).
 */
function withVersion(parsed, file, version) {
  const next = { ...parsed, version };
  if (file === 'package-lock.json' && next.packages?.['']) {
    next.packages = { ...next.packages, '': { ...next.packages[''], version } };
  }
  return next;
}

/**
 * process.env with every GIT_* variable removed, for spawning git and npm.
 *
 * Git exports GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE to the hooks it runs, and they
 * take precedence over `cwd`. So a test that builds a throwaway repository in a temp
 * directory and spawns `git` there with the inherited environment is, when the suite
 * runs under a pre-commit hook, operating on the real repository instead: `git init`
 * re-initialises it with core.worktree pointing at the temp directory, `git config`
 * overwrites the committer identity, `git tag` creates a fake release tag and `git
 * commit` lands fixture commits on whatever branch is checked out. That happened on
 * 2026-09-11 from a linked worktree, and left the main checkout unable to run `git
 * status`. Every reader in this file locates its repository by `cwd`, so the ambient
 * variables carry no information it wants - stripping them is the whole fix.
 *
 * Exported so the test suite spawns its own git the same way.
 */
export function scrubbedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

// stderr is piped rather than inherited throughout so a failed child surfaces through
// the thrown error's message alone, instead of also printing a raw `fatal: ...` line
// that reads as an unhandled crash next to this script's own diagnostics. A function
// rather than a constant so the environment is read at spawn time, not at import.
const capture = () => ({
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: scrubbedEnv()
});

// Both readers below invoke `git` and `npm` by name, so they resolve through PATH.
// SonarQube flags this as javascript:S4036 (OS commands should not rely on PATH
// resolution), and the finding is accurate rather than a false positive - it is marked
// Accepted in SonarCloud for the same reason as scripts/check-fenced-blocks.mjs, which
// documents the identical trade-off at length.
//
// The risk is immaterial here: this runs as a step inside npm-publish.yml, after
// `npm ci` and immediately before `npm publish`. Anyone able to control PATH in that
// job already controls the `npm` that does the publishing, so resolving `git` by
// absolute path would protect nothing. An absolute path is also not portable across
// the runner images, and resolving one via `which` reintroduces the same dependency.

/** The complete set of dash-prefixed arguments this file ever passes to git. */
const GIT_ARGUMENTS = new Set(['--name-status', '-z', '--porcelain=v1', '--untracked-files=all']);

/** Reads blobs and diffs out of a real repository. */
export function gitReader(cwd = process.cwd()) {
  const run = args => {
    // Argument injection, not shell injection. execFileSync spawns git directly with no
    // shell, which is why there is nothing to say about metacharacters - and saying it
    // would answer the wrong question, because the risk here does not need a shell: a
    // value that begins with a dash is read by git itself as an option rather than as
    // the revision or path it was meant to be. That is what SonarQube's jssecurity:S8705
    // is about, and its own non-compliant example uses execFileSync too.
    //
    // Three things already prevent it, and this check is the third. `version` is matched
    // against VERSION before any git call, which is the mitigation that rule prescribes;
    // the revision is built as `v${version}`, so it cannot begin with a dash whatever
    // the version says; and every argument is checked here. The first two are invariants
    // a reader has to trace to other functions, so asserting at the boundary keeps the
    // guarantee local - and a later edit that passes something new fails loudly rather
    // than quietly handing git an option.
    const offending = args.filter(
      arg => typeof arg !== 'string' || (arg.startsWith('-') && !GIT_ARGUMENTS.has(arg))
    );
    if (offending.length > 0) {
      throw new Error(`refusing to pass ${JSON.stringify(offending)} to git as an argument`);
    }
    return execFileSync('git', args, { cwd, ...capture() });
  };
  return {
    /**
     * [{ status, file, from? }] between `tag` and HEAD; status is git's A/M/D/R letter.
     * A rename reports both paths: `file` is the destination, which is what exists at
     * HEAD, and `from` the source, which is what left the tree.
     *
     * `-z` is not optional. Without it `core.quotePath` - on by default - renders a
     * non-ASCII path as a C-quoted, escaped string: `docs/café.md` comes back as
     * `"docs/caf\303\251.md"`, which matches nothing in npm's packlist, so a changed
     * *packed* file would be silently downgraded to an unpacked notice. Measured, not
     * assumed. `-z` emits raw pathnames NUL-terminated instead, which also removes any
     * question of tabs or newlines inside a filename.
     */
    changes: tag => {
      // Fields run `<status>\0<path>\0`, except a rename or copy, which carries
      // `<status>\0<source>\0<destination>\0`. The trailing NUL leaves a final empty.
      const fields = run(['diff', '--name-status', '-z', tag, 'HEAD']).split('\0');
      const changes = [];
      let index = 0;

      while (index < fields.length) {
        const status = fields[index];
        if (!status) {
          index += 1;
          continue;
        }
        const letter = status[0];

        if (letter === 'R' || letter === 'C') {
          const [from, file] = [fields[index + 1], fields[index + 2]];
          // A copy leaves its source in place, so only a rename records `from` - which
          // is what marks the change as having removed something from the tarball.
          changes.push(letter === 'R' ? { status: letter, file, from } : { status: letter, file });
          index += 3;
        } else {
          changes.push({ status: letter, file: fields[index + 1] });
          index += 2;
        }
      }

      return changes;
    },
    /**
     * [{ status, file }] for anything in the worktree that differs from HEAD, with
     * untracked files included. `git diff <tag> HEAD` compares two commits, but npm
     * packs the working directory - so an uncommitted edit, or an untracked file
     * matching the `files` globs, reaches the tarball while being invisible to a
     * commit-to-commit comparison.
     *
     * Porcelain v1 with `-z` emits `XY<space><path>\0`, and for a rename a second
     * NUL-separated field carrying the original path. `--untracked-files=all` lists
     * files individually instead of collapsing them into a directory entry.
     */
    worktreeChanges: () => {
      const fields = run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
        .split('\0')
        .filter(Boolean);
      const changes = [];
      let index = 0;

      while (index < fields.length) {
        const entry = fields[index];
        const code = entry.slice(0, 2);
        changes.push({ status: code, file: entry.slice(3) });
        // A rename carries its original path in the following field.
        index += code.startsWith('R') || code.startsWith('C') ? 2 : 1;
      }

      return changes;
    },
    show: (rev, file) => run(['show', `${rev}:${file}`])
  };
}

/**
 * The set of paths npm would actually put in the tarball, from npm's own packlist
 * rather than a reimplementation of the `files` globs - whose semantics are subtle
 * here (non-recursive patterns, a negation whose position decides whether it applies,
 * and a `files` array that nulls the root .gitignore).
 */
export function packedFilesReader(cwd = process.cwd()) {
  return () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd,
      ...capture()
    });
    return new Set(JSON.parse(out)[0].files.map(entry => entry.path));
  };
}

/**
 * Returns { ok, tag, problems, notices } for the tree at HEAD against tag `v<version>`.
 * `git` is any object shaped like gitReader() and `readPackedFiles` any function
 * returning a Set of packed paths, so this is testable without a repository and
 * usable against a real one unchanged.
 */
/**
 * Holds the two bump files to the version bump exactly. Extracted so verifyPublishTree
 * stays within the cognitive-complexity budget and so each tier reads on its own.
 */
function checkBumpFiles(version, tag, changes, git) {
  const problems = [];

  for (const file of BUMP_FILES) {
    if (!changes.some(change => change.file === file)) continue;

    let tagged, head;
    try {
      tagged = JSON.parse(git.show(tag, file));
      head = JSON.parse(git.show('HEAD', file));
    } catch (error) {
      problems.push({ kind: 'unreadable', file, message: String(error.message ?? error) });
      continue;
    }

    if (head.version !== version) {
      problems.push({ kind: 'wrong-version', file, expected: version, actual: head.version });
    } else if (!sameContent(withVersion(tagged, file, version), head)) {
      problems.push({ kind: 'unexpected-change', file });
    }
  }

  return problems;
}

/** Splits everything that is not a bump or release file into blocking and reportable. */
function classifyOtherChanges(changes, worktree, readPackedFiles) {
  const others = [...changes, ...worktree].filter(
    change => !BUMP_FILES.has(change.file) && !RELEASE_FILES.has(change.file)
  );
  if (others.length === 0) return { problems: [], notices: [] };

  const problems = [];
  let packed;
  try {
    packed = readPackedFiles();
  } catch (error) {
    // Without the packlist there is no way to tell a tarball-affecting change from a
    // harmless one, and guessing in the permissive direction is what this gate is for.
    // Treat every difference as packed.
    problems.push({ kind: 'unknown-packlist', message: String(error.message ?? error) });
    packed = null;
  }

  // A path that no longer exists at HEAD cannot be looked up in HEAD's packlist, so
  // whether it used to be packed is unknowable from here and is assumed. That covers a
  // deletion, and equally a rename: a rename whose destination is unpacked still
  // removes its source from the tarball, so consulting the destination alone would
  // report a move of a shipped file out of the package as harmless. Verified against a
  // real repository - `git mv lib/packed.js docs/notes.txt` reports `R100`, while the
  // same move after a separate modifying commit is reported as `D` plus `A`.
  // A path that is gone cannot be looked up in the packlist, which npm builds from the
  // worktree, so whether it used to be packed is unknowable here and is assumed. That
  // covers a commit-level deletion or rename and equally a worktree deletion. An
  // untracked file needs no special case: npm packs the worktree, so if it matches the
  // `files` globs the packlist already contains it.
  const removesSomething = status => status.includes('D') || status.startsWith('R');
  const affectsTarball = change =>
    packed === null || removesSomething(change.status) || packed.has(change.file);

  const name = change => (change.from ? `${change.from} -> ${change.file}` : change.file);
  const shipped = others.filter(affectsTarball).map(name);
  const unshipped = others.filter(change => !affectsTarball(change)).map(name);

  const notices = [];
  if (shipped.length > 0) problems.push({ kind: 'foreign-packed-files', files: shipped });
  if (unshipped.length > 0) notices.push({ kind: 'foreign-unpacked-files', files: unshipped });
  return { problems, notices };
}

/**
 * Returns { ok, tag, problems, notices } for the tree at HEAD against tag `v<version>`.
 * `git` is any object shaped like gitReader() and `readPackedFiles` any function
 * returning a Set of packed paths, so this is testable without a repository and
 * usable against a real one unchanged.
 */
export function verifyPublishTree(version, git, readPackedFiles) {
  const tag = `v${version}`;

  if (!VERSION.test(version)) {
    return { ok: false, tag, notices: [], problems: [{ kind: 'malformed-version', version }] };
  }

  let changes;
  try {
    changes = git.changes(tag);
  } catch (error) {
    // A tag this check cannot resolve is a tag it cannot vouch for. Refuse rather than
    // skipping quietly - a gate that reports clean on what it never compared is the
    // failure mode this script exists to prevent.
    return {
      ok: false,
      tag,
      notices: [],
      problems: [{ kind: 'unresolvable-tag', tag, message: String(error.message ?? error) }]
    };
  }

  const other = classifyOtherChanges(changes, git.worktreeChanges(), readPackedFiles);
  const problems = [...checkBumpFiles(version, tag, changes, git), ...other.problems];

  return { ok: problems.length === 0, tag, problems, notices: other.notices };
}

/** Renders one problem or notice as the operator-facing line explaining it. */
export function describeProblem(problem) {
  const list = files => `\n    ${files.join('\n    ')}`;
  switch (problem.kind) {
    case 'malformed-version':
      return `"${problem.version}" is not a version this release process produces, so no tag can be derived from it`;
    case 'unresolvable-tag':
      return `cannot resolve tag ${problem.tag} - was the checkout made with fetch-depth: 0? (${problem.message})`;
    case 'foreign-packed-files':
      return `${problem.files.length} file(s) in the npm tarball changed between the tag and this tree:${list(problem.files)}`;
    case 'foreign-unpacked-files':
      return `${problem.files.length} file(s) changed between the tag and this tree, none of them packed into the tarball:${list(problem.files)}`;
    case 'unknown-packlist':
      return `could not determine which files npm packs, so every difference is treated as shipped - ${problem.message}`;
    case 'unreadable':
      return `${problem.file} could not be read at both revisions - ${problem.message}`;
    case 'wrong-version':
      return `${problem.file} declares version ${problem.actual}, but ${problem.expected} is being published`;
    case 'unexpected-change':
      return `${problem.file} differs from the tagged file by more than the version bump`;
    default:
      return `unrecognised problem: ${JSON.stringify(problem)}`;
  }
}

function main() {
  // `??` alone would accept an empty argument - which an unset variable in the caller's
  // `run:` block expands to - and compare against a tag named just "v".
  const version = process.argv[2] || JSON.parse(gitReader().show('HEAD', 'package.json')).version;
  const { ok, tag, problems, notices } = verifyPublishTree(
    version,
    gitReader(),
    packedFilesReader()
  );

  for (const notice of notices) console.log(`::notice::${describeProblem(notice)}`);

  if (ok) {
    console.log(`Tarball for ${tag} matches the tagged tree: the version bump is the only change.`);
    return;
  }

  console.error(`::error::Refusing to publish ${version} - this tarball diverges from ${tag}.`);
  for (const problem of problems) console.error(`  - ${describeProblem(problem)}`);
  console.error(
    '\nThe tarball would contain code that is in neither the tag nor the GitHub Release,\n' +
      'and npm does not allow republishing a version. Land the version bump on a tree that\n' +
      'matches the tag, or cut a new release from the current tip.'
  );
  process.exit(1);
}

// Compare as file URLs: process.argv[1] is a plain filesystem path while
// import.meta.url is percent-encoded, so a hand-built `file://` + path string fails to
// match whenever the checkout contains a space (and on Windows), and main() would be
// skipped silently - exit 0, gate never run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
