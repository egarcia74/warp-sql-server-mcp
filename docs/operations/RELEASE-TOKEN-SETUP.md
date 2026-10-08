# Release Token Setup Guide

> **Audience**: Maintainers configuring CI/CD publish credentials

## Overview

This guide explains how to set up an optional `RELEASE_TOKEN` to completely eliminate Token-Permissions security
alerts from CodeQL/Scorecard while maintaining full release automation functionality. It also covers the
other release-automation credentials: `DOCS_PAT`, `RELEASE_PR_TOKEN`, and the npm publish credential -
which, since trusted publishing, is not a token at all (see
[npm Publish Credential](#npm-publish-credential-trusted-publishing)).

## Why This Matters

CodeQL/Scorecard security scanners flag ANY `contents: write` permission as a security risk, even when it's
necessary for legitimate operations like creating tags and releases. This setup provides a more secure alternative
using fine-grained permissions.

## Current Behavior (Secure Fallback)

The release workflow is designed to work in both scenarios:

- **With RELEASE_TOKEN**: Uses fine-grained PAT for maximum security compliance
- **Without RELEASE_TOKEN**: Falls back to `GITHUB_TOKEN` (still secure, but triggers scanner alerts)

## Setting Up RELEASE_TOKEN (Optional)

### Step 1: Create a Fine-Grained Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Configure the token:
   - **Resource owner**: Your username or organization
   - **Repository access**: Selected repositories → Choose this repository only
   - **Repository permissions**:
     - Contents: **Read and write** (for tags)
     - Metadata: **Read** (for repository info)
     - Pull requests: **Read** (if needed for release notes)
   - **Account permissions**: None needed
4. Set expiration (recommend 1 year maximum)
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again)

### Step 2: Add Token to Repository Secrets

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `RELEASE_TOKEN`
4. Value: Paste the token from Step 1
5. Click "Add secret"

### Step 3: Verify Setup

The workflow uses `RELEASE_TOKEN` if available and falls back to `GITHUB_TOKEN` if not. The
selection is a bare expression - `${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}` at
the `Create Git tag` and `Create GitHub Release` steps of
`.github/workflows/release.yml`.

Because both credentials can create the tag, a successful release proves only that _one_ of
them worked; it is not evidence the PAT was picked up. The `release` job's first step
reports which way the expression will resolve:

```text
🔑 RELEASE_TOKEN configured: true
```

It prints only the boolean `secrets.RELEASE_TOKEN != ''`, never the secret.

> **This is a presence check, not a validity check.** `||` falls through only on an **empty
> string** - a secret that was never set, or set under a different name. A secret holding an
> **expired, revoked, or wrongly scoped PAT is still a non-empty string**, so the
> expression selects it, `configured: true` is reported, no fallback to `GITHUB_TOKEN`
> happens, and the release fails at tag creation. Read the two signals together:
> `configured: false` means you are definitely on `GITHUB_TOKEN`; `configured: true` plus
> an auth failure at `Create Git tag` means the PAT is present but unusable - check its
> expiry and its `Contents: Write` permission rather than assuming the fallback covered
> you.

## Security Benefits

> **⚠️ `RELEASE_TOKEN` does not remove the job's write permission.** The `release` job in
> `.github/workflows/release.yml` declares `permissions: contents: write` **unconditionally**
>
> - the declaration is static YAML and cannot depend on whether a secret is set. It is there
>   so the `GITHUB_TOKEN` fallback can push tags and create releases when no `RELEASE_TOKEN`
>   is configured. Setting `RELEASE_TOKEN` changes which credential performs those operations,
>   not what the job is granted, so Token-Permissions scanner findings on that job persist
>   either way.

### With RELEASE_TOKEN

- ✅ **Fine-grained access** limited to specific operations
- ✅ **Repository-scoped** token (not account-wide)
- ✅ **Token rotation and revocation** under your control
- ✅ **Audit separation** for the operations it authenticates: the tag **push** and the
  GitHub **Release** are performed as the PAT's owner rather than the ambient workflow
  identity. Note the limits - `RELEASE_TOKEN` creates no commit, and the git author on both
  the tag and the version-bump commit is hard-coded to `GitHub Action`
  (`user.name`/`user.email` are set in the workflow), so commit metadata is identical
  either way. The version-bump commit is a separate job authenticated by `RELEASE_PR_TOKEN`
- ⚠️ **Job permissions unchanged**: the job still declares `contents: write`

### Without RELEASE_TOKEN (Fallback)

- ✅ **Still secure** using default GitHub mechanisms
- ✅ **Zero setup required** - works out of the box
- ⚠️ **No separate identity**: operations run as the job's `GITHUB_TOKEN` - a short-lived,
  repository-scoped installation token bounded by the job's declared `permissions`. It is
  `RELEASE_TOKEN`, a personal access token, that carries the broader account-level scope
- ⚠️ **No independent rotation**: the credential's lifecycle is GitHub's, not yours

## Token Rotation

For security best practices:

1. **Rotate tokens annually** or when team members change
2. **Monitor token usage** in repository insights
3. **Revoke immediately** if compromised
4. **Use expiration dates** to enforce rotation

## Troubleshooting

### Release Workflow Fails with Authentication Error

- Verify `RELEASE_TOKEN` is correctly set in repository secrets
- Check token hasn't expired
- Ensure token has `Contents: Write` permission for the repository

### Scanner Still Shows Alerts

Expected. The `release` job declares `contents: write` whether or not `RELEASE_TOKEN` is
set, so a Token-Permissions finding on that job is accurate and will not clear by adding
the token. `release.yml` carries an inline comment recording this as a deliberate
trade-off: without the write permission, any repository lacking a `RELEASE_TOKEN` would
fail at tag creation.

To confirm the token itself is being picked up, read the `Report release credential` step's
`RELEASE_TOKEN configured:` line (see Step 3). Do **not** infer it from the tag-creation
step succeeding: `${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}` means either
credential can create the tag, so success is compatible with the PAT never having been
read.

### Token Access Issues

- Confirm token is scoped to the correct repository
- Verify repository permissions include "Contents: Read and write"
- For organization repos, ensure token has appropriate organization access

## Migration

To adopt `RELEASE_TOKEN` on a repository that currently relies on `GITHUB_TOKEN`:

1. Set up `RELEASE_TOKEN` following this guide
2. Workflow automatically detects and uses the token
3. Monitor next release to ensure functionality

The job's `contents: write` declaration stays as it is, so Token-Permissions alerts on the
`release` job will not resolve. Removing them would mean dropping the `GITHUB_TOKEN`
fallback and making `RELEASE_TOKEN` mandatory.

## Best Practices

- **Use fine-grained tokens** over classic tokens
- **Limit repository scope** to only necessary repos
- **Set reasonable expiration dates** (max 1 year)
- **Document token purpose** in your team's security procedures
- **Monitor token usage** regularly
- **Rotate tokens** when team membership changes

## Docs Automation Token (DOCS_PAT)

`DOCS_PAT` is required when generated documentation files change, so the
auto-generated PR can trigger CI/CodeQL checks. A no-diff run succeeds without
`DOCS_PAT` because it does not push a branch or create a PR.

### When required

- You run `.github/workflows/docs.yml` to auto‑update docs (tools.json/tools.html) on `main`.
- Your branch protection requires CI/CodeQL checks to run on pull requests.

### Create a fine‑grained PAT

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Choose “Fine‑grained tokens” and generate a new token with:
   - Repository access: This repository only
   - Repository permissions: Contents (read/write), Pull requests (read/write)
   - Expiration: per your policy (90 days recommended)
3. Copy the token value

### Add as a repository secret

1. Repo → Settings → Secrets and variables → Actions → New repository secret
2. Name: `DOCS_PAT`
3. Value: paste the token

### Effect in workflow

- The generator runs without a write token. Only the writer's final step receives `DOCS_PAT`
  after a changed artifact has been validated.
- If generated files change and `DOCS_PAT` is missing or invalid, the run fails; there is no
  `GITHUB_TOKEN` write fallback. A no-diff run succeeds without `DOCS_PAT`.
- If the branch push succeeds but PR creation fails, the error names the pushed branch for
  manual inspection and cleanup. The workflow does not delete it automatically.

### Rotation

- Create a new fine‑grained token before the old one expires, update the `DOCS_PAT` secret, then revoke the old token.

## Version-Bump PR Token (RELEASE_PR_TOKEN)

The release workflow creates a `chore/release/vX.Y.Z` branch and PR to bump
`package.json` and `package-lock.json` after each release. Without a PAT, this
push uses `GITHUB_TOKEN`, and GitHub's recursion guard blocks CI from running —
leaving the PR permanently blocked on required checks (`Tests (22)`,
`Tests (24)`, `CodeQL`).

### Purpose

The release workflow creates a version-bump PR to `main` after each release. Your
branch protection requires CI/CodeQL checks to run on pull requests.

### Create RELEASE_PR_TOKEN

1. Go to GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token
2. Settings:
   - Token name: `RELEASE_PR_TOKEN — warp-sql-server-mcp`
   - Repository access: This repository only
   - Repository permissions: Contents (read/write), Pull requests (read/write),
     Metadata (read — required)
   - Expiration: per your policy (1 year recommended)
3. Copy the token value

### Add token as repository secret

1. Repo → Settings → Secrets and variables → Actions → New repository secret
2. Name: `RELEASE_PR_TOKEN`
3. Value: paste the token

### How it works in the release workflow

- `release.yml` (`version-pr` job) uses `RELEASE_PR_TOKEN` to push the
  version-bump branch and open the PR. Because it is a PAT push (not a
  `GITHUB_TOKEN` push), GitHub fires the PR's CI checks normally.
- Falls back to `GITHUB_TOKEN` if the secret is missing — in that case, CI
  will not trigger automatically. Workaround: push an empty commit to the
  version-bump branch to trigger checks manually:
  ```bash
  git fetch origin chore/release/vX.Y.Z
  git checkout chore/release/vX.Y.Z
  git commit --allow-empty -m "ci: trigger CI checks"
  git push
  ```

### Token rotation

Create a new fine-grained token before the old one expires, update the
`RELEASE_PR_TOKEN` secret, then revoke the old token.

## npm Publish Credential (Trusted Publishing)

`.github/workflows/npm-publish.yml` publishes `@egarcia74/warp-sql-server-mcp` with **npm Trusted
Publishing**. The job requests a short-lived GitHub OIDC token (`permissions: id-token: write`) and
npmjs.com exchanges it for a publish credential valid for that run only when the package's
Trusted Publisher entry matches this repository, `npm-publish.yml`, and the `npm-publish`
environment. The workflow does not set an npm token. The exact environment binding and the
GitHub deployment restriction must be confirmed from live settings before relying on this policy.

**Why**: the 2.0.0 publish on 2026-09-11 failed because the `NPM_TOKEN` granular access token -
90 days maximum lifetime - had expired under the release. A trusted publisher has nothing to expire.

### Requirements

Taken from [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers):

- **npm CLI and Node**: "Trusted publishing requires npm CLI version 11.5.1 or later and Node
  version 22.14.0 or higher." The workflow pins `node-version: '24.21.0'` - an exact release, so
  the npm that runs in the credentialed job changes only by a reviewed commit - and keeps a
  fail-fast check that aborts if `npm --version` is below 11.5.1 before publishing. Bump the pin
  deliberately; the check is the floor, not the pin.
- **OIDC permission**: "The critical requirement is the `id-token: write` permission, which allows
  GitHub Actions to generate OIDC tokens." The `publish` job declares it.
- **Main-only environment**: the `publish` job requests `npm-publish`. Configure that GitHub
  environment with selected branch/tag restrictions containing one exact **branch** `main` and
  no tag patterns. Do not use "protected branches only"; it can admit other protected branches.
  The job-level main guard is useful defense in depth, but a branch can edit its own workflow.
  An environment-bound npm publisher must reject a branch that omits the environment.
- **Provenance**: "When you publish using trusted publishing from GitHub Actions or GitLab CI/CD,
  npm automatically generates and publishes provenance attestations for your package. This happens
  by default—you don't need to add the `--provenance` flag to your publish command." The workflow
  keeps `--provenance` explicit anyway; it is harmless.
- **Runners**: "Self-hosted runners are not currently supported but are planned for future
  releases." The job runs on `ubuntu-latest`.
- **Reusable workflows**: not used here, and better kept that way - npm's validation "checks the
  calling workflow's name instead of the workflow that actually contains the publish command", and
  "`id-token: write` permission must also be given to both parent and child workflows."
- **Token precedence**: "The npm CLI automatically detects OIDC environments and uses them for
  authentication before falling back to traditional tokens." The publish step sets no
  `NODE_AUTH_TOKEN`, so there is nothing to fall back to: if OIDC is not accepted, the publish
  fails rather than silently using a token. `actions/setup-node`'s `registry-url` input is kept;
  with no `NODE_AUTH_TOKEN` set it is inert for npm ("npm Trusted Publishing (OIDC) is not
  affected, since it does not use `NODE_AUTH_TOKEN`" - setup-node v7 README).

### Configure the trusted publisher on npmjs.com

Before merging the main-only workflow, coordinate the GitHub environment and npm entry during a
release-free window. The environment may not exist yet, and the current npm settings must be read
before changing them. Restricting npm first can temporarily reject the old environmentless job;
leaving an environmentless publisher active after merge leaves an alternate authorization path.
Do not run a publish solely to test these settings.

1. Sign in to npmjs.com as an owner or maintainer of the package.
2. Open the package page (`npmjs.com/package/@egarcia74/warp-sql-server-mcp`) → **Settings**
   → the **Trusted Publisher** section ("Navigate to your package settings on npmjs.com and find
   the 'Trusted Publisher' section").
3. Choose **GitHub Actions** and fill in exactly - "All fields are case-sensitive and must be
   exact":

   | Field (npm's label)                 | Value                                                                                             |
   | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
   | **Organization or user** (required) | `egarcia74`                                                                                       |
   | **Repository** (required)           | `warp-sql-server-mcp`                                                                             |
   | **Workflow filename** (required)    | `npm-publish.yml` - the file name only, with the `.yml` extension, not the workflow `name:`       |
   | **Environment name** (optional)     | `npm-publish` - must match the job's `environment:` exactly                                       |
   | **Allowed actions** (optional)      | direct `npm publish` must stay allowed - the workflow runs `npm publish`, not `npm stage publish` |

   On the last row npm's text is: "`npm stage publish` is always allowed. Choose whether this
   trusted publisher can also publish directly with `npm publish`."

4. Check every existing Trusted Publisher entry. Update or replace an environmentless entry for
   this same workflow; retaining it alongside the bound entry preserves an alternate path. Review
   other entries individually. Save the intended entry and read the list back. The required publisher
   is `egarcia74` / `warp-sql-server-mcp` / `npm-publish.yml` / `npm-publish`, with direct
   `npm publish` allowed.

5. Read GitHub's `npm-publish` environment settings back: selected branches/tags mode, only the
   exact `main` branch, no tag patterns, and the current reviewer, wait, bypass and custom rules.
   Read the npm entries back as well. Source changes or a skipped off-main run alone do not prove
   npm will reject an off-main publish.

### Verify the next authorized release

After the environment and npm entries are read back and the source PR is merged, use the normal
tag-before-version-bump release sequence. On the next separately authorized release, confirm the
`npm-publish.yml` run used the expected main event SHA, passed its tests and tree gate, and
published the intended version. Check that exact registry version's attestation with
`npm view @egarcia74/warp-sql-server-mcp@X.Y.Z dist.attestations`, then smoke-test a fresh
install of that version. Do not use `npm audit signatures` from this checkout as proof of the
published package's attestation; it audits the installed dependency tree.

Token access policy and any old token's revocation are separate account decisions. The publish
workflow has no `NODE_AUTH_TOKEN` or `NPM_TOKEN` binding, and an OIDC failure must stay visible.

### Re-running a publish

`npm-publish.yml` also has a `workflow_dispatch` trigger:

```bash
gh workflow run npm-publish.yml --ref main
gh run watch
```

The job rejects branch and tag refs before checkout. The **Check if this is a release version
bump** step publishes only when a `vX.Y.Z` tag matching `package.json` exists and that version is
not already on npm.
Use it after a failed publish has been fixed, or after a tag was created late. The existing tag
lookup uses a short revision name, and a failed `npm view` is treated as unpublished; these gates
are not a replacement for main-only admission or an exact-tag/registry-error guarantee.

### Troubleshooting

- **Authentication error at `npm publish`** - re-check all publisher fields and the GitHub
  environment restriction against the table above; the npm docs' first advice is to "verify
  that the workflow filename matches exactly what you configured on npmjs.com, including the
  `.yml` extension." Then confirm the run's
  `Verify npm version for trusted publishing` step printed 11.5.1 or higher.
- **The workflow was renamed** - the trusted publisher is bound to the file name. Renaming
  `npm-publish.yml` requires updating the entry on npmjs.com first.
- **`NODE_AUTH_TOKEN` reappears in the publish step** - do not add it back "just in case". npm
  tries OIDC first, so a token would be used only when OIDC fails, which hides the misconfiguration
  behind a credential that will itself expire.

## Support

If you encounter issues:

1. Check the [GitHub documentation on fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token#creating-a-fine-grained-personal-access-token)
2. Review workflow logs for specific error messages
3. Verify token permissions and expiration
4. Verify the next separately authorized release and its exact registry version
