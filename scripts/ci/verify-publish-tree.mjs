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

/** Held to the version bump exactly: nothing in them may differ but the version. */
const BUMP_FILES = ['package.json', 'package-lock.json'];

/**
 * Allowed to differ freely. CHANGELOG.md documents the release being published and is
 * committed separately from the bump, so it legitimately moves inside the window.
 */
const RELEASE_FILES = ['CHANGELOG.md'];

/**
 * Serialise with object keys sorted, so a re-ordered but otherwise identical file is
 * not reported as a change. Re-ordering keys cannot alter what npm installs; treating
 * it as divergence would only train maintainers to bypass this gate.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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

// stderr is piped rather than inherited throughout so a failed child surfaces through
// the thrown error's message alone, instead of also printing a raw `fatal: ...` line
// that reads as an unhandled crash next to this script's own diagnostics.
const CAPTURE = {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe']
};

/** Reads blobs and diffs out of a real repository. */
export function gitReader(cwd = process.cwd()) {
  const run = args => execFileSync('git', args, { cwd, ...CAPTURE });
  return {
    /** [{ status, file }] between `tag` and HEAD; status is git's A/M/D/R letter. */
    changes: tag =>
      run(['diff', '--name-status', tag, 'HEAD'])
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [status, ...paths] = line.split('\t');
          // A rename reports both paths; the destination is what exists at HEAD.
          return { status: status[0], file: paths[paths.length - 1] };
        }),
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
      ...CAPTURE
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
export function verifyPublishTree(version, git, readPackedFiles) {
  const tag = `v${version}`;
  const problems = [];
  const notices = [];

  let changes;
  try {
    changes = git.changes(tag);
  } catch (error) {
    // A tag this check cannot resolve is a tag it cannot vouch for. Refuse rather
    // than skipping quietly - a gate that reports clean on what it never compared is
    // the failure mode this script exists to prevent.
    return {
      ok: false,
      tag,
      notices,
      problems: [{ kind: 'unresolvable-tag', tag, message: String(error.message ?? error) }]
    };
  }

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
      continue;
    }
    if (canonical(withVersion(tagged, file, version)) !== canonical(head)) {
      problems.push({ kind: 'unexpected-change', file });
    }
  }

  const others = changes.filter(
    change => !BUMP_FILES.includes(change.file) && !RELEASE_FILES.includes(change.file)
  );

  if (others.length > 0) {
    let packed;
    try {
      packed = readPackedFiles();
    } catch (error) {
      // Without the packlist there is no way to tell a tarball-affecting change from a
      // harmless one, and guessing in the permissive direction is what this gate is
      // for. Treat every difference as packed.
      problems.push({ kind: 'unknown-packlist', message: String(error.message ?? error) });
      packed = null;
    }

    // A deletion cannot be looked up in HEAD's packlist because the path is gone;
    // whether it used to be packed is unknowable from here, so assume it was.
    const affectsTarball = change =>
      packed === null || change.status === 'D' || packed.has(change.file);

    const shipped = others.filter(affectsTarball).map(change => change.file);
    const unshipped = others.filter(change => !affectsTarball(change)).map(change => change.file);

    if (shipped.length > 0) problems.push({ kind: 'foreign-packed-files', files: shipped });
    if (unshipped.length > 0) notices.push({ kind: 'foreign-unpacked-files', files: unshipped });
  }

  return { ok: problems.length === 0, tag, problems, notices };
}

/** Renders one problem or notice as the operator-facing line explaining it. */
export function describeProblem(problem) {
  const list = files => `\n    ${files.join('\n    ')}`;
  switch (problem.kind) {
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
  const version = process.argv[2] ?? JSON.parse(gitReader().show('HEAD', 'package.json')).version;
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
