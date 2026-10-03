# SonarCloud coverage cutover and rollback

> **Audience**: maintainers activating and verifying Vitest coverage in SonarCloud
>
> **Last reviewed**: 2026-10-04

This runbook describes the controlled migration from Automatic Analysis to CI analysis for
`egarcia74_warp-sql-server-mcp` in organization `egarcia74`. The workflows are staged behind
the repository Actions variable `SONAR_CI_ENABLED`; only the exact string `true` enables scans.
Documentation and local verification do not authorize activation. Obtain explicit cutover
authorization after deployment, independent review, and hosted evidence. Keep
[the approved design](../architecture/SONARCLOUD-COVERAGE-DESIGN.md) alongside this runbook.

## Read-only baseline

The following observations were collected through public SonarCloud APIs and authorized
GitHub GET requests between **2026-10-03 17:22:50 UTC and 17:22:59 UTC** (2026-10-04 in
Australia/Brisbane). The latest processed analysis was identical before and after collection.
This is a dated snapshot; refresh every entry immediately before cutover.

| Evidence                                          | Observed value                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Remote `main` and latest processed Sonar revision | `eea69244fd85e77658a42abed05b09cd9fac3be5`                                                  |
| Analysis key and analysis date                    | `e3a6dd05-abef-496f-ad5c-0db66c5d288e`; `2026-10-02T21:59:16+0000`                          |
| Last background task                              | `AaD-oaEl5ySMhsRB04sF`; `SUCCESS`; executed `2026-10-02T22:00:06+0000`; queue empty         |
| Automatic Analysis                                | `settings/values` returned `sonar.autoscan.enabled=true`                                    |
| CI activation variable                            | Repository variable list empty; `SONAR_CI_ENABLED` absent                                   |
| Assigned quality gate                             | Built-in `Sonar way`, ID `9`; latest project status `OK`                                    |
| New-code definition                               | `sonar.leak.period=previous_version`; evaluated period starts `2025-09-27T10:06:12+0000`    |
| Unresolved main issues                            | `issues/search` with `resolved=false`: `0`; severity/type/status facets all zero            |
| Security hotspots awaiting review                 | `hotspots/search` with `status=TO_REVIEW`: `0`                                              |
| Coverage                                          | All seven requested coverage measures absent; absence is not zero coverage                  |
| T-SQL exclusion on remote main                    | `.sonarcloud.properties` contains `sonar.exclusions=test/docker/init-db.sql`                |
| Actions secret presence                           | `SONAR_TOKEN` metadata exists; created/updated `2026-10-03T08:08:32Z`; value never accessed |
| Token-owner project authorization                 | Unverified; obtain maintainer evidence before activation                                    |
| Execute Analysis permission                       | Unproven; first controlled scanner run after disabling Automatic Analysis is the proof      |

GitHub required checks are `Tests (22)`, `Tests (24)`, `CodeQL Security Analysis (javascript)`,
`Code Quality & Linting`, and `Auto-merge Dependabot PRs`. Each is bound to app ID `15368`;
strict up-to-date checking is enabled. Neither Sonar nor `Test Coverage` is a required check.
Preserve this policy during migration.

### Configured gate versus evaluated conditions

The live gate definition has **six configured conditions**, although the current project
status reports only five evaluated conditions because it has no coverage measure:

| Metric                           | Gate fails when | Baseline evaluated value   |
| -------------------------------- | --------------- | -------------------------- |
| `new_reliability_rating`         | `GT 1`          | `1`                        |
| `new_security_rating`            | `GT 1`          | `1`                        |
| `new_maintainability_rating`     | `GT 1`          | `1`                        |
| `new_coverage`                   | `LT 80`         | Absent from project status |
| `new_duplicated_lines_density`   | `GT 3`          | `0.8`                      |
| `new_security_hotspots_reviewed` | `LT 100`        | `100.0`                    |

This corrects the design's older observation that the five reported conditions contained no
coverage condition: the **assigned gate already includes an 80% new-code coverage condition**.
Preserve it; do not add, remove, or weaken thresholds. Imported coverage may expose a red gate.
Investigate that result and stop or roll back; a previously green Automatic Analysis result
does not establish that the scanner will satisfy every configured condition.

## Evidence collection

Save UTC collection times, response status, exact revisions, analysis/task IDs, workflow run
IDs and attempts, and links to hosted logs in the cutover record. Never include secret values
or authentication headers. Use these read-only endpoints; parameters below are literal names:

| Service                         | GET endpoint or evidence                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonar processed main analysis   | `/api/project_analyses/search?project=egarcia74_warp-sql-server-mcp&branch=main&ps=1`                                                                                                                   |
| Sonar background queue/tasks    | `/api/ce/component?component=egarcia74_warp-sql-server-mcp`; `/api/ce/task?id=TASK_ID`                                                                                                                  |
| Sonar evaluated gate            | `/api/qualitygates/project_status?analysisId=ANALYSIS_ID`                                                                                                                                               |
| Sonar assigned gate/definition  | `/api/qualitygates/get_by_project?project=egarcia74_warp-sql-server-mcp&organization=egarcia74`; `/api/qualitygates/show?id=GATE_ID&organization=egarcia74`                                             |
| Sonar mode/new-code settings    | `/api/settings/values?component=egarcia74_warp-sql-server-mcp&keys=sonar.autoscan.enabled,sonar.leak.period`                                                                                            |
| Sonar unresolved main inventory | `/api/issues/search?componentKeys=egarcia74_warp-sql-server-mcp&branch=main&resolved=false&ps=500&p=1&facets=types,severities,rules,statuses`                                                           |
| Sonar pending hotspots          | `/api/hotspots/search?projectKey=egarcia74_warp-sql-server-mcp&branch=main&status=TO_REVIEW&ps=500&p=1`                                                                                                 |
| Sonar current coverage          | `/api/measures/component?component=egarcia74_warp-sql-server-mcp&branch=main&metricKeys=coverage,line_coverage,branch_coverage,lines_to_cover,uncovered_lines,conditions_to_cover,uncovered_conditions` |
| Sonar timestamped main measures | `/api/measures/search_history?component=egarcia74_warp-sql-server-mcp&branch=main&metrics=line_coverage,branch_coverage,lines_to_cover,conditions_to_cover&from=ANALYSIS_DATE&to=ANALYSIS_DATE`         |
| GitHub required checks          | `/repos/egarcia74/warp-sql-server-mcp/branches/main/protection/required_status_checks`                                                                                                                  |
| GitHub mode/secret metadata     | `/repos/egarcia74/warp-sql-server-mcp/actions/variables`; `/repos/egarcia74/warp-sql-server-mcp/actions/secrets/SONAR_TOKEN`                                                                            |
| GitHub run/attempt/artifact     | `/repos/egarcia74/warp-sql-server-mcp/actions/runs/RUN_ID`; `/actions/runs/RUN_ID/attempts/ATTEMPT/jobs`; `/actions/runs/RUN_ID/artifacts` under the same repository prefix                             |
| GitHub PR/merge association     | `/repos/egarcia74/warp-sql-server-mcp/pulls/PR_NUMBER`; `/commits/COMMIT_SHA/pulls`; `/compare/MERGE_SHA...ANALYZED_SHA` under the same repository prefix                                               |

Paginate inventories, jobs, and artifacts to completion. Preserve issue keys, rule keys,
paths, severity, status, and counts so scope differences can be explained after migration.
Record quality-profile assignments from project settings as well; do not edit them.
For PR coverage, use `pullRequest=PR_NUMBER` in the coverage request instead of `branch=main`
and bind the result to the processed PR task, exact head revision, and stable PR state.

An upload log alone is insufficient. Wait for its background task to finish with `SUCCESS`,
then read the gate and coverage. Current component measures do not include an `analysisDate`;
for main evidence use history at the exact processed analysis timestamp, with the same
analysis key, revision, date, and `buildString` before and after the measure reads. Missing
values, an ambiguous timestamp, processing work, or drift leave verification pending.

Direct main scans identify their run/attempt with `sonar.buildString=gh-main-RUN_ID-ATTEMPT`;
catch-up scans use `gh-catch-up-RUN_ID-ATTEMPT`. Match that value to the successful scanner
step in the authoritative run attempt. A matching SHA, a green coverage job, or an old
Automatic Analysis record without this attribution is insufficient catch-up evidence.

## Staging and activation sequence

1. Deploy LCOV generation, its failing local-report guard, the direct scanner, the fork/
   Dependabot follow-up, and the main catch-up workflow with `SONAR_CI_ENABLED` absent or
   `false`. Leave SonarCloud **Administration → Analysis Method → Automatic Analysis** enabled.
   Preserve [.sonarcloud.properties](../../.sonarcloud.properties) for rollback. Check the
   deployed [scanner configuration](../../sonar-project.properties): both `sonar.exclusions`
   and `sonar.test.exclusions` must equal `test/docker/init-db.sql`.
2. Complete independent review on the final head, including the privileged workflow's trust
   boundaries. Require hosted checks on that head and a real validated `coverage/lcov.info`
   received by Codecov. The fork/Dependabot producer artifact must contain only `manifest.json`
   and `lcov.info`, be named `sonar-coverage-RUN_ID-ATTEMPT`, and retain two days. Scanner steps
   must remain skipped during this stage. Codecov service/upload failure remains non-blocking
   in CI, but positive receipt is still required as migration evidence.
3. Run `npm run docs:check`, `npm run markdown:lint`, `npm run format:check`, `npm run lint`,
   `npm run test:unit`, and `npm run ci`; exercise normal SQL-backed commit hooks using
   `COMPOSE_PROJECT_NAME=wssm_sonar_coverage_impl_20261004` in the implementation worktree.
   Resolve actionable findings, red checks, audit failures, and Docker blockers before
   activation. Do not bypass hooks or delete existing Docker volumes. At documentation
   preparation, the pre-existing `braces` advisory `GHSA-vfj7-8cjw-p6xm` still makes the
   full local CI audit red; this runbook is not approval to bypass that gate.
4. After merge and explicit cutover authorization, refresh the full baseline above. Verify
   secret metadata and obtain evidence that the token owner is authorized for this project;
   prefer a token restricted to the project. Presence and authentication are not proof of
   Execute Analysis permission. Do not submit a test scanner while Automatic Analysis is on.
5. Coordinate a quiet window. Confirm CI scanning is disabled, drain Automatic Analysis
   tasks, and disable **Automatic Analysis** in SonarCloud. Read back the mode setting and
   confirm there are no queued/in-progress automatic tasks before continuing. Record UTC time,
   actor, old/new state, current main revision, and queue evidence for this transition.
6. Set repository Actions **variable** `SONAR_CI_ENABLED=true`, read it back, and record the
   transition. Keep Automatic Analysis off. Dispatch **Sonar main catch-up** on `main`
   (`sonar-main-catch-up.yml`); ordinary `CI` has no manual-dispatch trigger. This first
   controlled scan is the Execute Analysis permission proof and must scan a same-SHA automatic
   record lacking coverage. Confirm its checked-out SHA still equals remote main immediately
   before submission. On authentication/authorization failure, immediately perform rollback
   below and record the failed permission proof.
7. Wait for processing, verify main, and exercise every event path below. Record each state
   transition and abort/roll back if the two methods could overlap. No mode change is complete
   while required hosted evidence remains missing or a migration check is red.

### Pinned scanner argument evidence

All paths use `SonarSource/sonarqube-scan-action@d209202bc7d53ff1cc128f7f907dac145c9d6ae9`
(v8.3.0). The fork/Dependabot workflow supplies `projectBaseDir: ''` and quotes the **whole**
trusted settings argument:

```yaml
projectBaseDir: ''
args: >-
  "-Dproject.settings=${{ runner.temp }}/sonar-project.properties"
  -Dsonar.pullrequest.key=${{ steps.final.outputs.prNumber }}
  -Dsonar.pullrequest.branch=${{ steps.final.outputs.headRef }}
  -Dsonar.pullrequest.base=${{ steps.final.outputs.baseRef }}
  -Dsonar.scm.revision=${{ steps.final.outputs.headSha }}
```

On 2026-10-03 at 17:22:04 UTC, the retained local characterization passed against the actual
immutable action bundle/core, with scanner process execution stubbed. Explicit empty input
suppressed `sonar.projectBaseDir`; omitted/default input added `-Dsonar.projectBaseDir=.`.
Trusted paths containing spaces remained one unquoted absolute settings argument, and all
four PR/revision arguments were preserved. This confirms argument construction, not a real
scanner import. The implementation's ignored SDD workspace retains the executable recipe:

```bash
node .superpowers/sdd/2026-10-03-sonarcloud-vitest-coverage/verify-pinned-scanner.mjs
```

Do not assume that scratch file exists in a fresh clone. Its recipe fetches only immutable
public action source and invokes no scanner. Preserve this evidence with the deployment
record; at activation also verify the hosted scanner accepts the trusted absolute settings,
does not use hostile PR properties, and indexes the intended source/test scopes.

## Event-path verification

Use controlled same-repository and fork PRs plus a **held-open Dependabot PR**. Hold manual
fork merges while any follow-up validation fails. For each real PR scan, record the exact head
SHA, originating run ID/attempt, successful coverage job, scanner run/task/analysis IDs and
times, numeric line/branch coverage, gate result, and expected GitHub PR decoration.
Recheck the PR's current head/base/open state; a superseded run does not verify a newer head.

| Path                               | Evidence required                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same-repository PR                 | Exact-head `CI` coverage and direct scanner; processed matching PR analysis with line/branch coverage, gate, and PR decoration                                          |
| Fork PR                            | Token-free exact-head producer; matching API run/attempt and artifact digest; successful trusted `Sonar PR follow-up`; processed exact-head PR coverage and decoration  |
| Held-open Dependabot PR            | Same isolated follow-up evidence while still open; exact-head PR coverage and decoration                                                                                |
| Ordinary auto-merged Dependabot PR | API-verified squash merge SHA and processed scanner main revision containing it, with imported coverage; dispatch catch-up if main push CI is absent                    |
| Main push or controlled first scan | Matching remote main revision, processed task, run/attempt `buildString`, line/branch history, gate, and unchanged inventory/scope                                      |
| Main catch-up after token merge    | Dispatch on current main; processed containing revision, attributed catch-up run/attempt, and imported coverage; a same-SHA automatic record must not suppress the scan |

For the controlled fork, include hostile PR `sonar-project.properties` and confirm project
identity, exclusions, PR metadata, and token handling still come from trusted settings.
The privileged workflow must execute no PR scripts, tests, dependency install, local actions,
or PR-writable cache. It grants only `actions: read`, `contents: read`, and
`pull-requests: read`; `SONAR_TOKEN` appears only on the pinned scanner step. Never add a
Dependabot secret, `pull_request_target`, or an Actions-token scanner fallback.

Invalid provenance is a failed follow-up job. For failed-jobs-only reruns lacking fresh
coverage/artifacts from the current attempt, rerun the **whole CI workflow**. Closed/stale
forks are visibly superseded. A newly merged Dependabot PR routes to containing-main
verification; do not claim PR decoration for an analysis that never happened. Inspect the
follow-up Actions job/summary because its default-branch failure may not post a PR check.

The read-only follow-up never dispatches catch-up. If it reports catch-up needed, the
maintainer dispatches `sonar-main-catch-up.yml` on `main`; the daily 03:23 UTC schedule is a
backstop that can be delayed. Use GitHub's comparison/merge-base evidence to prove the
analyzed main SHA contains the verified squash SHA. Check this before release rather than
assuming a GitHub-token merge triggered push CI.

## Scope, issue comparison, and acceptance

Compare the first scanner main inventory and source/test scope with the automatic baseline.
Keep `sonar.sources=.`, `sonar.tests=test`, and `sonar.test.inclusions=test/**`; confirm the
scopes are disjoint and JavaScript tests remain indexed. Verify no replacement finding or
indexed source/test file for `test/docker/init-db.sql`. Investigate lost/new findings and
classification changes instead of assuming a green new-code PR gate proves old-code parity.

Inspect LCOV import warnings and sample both covered and uncovered lines in `index.js` and
`lib/`. Vitest measures only `index.js` and `lib/**/*.js`; Sonar's eligible denominator may
also contain `cli.js` and scripts. Report the difference. Do not narrow source scope, add
coverage exclusions, change profiles/rules/new-code definition/gate conditions, or change
GitHub required checks to make results green. Scanner upload and job success do not replace
processed gate/coverage evidence; these workflows do not configure a quality-gate wait.

Artifact provenance proves origin and bytes, not the honesty of contributor-controlled
coverage counts. Source/LCOV parsing is a privileged boundary, and PR/main can still change
after the last freshness read. Record these residual risks and require fresh analysis for
the later revision.

Post hosted evidence to [issue #1403](https://github.com/egarcia74/warp-sql-server-mcp/issues/1403)
only after it exists: revisions, UTC times, run attempts, task/analysis IDs, numeric measures,
gate definition/status, required checks, inventory differences, scope/import warnings, and
each event-path verdict. Close only when all paths pass. If a controlled fork or held-open
Dependabot path cannot be exercised, leave migration incomplete and complete verification or
roll back; ordinary merged-main verification does not establish the open-PR path.

## Rollback order

Use this sequence on permission failure, invalid coverage/scope, missing event-path evidence,
unexpected findings, or gate failure. Rehearse it by reviewing the steps; do not roll back a
healthy cutover merely to rehearse.

1. Set `SONAR_CI_ENABLED=false`, read back the repository variable, and record UTC time.
2. Drain or cancel queued/running scanner-capable `CI`, `Sonar PR follow-up`, and
   `Sonar main catch-up` runs, including coverage producers whose completion can trigger a
   follow-up. Changing the variable alone does not stop an already admitted scanner.
3. Wait for all submitted Sonar scanner/background tasks to finish; verify no queued or
   in-progress task remains. Keep Automatic Analysis disabled throughout draining.
4. Confirm the deployed `.sonarcloud.properties` still contains
   `sonar.exclusions=test/docker/init-db.sql`; restore the exclusion first if it is missing.
5. Reenable **Automatic Analysis**, read back its state, and record the transition. Verify a
   fresh automatic analysis for the expected revision, processed task, gate, unchanged
   exclusion, and issue inventory. Keep CI scanning disabled.
6. Record the failure, permission result if relevant, drained run/task IDs, and automatic
   recovery evidence in the cutover record. Keep #1403 open until a later verified cutover.

At every transition, record: UTC time, operator, Automatic Analysis state,
`SONAR_CI_ENABLED` value, queued/running run/task IDs, revision, and evidence link. Both modes
must never submit concurrently, including during rollback.
