import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDownloaded, verifyOrigin } from './sonar-pr-artifact.mjs';
import { scrubbedEnv } from './verify-publish-tree.mjs';

const repository = 'egarcia74/warp-sql-server-mcp';
const sonarProject = 'egarcia74_warp-sql-server-mcp';
const shaPattern = /^[a-f0-9]{40}$/i;

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${label}`);
  return value;
}

function checkedPage(value, key) {
  if (
    !value ||
    !Array.isArray(value[key]) ||
    value.total_count !== value[key].length ||
    value.total_count > 100
  )
    throw new Error(`incomplete ${key} API page`);
  return value[key];
}

export async function resolveFollowup(runId, fetchJson, eventRun) {
  positiveInteger(runId, 'run ID');
  if (!eventRun || eventRun.id !== runId || !shaPattern.test(eventRun.head_sha ?? ''))
    throw new Error('workflow event/run mismatch');
  const apiRun = await fetchJson(`/actions/runs/${runId}`);
  const attempt = positiveInteger(apiRun.run_attempt, 'run attempt');
  const jobsResponse = await fetchJson(
    `/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`
  );
  const attemptJobs = checkedPage(jobsResponse, 'jobs');
  const artifactResponse = await fetchJson(`/actions/runs/${runId}/artifacts?per_page=100`);
  const artifacts = checkedPage(artifactResponse, 'artifacts');
  let associations = apiRun.pull_requests;
  if (!Array.isArray(associations)) throw new Error('missing PR association field');
  if (associations.length === 0)
    associations = await fetchJson(`/commits/${eventRun.head_sha}/pulls?per_page=100`);
  if (!Array.isArray(associations) || associations.length !== 1)
    throw new Error('ambiguous or missing PR association');
  const prNumber = positiveInteger(associations[0]?.number, 'associated PR number');
  const pr = await fetchJson(`/pulls/${prNumber}`);
  const verdict = verifyOrigin({
    eventRun,
    apiRun,
    attemptJobs,
    associatedPrs: [pr],
    artifacts,
    repositoryId: eventRun.repository?.id
  });
  return verdict;
}

export function decideFollowupFinal(expected, pr) {
  const prNumber = positiveInteger(expected?.prNumber, 'expected PR number');
  positiveInteger(expected?.headRepositoryId, 'expected head repository ID');
  if (!shaPattern.test(expected?.headSha ?? '')) throw new Error('invalid expected head SHA');
  if (typeof expected?.headRef !== 'string' || typeof expected?.baseRef !== 'string')
    throw new Error('invalid expected PR refs');
  if (pr?.number !== prNumber) throw new Error('PR number changed');
  if (
    pr.state !== 'open' ||
    pr.head?.sha !== expected.headSha ||
    pr.head?.repo?.id !== expected.headRepositoryId ||
    pr.head?.ref !== expected.headRef ||
    pr.base?.ref !== expected.baseRef
  ) {
    if (
      pr?.user?.login === 'dependabot[bot]' &&
      pr.merged &&
      shaPattern.test(pr.merge_commit_sha ?? '')
    )
      return { scan: false, reason: 'merged Dependabot', mergeSha: pr.merge_commit_sha };
    return { scan: false, reason: 'superseded PR' };
  }
  return { scan: true };
}

export function verifyContainingMainCoverage({ mergeSha, analysis, measures, comparison }) {
  if (!shaPattern.test(mergeSha ?? '')) throw new Error('invalid merge SHA');
  if (analysis === undefined)
    return { verified: false, reason: 'processed main analysis missing', revision: null };
  const revision = analysis?.revision;
  if (!shaPattern.test(revision ?? '')) throw new Error('invalid main analysis revision');
  if (typeof analysis?.date !== 'string' || !Number.isFinite(Date.parse(analysis.date)))
    throw new Error('invalid main analysis time');
  const comparisonContainsMerge =
    comparison?.base_commit?.sha === mergeSha &&
    ((comparison.status === 'identical' && revision === mergeSha) ||
      (comparison.status === 'ahead' &&
        comparison.merge_base_commit?.sha === mergeSha &&
        comparison.commits?.at(-1)?.sha === revision));
  if (!comparisonContainsMerge)
    return { verified: false, reason: 'main analysis does not contain merge', revision };
  if (!Array.isArray(measures?.component?.measures))
    throw new Error('invalid main coverage response');
  const coverage = new Map(measures.component.measures.map(item => [item.metric, item.value]));
  const lineCoverage = Number(coverage.get('line_coverage'));
  const branchCoverage = Number(coverage.get('branch_coverage'));
  if (
    coverage.get('line_coverage') === undefined ||
    coverage.get('branch_coverage') === undefined ||
    !Number.isFinite(lineCoverage) ||
    !Number.isFinite(branchCoverage) ||
    lineCoverage < 0 ||
    branchCoverage < 0 ||
    lineCoverage > 100 ||
    branchCoverage > 100
  )
    return { verified: false, reason: 'main coverage measures missing', revision };
  return {
    verified: true,
    revision,
    analysisTime: new Date(analysis.date).toISOString(),
    lineCoverage,
    branchCoverage
  };
}

async function fetchGitHubJson(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('missing GitHub read token');
  const response = await globalThis.fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    redirect: 'error',
    cache: 'no-store',
    signal: globalThis.AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.json();
}

async function fetchSonarJson(path) {
  const response = await globalThis.fetch(`https://sonarcloud.io/api/${path}`, {
    redirect: 'error',
    cache: 'no-store',
    signal: globalThis.AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`SonarCloud API returned HTTP ${response.status}`);
  return response.json();
}

async function verifyMergedMain(mergeSha) {
  if (!shaPattern.test(mergeSha ?? '')) throw new Error('invalid merge SHA');
  const analysesPath = `project_analyses/search?project=${sonarProject}&branch=main&ps=1`;
  const first = await fetchSonarJson(analysesPath);
  if (!Array.isArray(first?.analyses)) throw new Error('invalid main analysis response');
  const analysis = first?.analyses?.[0];
  if (!analysis) {
    const result = verifyContainingMainCoverage({ mergeSha, analysis: undefined });
    summary(`Dependabot merge ${mergeSha}: ${result.reason}; catch-up main scan may be needed.`);
    return;
  }
  if (!shaPattern.test(analysis.revision ?? '')) throw new Error('invalid main analysis revision');
  const [measures, comparison] = await Promise.all([
    fetchSonarJson(
      `measures/component?component=${sonarProject}&branch=main&metricKeys=line_coverage,branch_coverage`
    ),
    fetchGitHubJson(`/compare/${mergeSha}...${analysis.revision}`)
  ]);
  const second = await fetchSonarJson(analysesPath);
  if (
    second?.analyses?.[0]?.key !== analysis.key ||
    second?.analyses?.[0]?.revision !== analysis.revision
  )
    throw new Error('main analysis changed while reading coverage');
  const result = verifyContainingMainCoverage({ mergeSha, analysis, measures, comparison });
  if (result.verified)
    summary(
      `Dependabot merge ${mergeSha} has processed main coverage at ${result.revision} (${result.analysisTime}); line ${result.lineCoverage}%, branch ${result.branchCoverage}%.`
    );
  else summary(`Dependabot merge ${mergeSha}: ${result.reason}; catch-up main scan may be needed.`);
}

function workflowOutput(name, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path || /[\r\n\0]/.test(String(value))) throw new Error('invalid workflow output');
  appendFileSync(path, `${name}=${value}\n`);
}

function summary(message) {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  console.log(message);
}

function verdictPath() {
  const path =
    process.env.SONAR_VERDICT_PATH ??
    (process.env.RUNNER_TEMP && resolve(process.env.RUNNER_TEMP, 'sonar-trusted/verdict.json'));
  if (!path) throw new Error('missing verdict path');
  return path;
}

function readVerdict() {
  const path = verdictPath();
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function preflight(runId) {
  if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('unexpected repository');
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const verdict = await resolveFollowup(runId, fetchGitHubJson, payload.workflow_run);
  writeFileSync(verdictPath(), `${JSON.stringify(verdict)}\n`, { flag: 'wx' });
  if (verdict.superseded) {
    workflowOutput('scan', 'false');
    summary('Sonar PR follow-up skipped: fork PR is closed or superseded.');
  } else if (verdict.mergedDependabot) {
    workflowOutput('scan', 'false');
    await verifyMergedMain(verdict.mergeSha);
  } else {
    workflowOutput('scan', 'true');
    for (const [key, value] of Object.entries({
      pr_number: verdict.prNumber,
      head_sha: verdict.headSha,
      head_repo: verdict.headRepositoryName,
      head_ref: verdict.headRef,
      base_ref: verdict.baseRef,
      artifact_id: verdict.artifactId,
      archive_digest: verdict.archiveDigest
    }))
      workflowOutput(key, value);
    summary(`Sonar PR follow-up provenance validated for PR #${verdict.prNumber}.`);
  }
}

function verifyDownload(artifactDirectory) {
  const expected = readVerdict();
  const checkedOutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    env: scrubbedEnv()
  }).trim();
  if (checkedOutSha !== expected.headSha)
    throw new Error('checkout differs from validated PR head');
  const entries = readdirSync(artifactDirectory);
  const manifest = JSON.parse(readFileSync(resolve(artifactDirectory, 'manifest.json'), 'utf8'));
  const reportText = readFileSync(resolve(artifactDirectory, 'lcov.info'), 'utf8');
  const trackedFiles = new Set(
    execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', env: scrubbedEnv() })
      .split('\0')
      .filter(Boolean)
  );
  verifyDownloaded({
    expected,
    manifest,
    entries,
    reportText,
    trackedFiles,
    sourceRoot: process.cwd()
  });
  workflowOutput('verified', 'true');
  summary(`Sonar PR follow-up LCOV validated for PR #${expected.prNumber}.`);
}

async function finalCheck() {
  const expected = readVerdict();
  const pr = await fetchGitHubJson(`/pulls/${expected.prNumber}`);
  const decision = decideFollowupFinal(expected, pr);
  workflowOutput('scan', String(decision.scan));
  if (!decision.scan) {
    summary(`Sonar PR follow-up skipped: ${decision.reason}.`);
    if (decision.mergeSha) await verifyMergedMain(decision.mergeSha);
  }
}

async function main() {
  const [mode, argument] = process.argv.slice(2);
  if (mode === 'preflight' && /^[1-9]\d*$/.test(argument ?? '')) return preflight(Number(argument));
  if (mode === 'verify-download' && argument) return verifyDownload(argument);
  if (mode === 'final-check' && !argument) return finalCheck();
  throw new Error('invalid Sonar follow-up command');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Sonar PR follow-up failed: ${error.message}`);
    process.exitCode = 1;
  });
}
