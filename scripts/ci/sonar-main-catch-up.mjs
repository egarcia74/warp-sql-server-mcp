import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'egarcia74/warp-sql-server-mcp';
const PREFIX = `/repos/${REPOSITORY}`;
const PROJECT = 'egarcia74_warp-sql-server-mcp';
const ANALYSES = `/api/project_analyses/search?project=${PROJECT}&branch=main&ps=1`;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const id = value => Number.isSafeInteger(value) && value > 0;
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function mainRevision(dispatchRef, checkoutSha, remoteMainSha) {
  requireThat(dispatchRef === 'refs/heads/main', 'Dispatch must target main');
  requireThat(sha(checkoutSha) && sha(remoteMainSha), 'Invalid main revision');
  requireThat(checkoutSha === remoteMainSha, 'Remote main changed; retry catch-up');
}

/** Missing proof requests a scan; unsafe inputs fail rather than emit a green skip. */
export function shouldScanMain({
  dispatchRef,
  checkoutSha,
  remoteMainSha,
  latestProcessedAnalysis,
  lineCoverage,
  branchCoverage,
  successfulCiScanAtSha
}) {
  mainRevision(dispatchRef, checkoutSha, remoteMainSha);
  for (const value of [lineCoverage, branchCoverage]) {
    requireThat(
      value === undefined ||
        (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100),
      'Invalid coverage measure'
    );
  }
  return !(
    latestProcessedAnalysis?.revision === checkoutSha &&
    typeof latestProcessedAnalysis.key === 'string' &&
    latestProcessedAnalysis.key.length > 0 &&
    typeof latestProcessedAnalysis.date === 'string' &&
    Number.isFinite(Date.parse(latestProcessedAnalysis.date)) &&
    (latestProcessedAnalysis.status === undefined ||
      latestProcessedAnalysis.status === 'SUCCESS') &&
    lineCoverage !== undefined &&
    branchCoverage !== undefined &&
    successfulCiScanAtSha === true
  );
}

async function remoteHead(fetchGithub) {
  const remote = await fetchGithub(`${PREFIX}/git/ref/heads/main`);
  requireThat(
    remote?.ref === 'refs/heads/main' && remote.object?.type === 'commit' && sha(remote.object.sha),
    'Invalid remote main'
  );
  return remote.object.sha;
}
async function processed(fetchSonar) {
  // project_analyses/search lists processed analyses, not CE processing tasks.
  const result = await fetchSonar(ANALYSES);
  requireThat(
    Array.isArray(result?.analyses) && result.analyses.length <= 1,
    'Malformed analysis response'
  );
  const latest = result.analyses[0];
  if (latest)
    requireThat(
      sha(latest.revision) &&
        typeof latest.key === 'string' &&
        latest.key.length > 0 &&
        typeof latest.date === 'string' &&
        Number.isFinite(Date.parse(latest.date)),
      'Malformed processed analysis'
    );
  return latest;
}
async function list(path, key, fetchGithub) {
  const values = [];
  let total;
  for (let page = 1; page <= 100; page++) {
    const result = await fetchGithub(
      `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`
    );
    requireThat(
      Array.isArray(result?.[key]) &&
        result[key].length <= 100 &&
        Number.isSafeInteger(result.total_count) &&
        result.total_count >= 0,
      'Malformed API list'
    );
    total ??= result.total_count;
    requireThat(result.total_count === total, 'API list changed');
    values.push(...result[key]);
    if (result[key].length < 100) {
      requireThat(values.length === total, 'Incomplete API list');
      return values;
    }
  }
  throw new Error('API pagination limit');
}

async function ciEvidence(checkoutSha, fetchGithub) {
  for (const [file, jobName, stepName, events] of [
    ['ci.yml', 'Test Coverage', 'Scan trusted revision with Sonar', ['push']],
    [
      'sonar-main-catch-up.yml',
      'Main coverage catch-up',
      'Analyze current main with Sonar',
      ['workflow_dispatch', 'schedule']
    ]
  ]) {
    const workflow = await fetchGithub(`${PREFIX}/actions/workflows/${file}`);
    requireThat(
      id(workflow?.id) && workflow.path === `.github/workflows/${file}`,
      'Wrong workflow identity'
    );
    const runs = await list(
      `${PREFIX}/actions/workflows/${workflow.id}/runs?branch=main&head_sha=${checkoutSha}`,
      'workflow_runs',
      fetchGithub
    );
    for (const run of runs) {
      requireThat(
        id(run?.id) &&
          id(run.run_attempt) &&
          run.workflow_id === workflow.id &&
          run.path === workflow.path &&
          run.head_sha === checkoutSha &&
          run.head_branch === 'main' &&
          run.repository?.full_name === REPOSITORY &&
          run.head_repository?.full_name === REPOSITORY,
        'Invalid workflow run provenance'
      );
      if (run.status !== 'completed' || !events.includes(run.event)) continue;
      const jobs = await list(
        `${PREFIX}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
        'jobs',
        fetchGithub
      );
      for (const job of jobs.filter(value => value.name === jobName)) {
        requireThat(
          job.run_id === run.id &&
            job.run_attempt === run.run_attempt &&
            job.head_sha === checkoutSha &&
            Array.isArray(job.steps),
          'Invalid scanner job provenance'
        );
        const scans = job.steps.filter(step => step.name === stepName);
        requireThat(scans.length <= 1, 'Ambiguous scanner step');
        if (
          job.status === 'completed' &&
          job.conclusion === 'success' &&
          scans[0]?.status === 'completed' &&
          scans[0].conclusion === 'success'
        )
          return true;
      }
    }
  }
  return false;
}

export async function checkMain({ dispatchRef, checkoutSha, fetchGithub, fetchSonar }) {
  mainRevision(dispatchRef, checkoutSha, await remoteHead(fetchGithub));
  const first = await processed(fetchSonar);
  if (!first || first.revision !== checkoutSha) return true;
  const date = encodeURIComponent(first.date);
  const result = await fetchSonar(
    `/api/measures/search_history?component=${PROJECT}&branch=main&metrics=lines_to_cover,conditions_to_cover,line_coverage,branch_coverage&from=${date}&to=${date}&ps=1000`
  );
  requireThat(
    Array.isArray(result?.measures) &&
      result.paging?.pageIndex === 1 &&
      Number.isSafeInteger(result.paging.total) &&
      result.paging.total >= 0 &&
      result.paging.total <= 1,
    'Unbound coverage response'
  );
  const values = {};
  for (const metric of [
    'lines_to_cover',
    'conditions_to_cover',
    'line_coverage',
    'branch_coverage'
  ]) {
    const matches = result.measures.filter(measure => measure.metric === metric);
    requireThat(matches.length <= 1, 'Duplicate coverage measure');
    if (!matches.length) continue;
    const history = matches[0].history;
    requireThat(Array.isArray(history) && history.length <= 1, 'Malformed coverage history');
    if (!history.length) continue;
    requireThat(
      result.paging.total === 1 && Date.parse(history[0].date) === Date.parse(first.date),
      'Unbound coverage timestamp'
    );
    // Automatic Analysis records a dated history entry without a value. This is
    // missing coverage, not imported coverage and not a transport/API failure.
    if (history[0].value === undefined) continue;
    requireThat(
      typeof history[0].value === 'string' && /^\d+(?:\.\d+)?$/.test(history[0].value),
      'Unbound coverage measure'
    );
    const value = Number(history[0].value);
    requireThat(
      Number.isFinite(value) && (metric.endsWith('_to_cover') ? value >= 0 : value <= 100),
      'Invalid coverage measure'
    );
    values[metric] = value;
  }
  const hasCoverage =
    values.lines_to_cover > 0 &&
    values.conditions_to_cover > 0 &&
    values.line_coverage !== undefined &&
    values.branch_coverage !== undefined;
  const successfulCiScanAtSha = hasCoverage ? await ciEvidence(checkoutSha, fetchGithub) : false;
  const last = await processed(fetchSonar);
  requireThat(
    last?.key === first.key && last.revision === first.revision && last.date === first.date,
    'Analysis changed during verification'
  );
  return shouldScanMain({
    dispatchRef,
    checkoutSha,
    remoteMainSha: await remoteHead(fetchGithub),
    latestProcessedAnalysis: last,
    lineCoverage: hasCoverage ? values.line_coverage : undefined,
    branchCoverage: hasCoverage ? values.branch_coverage : undefined,
    successfulCiScanAtSha
  });
}

async function requestJson(origin, path, token) {
  const response = await globalThis.fetch(origin + path, {
    headers: {
      Accept: 'application/json',
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28'
          }
        : {})
    },
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30000)
  });
  requireThat(response.ok, 'API request failed');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    requireThat(bytes <= 10 * 1024 * 1024, 'Oversized API response');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function main(args) {
  try {
    requireThat(args.length === 1 && ['check', 'fresh'].includes(args[0]), 'Invalid command');
    requireThat(process.env.GITHUB_REF === 'refs/heads/main', 'Dispatch must target main');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
    );
    const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      env
    }).trim();
    const fetchGithub = path =>
      requestJson('https://api.github.com', path, process.env.GITHUB_TOKEN);
    let scan;
    if (args[0] === 'fresh') {
      requireThat(
        !process.env.SONAR_EXPECTED_SHA || process.env.SONAR_EXPECTED_SHA === checkoutSha,
        'Checkout changed after coverage'
      );
      mainRevision(process.env.GITHUB_REF, checkoutSha, await remoteHead(fetchGithub));
      scan = true;
    } else {
      scan = await checkMain({
        dispatchRef: process.env.GITHUB_REF,
        checkoutSha,
        fetchGithub,
        fetchSonar: path => requestJson('https://sonarcloud.io', path)
      });
    }
    const output = `scan=${scan}\nsha=${checkoutSha}\n`;
    console.log(output.trim());
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        scan
          ? `Main coverage scan required at ${checkoutSha}.\n`
          : `Verified processed CI main coverage at ${checkoutSha}; scan skipped.\n`
      );
  } catch {
    console.error('Main coverage validation failed; inspect evidence and retry on current main.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main(process.argv.slice(2));
