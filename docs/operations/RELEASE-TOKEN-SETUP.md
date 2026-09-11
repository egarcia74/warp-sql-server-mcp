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

The Documentation Automation workflow can use a fine‑grained PAT to ensure
that auto‑generated docs PRs trigger CI/CodeQL checks. Without this token,
PRs created by GITHUB_TOKEN may leave required checks in an
"Expected — Waiting" state.

### When to use

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

- `.github/workflows/docs.yml` prefers `DOCS_PAT` for pushing the auto‑update branch and creating the PR.
- Falls back to `GITHUB_TOKEN` if `DOCS_PAT` is not set (checks may not trigger automatically).

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
npmjs.com exchanges it for a publish credential valid for that run only, because the package's
settings name this repository and this workflow file as a trusted publisher. There is no npm token
to store in GitHub, rotate, or watch for expiry.

**Why**: the 2.0.0 publish on 2026-09-11 failed because the `NPM_TOKEN` granular access token -
90 days maximum lifetime - had expired under the release. A trusted publisher has nothing to expire.

### Requirements

Taken from [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers):

- **npm CLI and Node**: "Trusted publishing requires npm CLI version 11.5.1 or later and Node
  version 22.14.0 or higher." The workflow uses `node-version: '22'`, which resolves to the latest
  22.x, but Node 22 bundles npm 10.x - so the job installs an exact npm version (currently
  `npm@11.19.1`) and fails early if `npm --version` is still below 11.5.1. The pin is deliberate:
  this job holds the publish credential, so bump it as a reviewed change rather than letting a
  range pull in an unreviewed release.
- **OIDC permission**: "The critical requirement is the `id-token: write` permission, which allows
  GitHub Actions to generate OIDC tokens." The `publish` job declares it.
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

> **Do this BEFORE merging any change that removes `NODE_AUTH_TOKEN` from the publish step.**
> Once the token is gone from the workflow, OIDC is the only credential the job has. If npmjs.com
> does not yet list this repository and workflow as a trusted publisher, the next publish fails
> with an authentication error, and the version number is spent.

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
   | **Environment name** (optional)     | leave blank - the `publish` job declares no `environment:`                                        |
   | **Allowed actions** (optional)      | direct `npm publish` must stay allowed - the workflow runs `npm publish`, not `npm stage publish` |

   On the last row npm's text is: "`npm stage publish` is always allowed. Choose whether this
   trusted publisher can also publish directly with `npm publish`."

4. Save. The package page's **Settings → Trusted publishing** list should now show the entry.

### First OIDC publish, then remove the token

npm's own migration order: "Set up trusted publishers first and verify they work. Then restrict
token access... Revoke any existing automation tokens that are no longer needed."

1. Merge the workflow change (step order above: publisher first, workflow second).
2. On the next release, check the `npm-publish.yml` run: the **Upgrade npm for trusted
   publishing** step prints an npm version of 11.5.1 or higher, and **Publish to npm** succeeds.
3. Verify the registry: `npm view @egarcia74/warp-sql-server-mcp@X.Y.Z dist.attestations` is
   non-empty.
4. Delete the `NPM_TOKEN` repository secret (repo → Settings → Secrets and variables → Actions).
   No workflow reads it any more, so it is dead weight that still authenticates as you if it
   leaks. Check for the secret binding rather than the name: `grep -rn 'secrets\.NPM_TOKEN'
.github/` must return nothing. A bare `grep -rn NPM_TOKEN .github` still matches the
   explanatory comments in `npm-publish.yml` and would look like a failed migration.
5. Revoke the underlying token on npmjs.com (Account → Access Tokens).

### Re-running a publish

`npm-publish.yml` also has a `workflow_dispatch` trigger:

```bash
gh workflow run npm-publish.yml
gh run watch
```

This is safe at any time. The **Check if this is a release version bump** step publishes only when a
`vX.Y.Z` tag matching `package.json` exists and that version is not already on npm; otherwise the
run skips. Use it after a failed publish has been fixed, or after a tag was created late.

### Troubleshooting

- **Authentication error at `npm publish`** - re-check the three required fields against the table
  above; the npm docs' first advice is to "verify that the workflow filename matches exactly what you
  configured on npmjs.com, including the `.yml` extension." Then confirm the run's
  `Upgrade npm for trusted publishing` step printed 11.5.1 or higher.
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
4. Test with a dry run first: `workflow_dispatch` with `dry_run: true`
