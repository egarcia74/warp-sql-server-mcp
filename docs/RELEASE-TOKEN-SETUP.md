# Release Token Setup Guide

## Overview

This guide explains how to set up an optional `RELEASE_TOKEN` to completely eliminate Token-Permissions security
alerts from CodeQL/Scorecard while maintaining full release automation functionality.

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

The workflow will automatically use `RELEASE_TOKEN` if available, falling back to `GITHUB_TOKEN` if not. You can verify by checking the workflow logs for:

- "Using RELEASE_TOKEN for authenticated operations" (when token is set)
- Standard behavior (when falling back to GITHUB_TOKEN)

## Security Benefits

### With RELEASE_TOKEN

- ✅ **Zero job-level write permissions** in workflow
- ✅ **Fine-grained access** limited to specific operations
- ✅ **Repository-scoped** token (not account-wide)
- ✅ **Eliminates Token-Permissions alerts** from security scanners
- ✅ **Token rotation** under your control

### Without RELEASE_TOKEN (Fallback)

- ✅ **Still secure** using default GitHub mechanisms
- ⚠️ **May trigger scanner alerts** due to `contents: write` permission
- ✅ **Zero setup required** - works out of the box

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

- Allow 24-48 hours for security scanners to re-evaluate
- Verify the workflow file shows `contents: read` in job permissions
- Check that token fallback logic is working: `${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}`

### Token Access Issues

- Confirm token is scoped to the correct repository
- Verify repository permissions include "Contents: Read and write"
- For organization repos, ensure token has appropriate organization access

## Migration

If migrating from `contents: write` permissions:

1. Set up `RELEASE_TOKEN` following this guide
2. Workflow automatically detects and uses the token
3. Monitor next release to ensure functionality
4. Security alerts should resolve within 24-48 hours

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

## Support

If you encounter issues:

1. Check the [GitHub documentation on fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token#creating-a-fine-grained-personal-access-token)
2. Review workflow logs for specific error messages
3. Verify token permissions and expiration
4. Test with a dry run first: `workflow_dispatch` with `dry_run: true`
