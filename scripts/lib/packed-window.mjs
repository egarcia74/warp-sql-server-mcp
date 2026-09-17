/**
 * Decides whether a release window changes anything npm actually ships.
 *
 * ## Why this exists
 *
 * `release.yml` picks a release type from conventional-commit **subject prefixes**. A prefix is a
 * label the PR author chooses; it says nothing about which files the diff touched. So the decision
 * is unsound in the dangerous direction - a window can change what `npm install` delivers while
 * classifying as something that ships nothing, and a `feat:` touching only `test/` computes a minor
 * and ships nothing at all. #1234 removed the exposure by mapping every recognised type to at least
 * a patch, i.e. by abandoning the distinction rather than measuring it. This module measures it
 * (#1235): intersect the window's changed paths with npm's own packlist, and refuse to release when
 * nothing packed changed.
 *
 * ## Why the rules live here and not in the adapters
 *
 * `WARP.md` is explicit that the release rules exist in exactly one place, because three
 * transcriptions is how #1158 happened. The path rule is that one place: both the CI classifier and
 * `npm run release`'s local preview import `shipsToConsumers` and only supply I/O. It is a separate
 * module from `release-plan.mjs` purely for layering - `release-plan.mjs` promises to be pure, and
 * the pieces below are shared with `scripts/ci/verify-publish-tree.mjs`, which spawns.
 *
 * Everything here takes plain values and returns plain values. Nothing in this file spawns a
 * process or touches the filesystem, so it is unit testable without a repository.
 *
 * ## Measured against history
 *
 * Replayed over the 26 release windows that `git describe --tags --abbrev=0` actually produces
 * (29 `v*` tags, of which 27 are reachable from `main` - `v1.5.0` and `v1.7.7` tag commits that are
 * not on the mainline, so `describe` can never return them - less `v1.2.0`, which has no base):
 * **2 windows would have been refused**, `v1.7.8..v1.7.9` and `v1.7.9..v1.7.10`. Both shipped
 * nothing to consumers. Using HEAD's packlist instead of each window's own gives 3; the extra one,
 * `v1.6.1..v1.6.2`, genuinely shipped, because at `v1.6.2` there was no `files` array and no
 * `.npmignore`, so `.github/` was published.
 *
 * **This measurement expires.** The `files` allowlist has changed three times already (absent, then
 * `.npmignore`, then `files: ["docs/*.md", ...]` at v1.7.15, then `docs/**\/*.md` plus a negation at
 * v2.0.0). Re-run the replay before relying on these numbers, and derive the packlist at each
 * window's end commit rather than at HEAD.
 */

/** Written by the release process itself, so it never counts as a shipping change. */
const RELEASE_FILES = new Set(['CHANGELOG.md']);

/** npm forcibly includes this one, so a version-only bump would otherwise mask an empty window. */
const MANIFEST = 'package.json';

/**
 * Files that decide what npm packs, and therefore change the tarball without appearing in it.
 *
 * Intersecting changed paths with the FINAL packlist misses these entirely: editing a nested
 * `.gitignore` or `.npmignore` can add or remove files whose own paths never changed, so the
 * window ships different bytes while every changed path is unpacked. `package.json` is handled
 * separately because it is itself packed and needs the version-only exemption; its `files` array
 * is the third packlist control and is covered by that same path.
 *
 * Matched on basename at any depth, because npm honours these per directory.
 */
const PACKLIST_CONTROL = new Set(['.npmignore', '.gitignore']);

/** Whether a path controls what npm packs, at any depth. */
function controlsPacklist(file) {
  return PACKLIST_CONTROL.has(file.split('/').pop());
}

/**
 * Paths npm never puts in a tarball, whatever `files` says.
 *
 * These need their own case because `removesSomething` short-circuits ahead of packlist
 * membership: a deleted path cannot be looked up in a packlist built from the worktree, so a
 * removal is normally ASSUMED to have shipped. That assumption is right for an ordinary file and
 * wrong for these, which were never in the tarball in any era - so deleting one would otherwise
 * read as a shipping change.
 *
 * Mirrors `npm-packlist/lib/index.js` (npm 11.12.1): the four lockfiles in its `strict` rules,
 * which are root-anchored, plus the entries of its `defaults` list that are stable enough to
 * enumerate. `.npmignore`/`.gitignore` are in that list too but are deliberately NOT here -
 * they control what gets packed, so `controlsPacklist` claims them first.
 *
 * Deliberately a predicate rather than a Set: npm anchors some of these to the package root and
 * others at any depth, and collapsing that distinction is what made the first version of this
 * wrong for a `yarn.lock` inside a packed directory.
 */
function neverPacked(file) {
  const base = file.split('/').pop();

  // Anchored to the package root by a leading `/` in npm's list.
  const ROOT_ONLY = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    '.lock-wscript'
  ]);
  if (ROOT_ONLY.has(file)) return true;
  if (file.startsWith('.wafpickle-')) return true;
  if (file === 'build/config.gypi' || file.startsWith('archived-packages/')) return true;

  // No leading `/` in npm's list, so these match at ANY depth - `npm-debug.log` included, which
  // an earlier version of this function got wrong by grouping it with the root-anchored entries.
  if (base === 'npm-debug.log' || base === '.npmrc' || base === '.DS_Store') return true;
  if (base.startsWith('._') || base.endsWith('.orig')) return true;

  return /^\..*\.swp$/.test(base);
}

/**
 * Content equality that ignores object key order, since re-ordering keys cannot alter
 * what npm installs and reporting it as divergence would only train maintainers to
 * bypass the gates that use this.
 *
 * Compared structurally rather than by sorting keys into a canonical string. Sorting
 * needs a comparator, and both available spellings are worse: the default one orders by
 * code unit but is flagged, and `localeCompare` can rank two distinct keys as equal -
 * `"ä"` against `"ä"`, say - leaving their relative order to fall out of
 * whichever order they happened to arrive in, so two files with identical content could
 * canonicalise differently and fail the gate. Comparing key sets sidesteps the question.
 *
 * JSON has no cycles, no NaN and no undefined values, so a plain recursive walk is total
 * over what JSON.parse can return.
 */
export function sameContent(left, right) {
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
export function withVersion(parsed, file, version) {
  const next = { ...parsed, version };
  if (file === 'package-lock.json' && next.packages?.['']) {
    next.packages = { ...next.packages, '': { ...next.packages[''], version } };
  }
  return next;
}

/**
 * Whether a change removes a path from the tree.
 *
 * A path that no longer exists cannot be looked up in a packlist, which npm builds from the
 * worktree, so whether it used to be packed is unknowable and is assumed. That covers a deletion
 * and equally a rename: a rename whose destination is unpacked still removes its source from the
 * tarball, so consulting the destination alone would report a move of a shipped file out of the
 * package as harmless.
 *
 * `T` (typechange) counts too: npm omits symlinks from the tarball, so a packed regular file
 * replaced by a symlink leaves the package even though the path still exists and the packlist
 * built from the worktree no longer lists it.
 *
 * Handles both shapes git reports: a one-letter status from `diff --name-status`, and a
 * two-character porcelain code from `status --porcelain=v1`.
 */
export function removesSomething(status) {
  return status.includes('D') || status.includes('T') || status.startsWith('R');
}

/**
 * Whether the window's `package.json` differs only by its `version` field.
 *
 * This is the non-obvious half of the rule and it is load-bearing. npm forcibly packs
 * `package.json` (npm-packlist's `strict` rules contain `!/package.json`), and `release.yml` pushes
 * the tag *before* the version-bump PR merges - so the previous release's bump lands inside the
 * next window. Counting that as a shipping change would make the gate pass on every post-release
 * window automatically, which is exactly the case it exists to catch. Measured: across the 26
 * historical windows `package.json` changed in 24, version-only in 8.
 *
 * Reconstructed rather than matched line-by-line, because a lockfile-only dependency bump's changed
 * lines are also spelled `"version": ...`.
 *
 * The version comes from `after` - the window's END manifest, which is `HEAD` for the CI classifier
 * and `origin/main` for the local preview. It is never the version being published: the tagged
 * manifest lags a full release, so at `v1.7.9..v1.7.10` the tagged file says `1.7.6` and the end
 * file says `1.7.9`, never `1.7.10`. `verify-publish-tree.mjs` calls `withVersion` with the version
 * being published because it is answering a different question; do not "fix" this to match it, or
 * the comparison never holds and the rule silently stops firing.
 */
function isVersionOnlyManifestChange(before, after) {
  if (!before || !after) return false;
  return sameContent(withVersion(before, MANIFEST, after.version), after);
}

/** Whether one change reaches the tarball. Only reached once `packed` is known to be a Set. */
function shipsChange(change, packed) {
  // A rename does two things - it removes its SOURCE from the tarball and adds its DESTINATION -
  // and the two must be judged separately. Testing only `change.file` (the destination) against
  // `neverPacked` would refuse `README.md -> yarn.lock`, where a packed file genuinely left the
  // tarball even though nothing arrived in its place.
  const source = change.from ?? change.file;

  // The removal half. A removed path cannot be looked up in a packlist built from the worktree, so
  // it is assumed to have been packed - except for the lockfiles npm excludes unconditionally,
  // where the answer is known and does not depend on the packlist we can see.
  const removesPacked = removesSomething(change.status) && !neverPacked(source);

  // The addition half, plus either end controlling what gets packed at all.
  const addsPacked = packed.has(change.file);

  return removesPacked || addsPacked || controlsPacklist(change.file) || controlsPacklist(source);
}

/**
 * Decides whether a release window ships anything to consumers.
 *
 * @param {object} input
 * @param {Array<{status: string, file: string, from?: string}>} input.changes - as
 *   `gitReader().changes(tag)` returns them. `--name-status -z`, never `--name-only`: the latter
 *   loses deletions-versus-renames and C-quotes non-ASCII paths, which then match nothing.
 * @param {Set<string>|null} input.packed - npm's packlist, or null when it could not be derived
 * @param {object|null} input.manifestBefore - parsed `package.json` at the window's start
 * @param {object|null} input.manifestAfter - parsed `package.json` at the window's end
 * @returns {{ships: boolean, shipped: string[], unshipped: string[], reason: string}}
 *
 * Fail-open is deliberate and is the OPPOSITE polarity to `verify-publish-tree.mjs`. There, an
 * underivable packlist means "assume everything is packed" and refuse, because an npm publish
 * cannot be undone. Here it means "assume the window ships" and allow, because a wrongly blocked
 * release is simply re-dispatched. Same conservatism, opposite direction.
 */
export function shipsToConsumers({ changes, packed, manifestBefore, manifestAfter }) {
  if (!packed) {
    return { ships: true, shipped: [], unshipped: [], reason: 'unknown-packlist' };
  }

  const dropManifest = isVersionOnlyManifestChange(manifestBefore, manifestAfter);

  // Both exemptions apply to a file being EDITED, never to one being removed. Deleting or renaming
  // CHANGELOG.md away changes the tarball just as deleting any other packed file does, and the
  // version-only reasoning cannot hold for a manifest that no longer exists. Filtering before
  // `shipsChange` would drop the change before its deletion handling ever ran, so the window would
  // report `nothing-packed` while shipping different bytes - the same shape as the
  // packlist-control gap.
  const exempt = change =>
    !removesSomething(change.status) &&
    (RELEASE_FILES.has(change.file) || (change.file === MANIFEST && dropManifest));

  const candidates = changes.filter(change => !exempt(change));

  const name = change => (change.from ? `${change.from} -> ${change.file}` : change.file);
  const shipped = candidates.filter(change => shipsChange(change, packed)).map(name);
  const unshipped = candidates.filter(change => !shipsChange(change, packed)).map(name);

  return {
    ships: shipped.length > 0,
    shipped,
    unshipped,
    reason: shipped.length > 0 ? 'ships' : 'nothing-packed'
  };
}
