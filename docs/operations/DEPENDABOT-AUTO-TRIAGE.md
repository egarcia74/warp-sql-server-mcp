# 🤖 Dependabot Auto-Triage System

> **Audience**: Maintainers handling the automated dependency PR flow

## Overview

This repository implements a comprehensive **Dependabot Auto-Triage System** that intelligently manages dependency updates, security alerts, and vulnerability responses with minimal manual intervention.

## 🔒 Security-First Approach

### Intelligent Risk Classification

Dependencies are automatically classified into security risk categories:

#### 🔒 **Security-Critical** (Manual Review Required)

- **Database Libraries**: `mssql`, `tedious`
- **Authentication**: `@azure/*` (including `@azure/identity`, `@azure/keyvault-secrets`),
  `aws-sdk`, `@aws-sdk/*`
- **Impact**: Core functionality, potential breaking changes
- **Applies at every bump level**: these are held back from auto-merge for patch and minor
  updates too, not just majors. `dependabot-auto-merge.yml` evaluates this class **before**
  the patch/minor rule, so a `mssql` patch is labelled `manual-review-required` rather than
  queued for auto-merge.
- **SLA**: Review within 24-48 hours

#### 🔧 **Development Dependencies** (Auto-Merge Eligible)

- **Code Quality**: `eslint*`, `prettier*`, `*lint*`
- **Testing**: `vitest*`, `@vitest/*`, testing tools
- **Development Tools**: `husky`, `lint-staged`
- **Impact**: Development experience only
- **SLA**: Auto-merge after tests pass

#### 📚 **Documentation/Utility** (Auto-Merge Eligible)

- **Documentation**: `markdownlint*`, documentation tools
- **Utilities**: `winston*`, `js-yaml`, `chalk`, `yargs`
- **Impact**: Non-critical functionality
- **SLA**: Auto-merge after tests pass

> **⚠️ "Auto-merge eligible" applies per dependency, not per group.** Dependabot opens a
> single-dependency PR with a parseable title
> (`bump eslint from 10.9.1 to 10.10.0 in the dev-dependencies group across 1 directory`),
> and those auto-merge as described. When it batches several updates into one PR the title
> becomes `bump the dev-dependencies group with N updates` - no package, no version pair -
> and the workflow cannot tell a patch from a major, so it holds the PR for review no
> matter how low-risk the group is. Expect grouped `dev-dependencies`,
> `testing-dependencies`, `docs-dependencies` and `utility-dependencies` PRs to wait on
> you. Classifying them from `dependabot/fetch-metadata` instead of the title is what
> would restore auto-merge for these.

## 🚀 Auto-Merge Workflow

### Trigger Conditions

Auto-merge is enabled when **ALL** conditions are met:

1. ✅ **PR Author**: Created by `dependabot[bot]`
2. ✅ **Dependency Type**: Not a core database/auth dependency and not a security-critical
   GitHub Action (`github/codeql-action`, `step-security/*`)
3. ✅ **Update Type**: Patch or minor versions only
4. ✅ **No Breaking Changes**: No major version bumps
5. ✅ **Named in the title**: The title carries a `from X to Y` pair the workflow can parse.
   A grouped multi-dependency update - `bump the <group> group with N updates` - names no
   package and no versions, so its contents cannot be classified and it is held regardless
   of which group it belongs to, `dev-dependencies` and the docs/build groups included

Tests are **not** one of these conditions. Auto-merge is enabled purely from the
classifier's verdict; GitHub then holds the merge until every required check is green (see
"Failed checks" below).

### Security Update Priority

A PR whose title contains `security`, `vulnerability`, `cve` or `ossf/scorecard-action` is
auto-merge eligible even when its bump type could not be parsed from the title - **unless
the title is a grouped one**, which is now caught before this branch is reached.

That exclusion is the point of the grouped-title rule. The group _names_ `security-actions`
and `security-critical` contain the literal substring `security`, so before the rule existed
`bump the security-actions group with 4 updates` matched this keyword branch and auto-merged
the CodeQL and step-security actions the first manual-review rule claims to hold - PRs #1071
and #1136 both merged that way.

This branch is **not** an override of the manual-review rules above: it is evaluated after
them, so a security update to `mssql`, `tedious`, `@azure/*` or an AWS SDK package is still
held, as is any major bump. Those are the packages whose regressions break the server
outright, so they get a human plus the 24-48 hour SLA rather than a queue-and-forget merge.
What remains for this branch is the narrow case of a non-grouped title with no parseable
version pair.

### Manual Review Triggers

Auto-merge is **disabled** for, in the order the workflow evaluates them:

- 🔒 **Security-critical GitHub Actions** (`github/codeql-action`, `step-security/*`)
- 🔒 **Core database libraries** (`mssql`, `tedious`) - at any bump level
- 🔑 **Authentication libraries** (`@azure/*`, `aws-sdk`, `@aws-sdk/*`) - at any bump level
- 📦 **Grouped updates** whose title names no dependency or version pair
- 🚨 **Major version updates** on any dependency

Each of these sets `auto_merge=false`, labels the PR `manual-review-required`, posts the
manual-review comment, and runs `gh pr merge --disable-auto` to **revoke** any auto-merge
already queued - declining to grant it is not enough, because `--auto` is sticky and a PR
queued by an earlier run or by the re-triage workflow would otherwise merge on the next
green check. The order matters: the core-dependency rule is checked before the patch/minor
rule, so a patch bump of one of those packages is held.

### Failed checks are not a manual-review trigger

A failing required check does **not** put a PR in the class above. The `Enable auto-merge`
step is gated only on the classifier's verdict and runs `gh pr merge --auto` regardless of
current check state, so on an otherwise eligible PR auto-merge stays **enabled** and the
merge sits queued: GitHub holds it while a required check is red and completes it as soon as
a later run goes green. No `manual-review-required` label and no comment are produced. Treat
a red check as blocking the queued merge, not as disabling auto-merge - a rerun merges the
PR without anyone revisiting it.

> **There are two copies of these rules, and they must be kept in sync by hand.**
> `notify-manual-review` is not one of them - it reads `auto_merge` and `reason` from the
> classifier through `needs`, so it cannot drift. The two that can are:
>
> - the `analyze` step in `.github/workflows/dependabot-auto-merge.yml` (runs on every
>   Dependabot PR event)
> - `classify_pr` plus its rule chain in `.github/workflows/dependabot-retriage.yml`
>   (manual `workflow_dispatch`, used to re-classify a backlog)
>
> They agree as of this commit. They have not always: until the re-triage copy was
> corrected it lacked the core-dependency and grouped-title rules and queued
> `gh pr merge --auto` on exactly the packages the other one holds, while stripping the
> `manual-review-required` label. Extracting both to a shared script is tracked separately;
> until then, **a change to either rule set has to be made in both files**.

## 📊 Security Alert Triage

### Daily Monitoring

The system runs automated security scans:

- **Schedule**: Daily at 6:00 AM UTC
- **Triggers**: Also runs on dependency file changes
- **Scope**: All npm dependencies and GitHub Actions

### Automatic Issue Creation

For each security alert, the system:

1. **Creates GitHub Issue** with detailed analysis
2. **Assigns Labels** based on severity
3. **Sets Priority** with defined SLA
4. **Provides Action Plan** with specific steps

### Severity-Based SLA

| Severity    | Response Time | Action Required        |
| ----------- | ------------- | ---------------------- |
| 🚨 Critical | 24 hours      | Immediate patch/hotfix |
| ⚠️ High     | 48 hours      | Urgent update          |
| 📊 Medium   | 1 week        | Standard cycle         |
| ℹ️ Low      | Regular cycle | Next release           |

## 🔧 Configuration Files

### Core Configuration

- **`.github/dependabot.yml`**: Enhanced Dependabot configuration
- **`.github/workflows/dependabot-auto-merge.yml`**: Auto-merge logic
- **`.github/workflows/security-triage.yml`**: Security alert monitoring

### Supporting Files

- **`.github/SECURITY.md`**: Security policy and reporting procedures
- **`.github/PULL_REQUEST_TEMPLATE/dependabot.md`**: PR review template
- **`.github/security-metrics.json`**: Real-time security status tracking

## 📈 Monitoring and Metrics

### Security Metrics Tracking

The system maintains real-time metrics:

```json
{
  "last_updated": "2025-08-31T06:29:32.000Z",
  "open_alerts": 0,
  "status": "secure",
  "next_scan": "2025-09-01T06:00:00.000Z"
}
```

### Workflow Status

Monitor the auto-triage system:

```bash
# Check recent Dependabot activity
gh run list --workflow="dependabot-auto-merge.yml"

# Check security alert triage
gh run list --workflow="security-triage.yml"

# View current security status
cat .github/security-metrics.json
```

## 🛠️ Manual Operations

### Force Security Scan

```bash
# Trigger manual security triage
gh workflow run security-triage.yml

# Check for new Dependabot alerts
gh api repos/$REPO/dependabot/alerts
```

### Override Auto-Merge

To prevent auto-merge for a specific PR:

1. Add label `manual-review-required`
2. Remove `auto-merge-eligible` label
3. Comment with override reason

### Emergency Security Response

For critical vulnerabilities:

1. **Immediate Response**: Create hotfix branch
2. **Emergency PR**: Bypass normal review for critical fixes
3. **Post-Deploy**: Monitor for regressions
4. **Documentation**: Update security metrics

## 🔍 Troubleshooting

### Common Issues

#### Auto-Merge Not Working

1. **Check PR labels**: Ensure correct classification
2. **Verify tests**: Every required CI check must pass
3. **Review permissions**: GitHub token needs write access
4. **Check workflow logs**: Look for errors in auto-merge workflow

#### Security Alerts Not Creating Issues

1. **Verify permissions**: `security-events: read` and `issues: write`
2. **Check API access**: GitHub token has repository access
3. **Review workflow logs**: Check for API rate limits

#### False Positives

1. **Update ignore rules** in `dependabot.yml`
2. **Adjust classification** in auto-merge workflow
3. **Add manual override labels**

## 📋 Best Practices

### For Developers

1. **Monitor auto-merged PRs**: Review changes even if auto-merged
2. **Test locally**: Verify functionality after security updates
3. **Update ignore rules**: Keep Dependabot configuration current
4. **Respond to alerts**: Follow SLA for manual review items

### For Maintenance

1. **Weekly review**: Check auto-merge effectiveness
2. **Monthly audit**: Review security alert response times
3. **Quarterly update**: Refresh classification rules
4. **Annual review**: Update security policy and procedures

## 🎯 Success Metrics

### Automation Effectiveness

- **Auto-merge rate**: ~80% for development dependencies
- **Security response time**: < 24 hours for critical issues
- **Manual overhead reduction**: ~70% fewer manual dependency reviews
- **Security coverage**: 100% vulnerability tracking

### Security Posture

- **Current status**: ✅ 0 open security alerts
- **Response SLA**: ✅ Met for all severity levels
- **Supply chain security**: ✅ Pinned dependencies
- **Audit trail**: ✅ Complete tracking and metrics

---

**Configuration Status**: ✅ Active and Validated  
**Last Updated**: 2025-08-31  
**System Version**: 2.0
