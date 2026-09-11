# Git Release Checklist

> **Audience**: Maintainers cutting a release
>
> This checklist standardizes how we cut releases and publish artifacts.
> It complements the Commit and Push checklists and reflects our current
> automation in `.github/workflows/release.yml` and the Release section
> in `WARP.md`.

## 🔧 Preconditions

- [ ] On `main`, working tree clean (`git status`)
- [ ] All CI checks green on `main`
- [ ] Logged in to GitHub CLI (`gh auth status`) and npm (`npm whoami`)
- [ ] Verify `package.json` reflects the current released version; version bumps are PR’d automatically after release

## ✅ Quality Gates (local)

- [ ] Full pipeline: `npm run ci`
- [ ] Security audit: `npm run security:audit`
- [ ] Docs regenerated if needed: `npm run docs:build`

## 🧮 Choose Release Type

- Auto (conventional commits): `feat:` → minor, `fix:` → patch, `BREAKING CHANGE`/`!:` → major, `docs:`/`chore:` → patch
- Manual override: choose `patch | minor | major | prerelease`

## 🚀 Preferred: Automated Release Workflow

Trigger with the release script (`scripts/release.mjs`)

1. Preview: `npm run release:dry`
   - Checks `gh` is authenticated, pins every `gh` call to the repository remote `origin` names,
     fetches `origin/main` and the remote's tags, warns if local `main` differs from it
     (the workflow releases `origin/main`'s HEAD, not your checkout) and warns about open PRs -
     `main` must stay frozen until the bump PR merges, because the publish gate compares the tree
     against the tag.
   - Prints the version it expects (`current -> next`), the release type and the commit subjects
     that decided it, using the same conventional-commit rules as `release.yml`, then dispatches the
     workflow with `dry_run=true` and watches it. Nothing is tagged.
2. Release: `npm run release`
   - Same preview, then the prompt `Type the version to release (X.Y.Z), or anything else to abort:`.
     It dispatches only if you type the previewed version exactly. The workflow still makes the
     final decision on the runner.
   - Watches the run, then prints the Release URL, the `chore/release/vX.Y.Z` bump PR and the
     remaining steps.
   - Override the detected type with `npm run release -- --type <patch|minor|major>`. Outside a
     terminal (CI, a pipe) add `--yes` to skip the prompt; without it the script aborts.

Trigger via GitHub CLI (what the script runs for you)

- `gh workflow run release.yml --ref main -f release_type=auto -f dry_run=false`
- `gh run watch <run-id>`
- The script also passes two optional inputs you can leave empty by hand: `expected_sha`
  (the full SHA it previewed - the workflow's first step fails if `main` has moved) and
  `dispatch_id` (a random id the workflow puts in its run name, so the script finds its run
  exactly).

Trigger from GitHub UI

- Actions → Release Automation → Run workflow
  - release_type: `auto` (or override)
  - dry_run: `false`
  - create_version_pr: `true` (default)

What the workflow does

- Runs tests/lint, generates changelog
- Bumps version locally and resolves tag collisions (auto-increments patch if tag exists)
- Pushes tag and creates GitHub Release
- Opens a version-bump PR `chore/release/vX.Y.Z` to update `package.json` and `package-lock.json` (branch-protection‑friendly)
- Dry runs skip tag/Release but show version + changelog preview

If checks are stuck on the version-bump PR

- Approve and run workflows for bot PRs in the PR banner; or
- Push a tiny commit to the PR branch to trigger CI (`git commit --allow-empty ...`)

## 📝 Manual Release (fallback)

1. Update CHANGELOG.md and `package.json` version

- Edit `CHANGELOG.md` ([WARP.md] Release Process details)
- `npm version X.Y.Z --no-git-tag-version` - bumps `package.json` and `package-lock.json`
  only. **Do not use plain `npm version <patch|minor|major>`**: it also creates a commit
  and an annotated tag, so the explicit tag step below then fails with
  `fatal: tag 'vX.Y.Z' already exists`.

1. Tag and GitHub Release

- `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- `git push origin vX.Y.Z`
- `gh release create vX.Y.Z --title "Release vX.Y.Z" --notes-file <generated-notes.md>`

1. Open version bump PR if needed

- Branch: `chore/release/vX.Y.Z`
- Include `package.json` and CHANGELOG updates

## 📦 Publish to npm

Publishing is automatic and should stay that way: merging the version-bump PR pushes `package.json`
to `main`, which triggers `.github/workflows/npm-publish.yml`. It publishes with
`--provenance` under an OIDC `id-token`, so the tarball carries a Sigstore attestation.

Order matters here — the merge is the trigger, so it comes first:

1. Merge the `chore/release/vX.Y.Z` PR. This pushes `package.json` to `main` and starts the workflow.
2. Verify it ran: `gh run list --workflow=npm-publish.yml --limit 3`
3. Verify the registry: `npm view @egarcia74/warp-sql-server-mcp version` (must report `X.Y.Z`)
4. Verify provenance: `npm view @egarcia74/warp-sql-server-mcp@X.Y.Z dist.attestations` (must be
   non-empty). Not `npm audit signatures` — from a checkout that audits the installed dependency
   tree, not the released package, and so succeeds regardless of what shipped.

**Publishing by hand is a last resort, not an option.** `npm publish --access public` produces a
release with **no** provenance attestation, which `.github/SECURITY.md` and the CHANGELOG both
advertise as present from every published version. If the workflow fails, fix the workflow. If a
manual publish is genuinely unavoidable, say so in the release notes so the missing attestation is
not a silent gap.

## 🔍 Post-Release

- [ ] Verify Release page artifacts and notes
- [ ] Confirm the `chore/release/vX.Y.Z` PR merged and the npm publish verified (see "Publish to
      npm" above — that merge is the publish trigger, not just a `package.json` sync)
- [ ] Docs: confirm site updated, fix links if needed
- [ ] Monitor errors/issues after release

## 🧯 Rollback Plan

- If a release is bad: create `vX.Y.Z-hotfix` branch, revert problematic commit(s), run a patch release `vX.Y.(Z+1)`
- If npm publish needs yanking: deprecate the version (`npm deprecate <pkg>@<ver> "message"`)

## ℹ️ Notes about Automation

- `release_type=auto` respects conventional commits and treats `docs:`/`chore:` as patch
- Tag collision avoidance is built-in (keeps bumping patch until a free tag exists)
- `package.json` is not committed on `main` by the workflow; the version-bump PR keeps `main` in sync while honoring branch protection
