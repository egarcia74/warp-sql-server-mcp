import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubbedEnv } from './verify-publish-tree.mjs';

const repository = 'egarcia74/warp-sql-server-mcp';
const project = 'egarcia74_warp-sql-server-mcp';
const shaPattern = /^[a-f0-9]{40}$/i;

function validSha(value, label) {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new Error(`invalid ${label}`);
  return value.toLowerCase();
}

function coverageValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

export function shouldScanMain({
  dispatchRef,
  checkoutSha,
  remoteMainSha,
  latestProcessedAnalysis,
  lineCoverage,
  branchCoverage,
  successfulCiScanAtSha,
  processingTask
}) {
  if (dispatchRef !== 'refs/heads/main') throw new Error('catch-up requires main ref');
  const checkout = validSha(checkoutSha, 'checkout SHA');
  if (checkout !== validSha(remoteMainSha, 'remote main SHA')) throw new Error('main head drift');
  if (processingTask) throw new Error('Sonar processing task in progress');
  if (latestProcessedAnalysis === undefined) return true;
  const revision = validSha(latestProcessedAnalysis?.revision, 'processed analysis revision');
  return !(
    revision === checkout &&
    coverageValue(lineCoverage) !== null &&
    coverageValue(branchCoverage) !== null &&
    successfulCiScanAtSha === true
  );
}

export function successfulCiScannerStep(run, jobs, expectedSha) {
  const sha = validSha(expectedSha, 'expected SHA');
  if (
    !Number.isSafeInteger(run?.id) ||
    run.id < 1 ||
    run.name !== 'CI' ||
    run.path !== '.github/workflows/ci.yml' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_sha !== sha ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !Array.isArray(jobs)
  )
    return false;
  const coverageJobs = jobs.filter(job => job?.name === 'Test Coverage');
  if (coverageJobs.length !== 1) return false;
  const job = coverageJobs[0];
  return (
    job.run_id === run.id &&
    job.head_sha === sha &&
    job.run_attempt === run.run_attempt &&
    job.status === 'completed' &&
    job.conclusion === 'success' &&
    Array.isArray(job.steps) &&
    job.steps.filter(
      step => step?.name === 'Submit trusted Sonar analysis' && step.conclusion === 'success'
    ).length === 1
  );
}

async function github(path) {
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

async function sonar(path) {
  const response = await globalThis.fetch(`https://sonarcloud.io/api/${path}`, {
    redirect: 'error',
    cache: 'no-store',
    signal: globalThis.AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`SonarCloud API returned HTTP ${response.status}`);
  return response.json();
}

function checkedOutSha() {
  return validSha(
    execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      env: scrubbedEnv()
    }).trim(),
    'checkout SHA'
  );
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT || /[\r\n\0]/.test(String(value)))
    throw new Error('invalid workflow output');
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function summary(message) {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  console.log(message);
}

async function remoteMainSha() {
  const ref = await github('/git/ref/heads/main');
  return validSha(ref?.object?.sha, 'remote main SHA');
}

async function ciScannerSucceededAt(sha) {
  const response = await github(
    '/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100'
  );
  if (!Array.isArray(response?.workflow_runs)) throw new Error('invalid CI runs response');
  for (const run of response.workflow_runs) {
    if (run.head_sha !== sha || run.conclusion !== 'success') continue;
    if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt))
      throw new Error('invalid CI run identity');
    const jobs = await github(
      `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
    );
    if (!Array.isArray(jobs?.jobs) || jobs.total_count !== jobs.jobs.length)
      throw new Error('incomplete CI job response');
    if (successfulCiScannerStep(run, jobs.jobs, sha)) return true;
  }
  return false;
}

async function check() {
  if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('unexpected repository');
  if (!['workflow_dispatch', 'schedule'].includes(process.env.GITHUB_EVENT_NAME))
    throw new Error('unexpected catch-up event');
  const dispatchRef = process.env.GITHUB_REF;
  if (dispatchRef !== 'refs/heads/main') throw new Error('catch-up requires main ref');
  const checkoutSha = checkedOutSha();
  const remote = await remoteMainSha();
  const [analyses, measures, ce, successfulCiScanAtSha] = await Promise.all([
    sonar(`project_analyses/search?project=${project}&branch=main&ps=1`),
    sonar(
      `measures/component?component=${project}&branch=main&metricKeys=line_coverage,branch_coverage`
    ),
    sonar(`ce/component?component=${project}`),
    ciScannerSucceededAt(checkoutSha)
  ]);
  if (
    !Array.isArray(analyses?.analyses) ||
    !Array.isArray(measures?.component?.measures) ||
    !Array.isArray(ce?.queue)
  )
    throw new Error('invalid SonarCloud response');
  const latestAgain = await sonar(`project_analyses/search?project=${project}&branch=main&ps=1`);
  if (
    latestAgain?.analyses?.[0]?.key !== analyses.analyses[0]?.key ||
    latestAgain?.analyses?.[0]?.revision !== analyses.analyses[0]?.revision
  )
    throw new Error('main analysis changed while reading coverage');
  const byMetric = new Map(measures.component.measures.map(item => [item.metric, item.value]));
  const scan = shouldScanMain({
    dispatchRef,
    checkoutSha,
    remoteMainSha: remote,
    latestProcessedAnalysis: analyses.analyses[0],
    lineCoverage: byMetric.get('line_coverage'),
    branchCoverage: byMetric.get('branch_coverage'),
    successfulCiScanAtSha,
    processingTask: ce.queue.length > 0 || ['PENDING', 'IN_PROGRESS'].includes(ce.current?.status)
  });
  output('scan', String(scan));
  output('checkout_sha', checkoutSha);
  summary(
    scan
      ? `Main ${checkoutSha} needs a scanner coverage analysis.`
      : `Main ${checkoutSha} already has processed CI scanner coverage; catch-up skipped.`
  );
}

async function recheck() {
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('catch-up requires main ref');
  const checkoutSha = checkedOutSha();
  if (checkoutSha !== (await remoteMainSha())) throw new Error('main head drift before scan');
  summary(`Main head ${checkoutSha} remains current immediately before scanning.`);
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: sonar-main-catch-up.mjs check|recheck');
  if (process.argv[2] === 'check') return check();
  if (process.argv[2] === 'recheck') return recheck();
  throw new Error('invalid catch-up command');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Sonar main catch-up failed: ${error.message}`);
    process.exitCode = 1;
  });
}
