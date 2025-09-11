# Git Release Checklist

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

Trigger from GitHub UI

- Actions → Release Automation → Run workflow
  - release_type: `auto` (or override)
  - dry_run: `false`
  - create_version_pr: `true` (default)

Trigger via GitHub CLI

- `gh workflow run release.yml -f release_type=auto -f dry_run=false`

What the workflow does

- Runs tests/lint, generates changelog
- Bumps version locally and resolves tag collisions (auto-increments patch if tag exists)
- Pushes tag and creates GitHub Release
- Opens a version-bump PR `chore/release/vX.Y.Z` to update `package.json` (branch-protection‑friendly)
- Dry runs skip tag/Release but show version + changelog preview

If checks are stuck on the version-bump PR

- Approve and run workflows for bot PRs in the PR banner; or
- Push a tiny commit to the PR branch to trigger CI (`git commit --allow-empty ...`)

## 📝 Manual Release (fallback)

1. Update CHANGELOG.md and `package.json` version

- Edit `CHANGELOG.md` ([WARP.md] Release Process details)
- `npm version <patch|minor|major>` (no tag push)

1. Tag and GitHub Release

- `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- `git push origin vX.Y.Z`
- `gh release create vX.Y.Z --title "Release vX.Y.Z" --notes-file <generated-notes.md>`

1. Open version bump PR if needed

- Branch: `chore/release/vX.Y.Z`
- Include `package.json` and CHANGELOG updates

## 📦 Publish to npm (optional)

- Preview: `npm publish --dry-run`
- Publish: `npm publish --access public` (add `--otp <CODE>` if 2FA)

## 🔍 Post-Release

- [ ] Verify Release page artifacts and notes
- [ ] Merge `chore/release/vX.Y.Z` PR to sync `package.json`
- [ ] Docs: confirm site updated, fix links if needed
- [ ] Monitor errors/issues after release

## 🧯 Rollback Plan

- If a release is bad: create `vX.Y.Z-hotfix` branch, revert problematic commit(s), run a patch release `vX.Y.(Z+1)`
- If npm publish needs yanking: deprecate the version (`npm deprecate <pkg>@<ver> "message"`)

## ℹ️ Notes about Automation

- `release_type=auto` respects conventional commits and treats `docs:`/`chore:` as patch
- Tag collision avoidance is built-in (keeps bumping patch until a free tag exists)
- `package.json` is not committed on `main` by the workflow; the version-bump PR keeps `main` in sync while honoring branch protection
