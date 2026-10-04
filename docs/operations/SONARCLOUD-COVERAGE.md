# SonarCloud coverage migration

This runbook tracks [issue #1403](https://github.com/egarcia74/warp-sql-server-mcp/issues/1403).
It is **not** authorization to change the analysis method before the workflows are merged,
reviewed, and verified. Keep Automatic Analysis and CI scanner submissions mutually exclusive.
The CI switch is the repository Actions variable `SONAR_CI_ENABLED`; the credential is the
repository Actions secret `SONAR_TOKEN`. Never print or copy the token into a PR workflow,
Dependabot secret, artifact, or comment.

## Current observation baseline

Snapshot at 2026-10-04 06:11:39 UTC, before CI scanner cutover; refresh all values immediately before switching:

| Item                        | Observed value                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SonarCloud project          | `egarcia74_warp-sql-server-mcp`, `main`                                                                                            |
| Processed analysis          | `b3b13a48-f796-41f7-8b83-f3b27e96dcb6`, revision `19991467cb033972a550932c1acfc08145d69541`                                        |
| Main quality gate           | `OK`: new reliability, security, and maintainability ratings A; new duplication 0.8%; security hotspots reviewed 100%              |
| New-code definition         | Previous version, baseline 2025-09-27 10:06:12 UTC                                                                                 |
| Open main issues            | 0 from the unresolved-issues API                                                                                                   |
| Line/branch coverage        | Neither measure is returned by SonarCloud                                                                                          |
| Repository CI switch        | `SONAR_CI_ENABLED` absent; no scanner submission eligible                                                                          |
| Repository token            | `SONAR_TOKEN` exists (updated 2026-10-03); Execute Analysis permission is **unproved**                                             |
| Main branch required checks | Strict: `Tests (22)`, `Tests (24)`, `CodeQL Security Analysis (javascript)`, `Code Quality & Linting`, `Auto-merge Dependabot PRs` |
| T-SQL scope                 | `test/docker/init-db.sql` excluded in both `.sonarcloud.properties` and `sonar-project.properties`                                 |

The current absence of coverage and the previous use of Automatic Analysis do not prove the
present SonarCloud setting. Confirm the project's **Administration → Analysis Method** switch in
the UI immediately before cutover. Do not alter the quality gate, rules, profiles, branch
protection, Codecov policy, or test scope.

## Deploy and preflight with scanners disabled

1. Land the coverage producer, guarded direct scan, privileged PR follow-up, and main catch-up
   workflows. Confirm `SONAR_CI_ENABLED` remains unset or `false` throughout review and deployment.
   Verify the final PR head has all hosted checks, SonarCloud/Codacy results, both requested bot
   reviews without actionable findings, and resolved threads.
2. Inspect the privileged follow-up line by line. Its job has read-only permissions, copies
   helpers and scanner settings from trusted `main` before the PR checkout, validates the exact
   run/attempt/artifact/PR identity, downloads a bounded ZIP, verifies its digest and LCOV paths,
   and never runs PR code or restores PR-writable cache. A failed follow-up is a visible Actions
   job, not a required PR check. Hold manual fork merges until it passes.
3. Prove a real `coverage/lcov.info` is generated and the existing Codecov upload receives it.
   Run `npm run ci` locally and the SQL-backed hooks in a unique Docker Compose project. Confirm
   the scanner configuration still excludes the T-SQL fixture and indexes JavaScript tests.
4. Re-read the live Sonar analysis revision/time, gate conditions, new-code definition,
   unresolved issue inventory, coverage measures, GitHub required checks, `SONAR_TOKEN` presence,
   and `SONAR_CI_ENABLED` value. Record this snapshot on #1403. Do not infer Execute Analysis
   permission from secret presence.
5. Wait for all in-flight Automatic Analysis background tasks to finish. Do not flip the setting
   while an analysis is queued or running.

## Coordinated cutover

1. In SonarCloud project **Administration → Analysis Method**, switch Automatic Analysis **OFF**.
   [SonarCloud's JavaScript coverage guide](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage)
   identifies this project-level control. Confirm it is off and no Automatic Analysis task remains.
   Do not leave both methods enabled.
2. Set the repository Actions variable:
   `gh variable set SONAR_CI_ENABLED --repo egarcia74/warp-sql-server-mcp --body true`.
   Check it with `gh variable list --repo egarcia74/warp-sql-server-mcp`.
3. Dispatch the main-only backstop on `main`:
   `gh workflow run sonar-main-catch-up.yml --repo egarcia74/warp-sql-server-mcp --ref main`.
   The normal CI workflow has no manual dispatch. This first scanner run is the **permission proof**
   for the token; a successful secret listing is not. If authentication or authorization fails,
   execute the rollback below immediately.
4. Verify the main scan finishes processing, not merely that the Actions step succeeded. Check
   the processed analysis revision equals the checked-out main SHA, line and branch coverage are
   present, no unresolved LCOV-path warning appears, the gate remains acceptable, and the new
   issue inventory is understood. Compare sample covered and uncovered lines with the local LCOV.

The direct CI and catch-up main scanner jobs share the `sonar-main` concurrency group. The catch-up
checks current GitHub `main` before generating coverage and immediately before scanning; a later
race remains possible, so always verify the processed revision afterward.

## Verify every event path

- **Same-repository PR:** Use an open controlled PR and verify its exact-head Sonar analysis,
  imported line/branch coverage, expected PR decoration, and unchanged gate. Check the
  source/test classification and T-SQL exclusion.
- **Fork PR:** Use a controlled fork with a deliberately hostile `sonar-project.properties` to
  prove project identity, exclusions, PR metadata, and token scope still come from the trusted
  follow-up. Verify the exact run attempt, artifact, PR head, processed analysis, coverage, and
  decoration. Do not merge a fork while its named follow-up job is failed or pending.
- **Dependabot PR:** Hold a controlled update open long enough to verify its isolated exact-head
  analysis. The normal auto-merge policy may instead close it first; in that case, verify the
  squash commit and a processed `main` analysis whose revision contains it and has both coverage
  measures. Manually dispatch the catch-up when no ordinary `main` push CI analysis exists. Do
  not call all-event coverage complete if this route cannot be exercised.
- **Main after token-driven merge:** Confirm the backstop's decision. A same-SHA Automatic
  Analysis record without coverage or without a successful CI scanner step must trigger a scan.
  The daily schedule is a backstop, not a release-time SLA; dispatch manually before release.

For each route, distinguish a scanner submission from a processed SonarCloud analysis. Record
revision, analysis time, quality gate, line/branch measures, issue inventory, and GitHub job URL
on #1403. Compare the first scanner-based `main` inventory against the Automatic Analysis
snapshot; a green new-code gate alone does not prove parity. Investigate lost or replacement
findings on JavaScript tests and `test/docker/init-db.sql`. Close #1403 only after every route
is verified.

## Rollback on a failed cutover

1. Set `SONAR_CI_ENABLED=false` immediately:
   `gh variable set SONAR_CI_ENABLED --repo egarcia74/warp-sql-server-mcp --body false`.
2. Drain or cancel queued/running scanner-capable `CI`, `Sonar PR Coverage Follow-up`, and
   `Sonar Main Coverage Catch-up` runs. Include coverage producers that could still complete and
   trigger a privileged `workflow_run`. Wait for SonarCloud background tasks to finish. Do not
   assume changing the variable cancels an already-running job.
3. Confirm `.sonarcloud.properties` still contains `sonar.exclusions=test/docker/init-db.sql`;
   restore that line before reenabling Automatic Analysis if necessary.
4. Switch project Automatic Analysis **ON** in SonarCloud. Verify a fresh processed automatic
   analysis and record its revision, time, gate, and issue inventory. Leave the CI switch false
   until a new reviewed cutover attempt.

Rehearse this order without actually rolling back a healthy cutover. Never weaken checks or
scanner scope to make a failed migration appear green.
