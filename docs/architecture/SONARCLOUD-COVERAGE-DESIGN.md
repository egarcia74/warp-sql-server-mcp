# SonarCloud Vitest coverage design

> **Status**: proposed for issue #1403; this document authorizes no SonarCloud setting changes.

## Intent and acceptance

Import Vitest line and branch coverage into the existing SonarCloud project without losing issue
analysis, exposing `SONAR_TOKEN` to untrusted test code, or changing the quality gate. Preserve
Codecov's current failure policy. A same-repository PR, fork PR, and `main` must each receive an
analysis for the revision actually tested. Dependabot may auto-merge before its asynchronous PR
scan: analyze it as a PR if still open, otherwise verify `main` analysis at the squash commit or
a later containing revision. Success requires SonarCloud to finish processing, import coverage,
and preserve the T-SQL fixture exclusion. No new coverage threshold is part of #1403.

## Observed baseline and constraints

- `.github/workflows/ci.yml` runs coverage after its Node test matrix. Codecov points at
  `coverage/lcov.info` but treats upload failures as non-blocking. Vitest emits text, JSON, and
  HTML, not LCOV; coverage includes `index.js` and `lib/**/*.js` only.
- SonarCloud Automatic Analysis reads `.sonarcloud.properties`. Its exclusion of
  `test/docker/init-db.sql` prevents Oracle PL/SQL false positives on a T-SQL fixture. Keep that
  exclusion in both analysis modes and both source and test scopes.
- On 2026-10-03, the latest observed `main` analysis was revision
  `eea69244fd85e77658a42abed05b09cd9fac3be5` at 2026-10-02 21:59:16 UTC, with gate OK and no
  coverage measures. The five gate conditions were new-code reliability, security, and
  maintainability ratings, duplication, and reviewed security hotspots; none was coverage.
  Re-read this live baseline immediately before cutover.
- GitHub's required `main` checks were `Tests (22)`, `Tests (24)`, `CodeQL Security Analysis
(javascript)`, `Code Quality & Linting`, and `Auto-merge Dependabot PRs`; Sonar was not a
  required check. Do not silently change that policy.
- The Dependabot workflow requests squash auto-merge once required checks pass. Neither
  `Test Coverage` nor Sonar is required, so a Dependabot PR can close before the post-CI
  scanner runs. GitHub Actions-token merges may also suppress the subsequent `push` workflow:
  Dependabot #1397 merged without a same-revision `main` CI run. Sonar remains observational,
  not a pre-merge blocker, for those updates; a separate main catch-up path is required.
- The maintainer added `SONAR_TOKEN` as a GitHub Actions secret. Its value was not accessed;
  Execute Analysis permission and validity remain to be proven by a scanner run. Prefer a token
  restricted to this project. Do not copy it into a Dependabot secret.
- GitHub withholds ordinary Actions secrets from fork and Dependabot PR runs. Automatic Analysis
  currently supports fork PRs. A replacement path must exist before disabling it.

## Options and decision

1. **One combined coverage-and-scan job for every event:** simplest YAML, but it cannot scan
   fork or Dependabot PRs with the Actions secret. Reject.
2. **One privileged post-CI scanner for every event:** uniform isolation, but makes every
   analysis depend on artifact provenance and a second workflow. Viable, but broader than needed.
3. **Recommended hybrid:** direct scan after coverage on `main` and trusted same-repository PRs;
   a separate `workflow_run` analysis for forks and Dependabot, consuming validated coverage
   artifacts and source revisions. This follows Sonar's documented fork pattern while limiting
   the privileged path to events that need it.

The privileged path still processes untrusted source and LCOV data. GitHub warns that this is a
sensitive boundary even when no PR code is executed. The implementation must meet every control
below; otherwise retain Automatic Analysis and do not cut over.

## Coverage production and direct analysis

1. Add Vitest's `lcov` reporter without changing its measured include set. Make the CI coverage
   job fail clearly if `coverage/lcov.info` is missing or empty. Verify expected `SF:` entries
   for `index.js` and `lib/`. Keep Codecov upload non-blocking.
2. For a PR, generate LCOV from the PR's **head SHA**, not GitHub's synthetic merge checkout.
   The existing `Tests` matrix may continue testing the merge checkout. For `main`, use the
   actual push SHA. Set checkout to full history for scanner/SCM relevance; disable persisted
   checkout credentials where possible. Record the analyzed SHA in job output and logs.
3. After LCOV exists, scan `main` and same-repository PRs **except Dependabot** in the coverage
   job. Gate the scanner step on an explicit repository variable `SONAR_CI_ENABLED=true`. Give
   `SONAR_TOKEN` only to this commit-pinned step, not the job or test steps. Keep the workflow's
   existing `contents: read` permission. Missing/invalid token fails an eligible scan; it must
   not silently skip. No `pull_request_target` trigger is used.
4. Do not pass `SONAR_TOKEN` to Codecov or publish it in artifacts, logs, or comments. The
   existing Codecov upload policy and token use are otherwise unchanged.

## Fork and Dependabot analysis

The ordinary `pull_request` CI coverage job executes tests **without `SONAR_TOKEN`** for forks
and Dependabot. It uploads only LCOV plus a small provenance manifest as a short-lived artifact
from its exact-head run. The artifact name and manifest include run ID, run attempt, PR number,
head repository ID, head SHA, base branch, and LCOV digest; all are untrusted data, not
authority. Do not add an Actions-token fallback, a Dependabot secret, or
`pull_request_target`.

A separate workflow, defined on the default branch and triggered by `workflow_run` completion
of `CI`, performs the following before any scanner step:

1. Require `SONAR_CI_ENABLED=true` and a completed `pull_request` run whose head is a fork or
   whose PR author is Dependabot; ordinary same-repository PRs do not enter this path. Use
   GitHub's API as the authority for the originating workflow identity, repository ID, run ID
   and attempt, source event, head repository ID/SHA, the successful **Test Coverage** job from
   that attempt, and one expected artifact from that same run and attempt. Do not rely on the
   whole CI conclusion: an unrelated job may fail while coverage succeeds. A
   failed-jobs-only rerun that did not rerun coverage has no matching artifact and must fail
   closed; rerun the whole workflow.
2. Bind the authenticated run to the target PR before reading artifact claims: require exactly
   one associated PR whose GitHub API head repository ID/SHA/ref and base match the run. Use
   the run's PR association when present; otherwise resolve via GitHub's commit-to-PR API and
   reject ambiguity. The manifest must then match **all three**: run, artifact, and target PR;
   it never chooses which PR to scan. Reject stale runs after a new push, missing/ambiguous
   artifacts, invalid IDs or refs, symlinks/path traversal, oversize artifacts, and LCOV `SF:`
   paths outside the tracked `index.js`/`lib/` coverage set. Verify artifact/digest association
   and that coverage paths resolve within the checkout.
3. If a fork PR is closed or its head has changed, do not scan stale content; require a fresh
   run or record that analysis was superseded. If Dependabot already squash-merged, record the
   verified merge SHA and report in the job summary when no processed `main` analysis with
   imported coverage contains it; a maintainer then dispatches catch-up, or its daily schedule
   does so. The read-only follow-up workflow does not dispatch another workflow. Do not claim
   PR decoration or coverage for a PR scan that never happened. If it remains open, check out
   the validated head SHA with full history and
   `persist-credentials: false`.
4. For an open PR, run the scanner from its checkout with
   `-Dproject.settings=/absolute/trusted/sonar-project.properties`, using a config file checked
   out separately from the **trusted default branch**. This scanner CLI option replaces the
   checkout's `sonar-project.properties`; do not set incompatible `sonar.projectBaseDir`.
   Pass validated PR number, branch, base, and `sonar.scm.revision=head SHA` explicitly so
   Sonar decorates the correct PR. Never install dependencies, execute repository scripts,
   run tests, execute PR-provided actions, or restore a PR-writable cache in this workflow.
5. Use a commit-pinned scanner action, an ephemeral hosted runner, read-only repository
   permissions plus only the artifact-read permission needed, and `SONAR_TOKEN` only on the
   scan step. Treat downloaded files as data. The follow-up workflow runs on the default-branch
   SHA: a pre-scan failure may not post a PR check. Surface it in a named failed Actions job
   and job summary linking the originating run/PR, without echoing untrusted content or adding
   write permissions. Maintainers must inspect it before manually merging a fork. Do not call
   it a PR-level required check or convert failure to a green skip. A newer PR head
   supersedes the older run.

The implementation plan must test that a malicious PR-provided `sonar-project.properties`
cannot override project identity, exclusions, PR metadata, or token handling. Treat Sonar's
documented privileged checkout pattern as a residual risk, not as proof of safety.

## Main catch-up after token-driven merges

Add a trusted, main-only coverage-and-scan workflow with `workflow_dispatch` and a daily
schedule, gated by `SONAR_CI_ENABLED=true`. It must reject a manual dispatch to any ref other
than `main`. After checking out
the current `main` SHA with full history, it compares that SHA with the latest **processed**
SonarCloud main analysis. It skips only if that analysis has the same SHA, a verified CI scanner
run, and imported line and branch coverage. A same-SHA Automatic Analysis without coverage
must not satisfy this guard; the first cutover dispatch must scan it. Otherwise it runs
`npm ci --ignore-scripts`, generates and validates LCOV, then scans with a step-scoped
`SONAR_TOKEN`. It uses the same trusted scanner configuration and pinned action as the direct
CI path. Serialize main scanner submissions across the ordinary CI and catch-up workflows,
and recheck that the remote `main` SHA still equals the checkout immediately before submission
to avoid a stale scheduled run overwriting a newer result.

The schedule is a backstop, not a release verification SLA: scheduled runs may be delayed.
After a Dependabot auto-merge, the maintainer must check whether SonarCloud analyzed a `main`
revision containing the squash commit and manually dispatch catch-up if not, especially before
release. Do not assume a `GITHUB_TOKEN`-generated squash merge triggers `on: push` CI.

## Scanner scope, gate, and coverage meaning

Put scanner settings in `sonar-project.properties`: project key
`egarcia74_warp-sql-server-mcp`, organization `egarcia74`,
`sonar.javascript.lcov.reportPaths=coverage/lcov.info`, `sonar.sources=.`, `sonar.tests=test`,
`sonar.test.inclusions=test/**`, `sonar.exclusions=test/docker/init-db.sql`, and
`sonar.test.exclusions=test/docker/init-db.sql`. Sonar automatically applies test inclusion
patterns as source exclusions; confirm source/test sets are disjoint and JavaScript tests remain
indexed. Test classification can legitimately change rules and metrics, so compare the issue
inventory rather than promising byte-for-byte parity.

Do not narrow `sonar.sources` to inflate coverage. Sonar's denominator may include eligible
source such as `cli.js` or scripts outside Vitest's current `index.js`/`lib/` include set;
report that difference and inspect unresolved-LCOV-path warnings. Do not add coverage
exclusions or a threshold to hide it. Keep the existing quality gate and GitHub required-check
list unchanged. A scanner upload alone is not acceptance: wait for the background task and
verify the resulting Sonar PR/main gate and GitHub decoration. If workflow failure on a red
gate is desired, configure `sonar.qualitygate.wait` deliberately and verify it does not change
the current merge policy.

## Staged cutover and rollback

1. Land LCOV generation and its missing-file guard first while Automatic Analysis stays on.
   Prove Codecov receives the real file and coverage paths are usable. Test guard failure.
2. Land both scanner paths and artifact validation behind `SONAR_CI_ENABLED=false`. Review
   the privileged workflow for untrusted-input and cache hazards; run static workflow checks
   and local guard/validator tests. Preserve `.sonarcloud.properties` as an inactive rollback
   file during observation, correcting its comment to explain both modes. Put its T-SQL
   exclusion in scanner configuration as well.
3. Immediately before switching, record the current analysis revision/time, gate conditions,
   new-code definition, open-issue inventory, coverage absence, GitHub required checks, and
   token-presence/permission result. Wait for in-flight Automatic Analysis tasks to finish.
   Disable Automatic Analysis in SonarCloud, then set `SONAR_CI_ENABLED=true`; never operate
   both methods concurrently. Trigger a controlled same-repo PR and manually dispatch the
   trusted main catch-up workflow at the current `main` SHA. The current CI workflow has no
   manual-dispatch trigger.
4. Verify a controlled fork PR and an open, held Dependabot PR through the isolated route
   before declaring migration complete. If one cannot be exercised, do not claim all-event
   coverage; either complete that verification or roll back. A normally auto-merged
   Dependabot PR may have only a post-merge `main` analysis under the unchanged policy; invoke
   catch-up when no ordinary `main` push analysis is present.
   Check each actual analysis against its revision, processed task, LCOV import, gate,
   expected issue scope, and GitHub decoration when a PR analysis occurred.
5. Compare the first scanner-based `main` inventory with the recorded Automatic Analysis
   baseline. A green new-code PR gate is not proof of old-code finding parity. Investigate
   lost or replacement findings, especially on `test/docker/init-db.sql` and JavaScript tests.
   Close #1403 only after these checks pass, recording revisions, timestamps, measures, and
   inventory differences in the issue.

If validation or analysis fails: set `SONAR_CI_ENABLED=false`; drain or cancel queued/running
scanner-capable `CI`, follow-up, and main catch-up runs, including coverage producers that
could still trigger `workflow_run`; then wait for in-flight Sonar scanner/background tasks to finish. Confirm
`.sonarcloud.properties` still contains the T-SQL exclusion (restore it first if removed),
reenable Automatic Analysis, and verify a new automatic analysis. Do not relax rules, profiles,
gate conditions, branch protection, or security checks to make the migration appear green.

## Out of scope

No change to test runtime behavior, release artifacts, Sonar rules/profiles/gate conditions,
GitHub required checks, Codecov's service-failure policy, or Vitest's measured source set. A
future issue can decide whether to broaden coverage or require a Sonar check after the imported
baseline is understood.

## References

- [SonarCloud GitHub Actions and fork-PR analysis](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/github-actions-for-sonarcloud)
- [SonarCloud scanner configuration and `project.settings`](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/scanners/sonarscanner-cli)
- [SonarCloud source/test scope](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/project-analysis/setting-analysis-scope/setting-initial-scope)
- [GitHub's secure-use warning for privileged workflows](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub's Dependabot Actions secret behavior](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [GitHub's `GITHUB_TOKEN` workflow-trigger exceptions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
