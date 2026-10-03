# SonarCloud Vitest coverage design

> **Audience**: maintainers planning issue #1403's SonarCloud analysis migration

This is a proposed design, not a description of the current production workflow.

## Purpose and success criteria

Issue [#1403](https://github.com/egarcia74/warp-sql-server-mcp/issues/1403) asks for trustworthy
code-coverage detail in the existing SonarCloud project. Today GitHub CI runs Vitest coverage,
but Vitest does not emit the LCOV file named by the Codecov upload, and SonarCloud Automatic
Analysis cannot import any coverage. The outcome is an LCOV report checked by CI, successful
import into SonarCloud for a representative pull request and `main`, and no regression in issue
detection or quality-gate behavior. This is an observability improvement; it does not introduce
a coverage threshold.

## Current system and constraints

- `.github/workflows/ci.yml` runs `npm run test:coverage` in a job that waits for the matrix
  `Tests` job. Its Codecov action names `coverage/lcov.info` but treats upload errors as
  non-blocking.
- `vitest.config.js` emits text, JSON, and HTML coverage for `index.js` and `lib/**/*.js`, but not LCOV.
- `.sonarcloud.properties` configures Automatic Analysis. Its exclusion of
  `test/docker/init-db.sql` is deliberate because that SQL Server T-SQL fixture otherwise
  receives false Oracle PL/SQL findings.
- The repository currently has no `SONAR_TOKEN` GitHub Actions secret. A maintainer must add a
  token with Execute Analysis permission before CI-based scanning can run. Prefer a scoped
  organization token limited to this project on Team/Enterprise plans; use a dedicated personal
  access token on the Free plan.
- Tokens must not appear in source, logs, comments, or pull-request artifacts. A fork pull
  request must never run untrusted code with the token; do not use `pull_request_target` to
  make the secret available.

## Chosen architecture

Use the existing SonarCloud project and a coordinated, two-stage cutover.

1. First, add Vitest's LCOV reporter. In the coverage job, fail clearly if
   `coverage/lcov.info` is missing or empty, then upload that real file to Codecov. Preserve
   the current policy that a transient Codecov service failure is non-blocking; a missing local
   report is a repository failure.
2. Configure the Sonar scanner in the coverage job after report generation, with full Git
   history available and `SONAR_TOKEN` supplied only from a repository Actions secret. Define
   scanner settings in `sonar-project.properties`, including project key
   `egarcia74_warp-sql-server-mcp`, organization `egarcia74`,
   `sonar.javascript.lcov.reportPaths=coverage/lcov.info`, source/test classification, and the
   T-SQL exclusion. Keep JavaScript test code analyzable. Coverage is measured against Sonar's
   eligible source files; do not hide uncovered source files merely to raise the percentage.
3. Coordinate the cutover: verify the token is present, turn off SonarCloud Automatic Analysis
   under the project's **Administration → Analysis Method**, then enable the CI scanner. Do not
   run both analysis methods concurrently. Replace the now-obsolete `.sonarcloud.properties`
   with the scanner configuration. Keep the period without Sonar analysis as short as practical,
   but never bypass other checks to rush it.

Use `sonar.sources=.` and a `test/**` test-inclusion pattern to make source and test scopes
disjoint; confirm the scanner's indexed-file report rather than assuming classification.
Exclude `test/docker/init-db.sql` from both source and test scopes so it cannot be reintroduced
through the new test scope. Analyze the same tracked repository content as closely as practical;
review any changed issue inventory before merging.

## Failure handling and security

- If the report is missing, stop the coverage job before Codecov or Sonar and name the missing path in the error.
- If the token is absent or invalid, the scanner step fails visibly. Do not silently skip analysis on same-repository branches or PRs.
- GitHub does not expose repository secrets to untrusted fork pull requests. Those PRs must not
  receive `SONAR_TOKEN`; they need a maintainer-controlled analysis path before merge, rather
  than a `pull_request_target` workaround.
- If CI scanner analysis creates unexpected findings, scope changes, or a red gate, stop the cutover and inspect them. Do not change Sonar rules, profiles, quality gates, or thresholds as a shortcut.
- Rollback, if needed: remove or disable the scanner step before re-enabling Automatic Analysis. Never operate both modes together.

## Verification and rollout

1. Before cutover, record the current SonarCloud main analysis revision, gate, open-issue inventory, and the absence of coverage measures.
2. Prove locally that `npm run test:coverage` writes a nonempty LCOV file with expected
   `index.js` and `lib/` paths, and that the missing-report guard fails as intended. Run all
   repository checks required by `AGENTS.md`.
3. Run a representative same-repository PR through all hosted checks. Confirm scanner analysis
   matches that exact head, imports line and branch coverage, has no unexpected new findings,
   retains the T-SQL exclusion, and preserves gate behavior.
4. After merge, verify a `main` analysis at the merge commit or a later containing revision.
   Record coverage measures, sample covered/uncovered lines, gate status, and any changed issue
   inventory on #1403. Only then close the issue.

## Out of scope

No change to tests' runtime behavior, Sonar quality profiles or rules, current coverage
thresholds, release artifacts, or unrelated Codecov policy. A future task can decide whether to
broaden Vitest's measured source set or establish a new-code coverage threshold after the
imported baseline is understood.
