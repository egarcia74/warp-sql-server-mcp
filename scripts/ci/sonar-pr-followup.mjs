import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  verifyOrigin,
  verifyDownloaded,
  validBranchRef,
  validateScannerRefs
} from './sonar-pr-artifact.mjs';

const REPOSITORY = 'egarcia74/warp-sql-server-mcp';
const PREFIX = `/repos/${REPOSITORY}`;
const PROJECT = 'egarcia74_warp-sql-server-mcp';
const MAX_BYTES = 10 * 1024 * 1024;
const id = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function sourceExec(file, args, options) {
  // A Git hook's GIT_INDEX_FILE/GIT_DIR must not override the explicit checkout.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  );
  return execFileSync(file, args, { ...options, env });
}

// Fetch every page; excessive or inconsistent pagination is a visible failure,
// never permission to select the first candidate/artifact from an incomplete set.
async function list(path, key, fetchJson) {
  const values = [];
  let total;
  for (let page = 1; page <= 100; page++) {
    const result = await fetchJson(`${path}?per_page=100&page=${page}`);
    const items = key ? result?.[key] : result;
    requireThat(Array.isArray(items) && items.length <= 100, 'Malformed API list');
    if (key) {
      requireThat(
        Number.isSafeInteger(result.total_count) && result.total_count >= 0,
        'Malformed API count'
      );
      if (total === undefined) total = result.total_count;
      requireThat(total === result.total_count, 'API list changed during pagination');
    }
    values.push(...items);
    if (items.length < 100) {
      requireThat(!key || values.length === total, 'Incomplete API list');
      return values;
    }
  }
  throw new Error('API pagination limit exceeded');
}

export async function resolveFollowup(runId, fetchJson, { eventRun } = {}) {
  requireThat(id(runId), 'Invalid run ID');
  const [repository, workflow, run] = await Promise.all([
    fetchJson(PREFIX),
    fetchJson(`${PREFIX}/actions/workflows/ci.yml`),
    fetchJson(`${PREFIX}/actions/runs/${runId}`)
  ]);
  requireThat(
    id(repository?.id) && run?.id === runId && id(run.run_attempt),
    'Invalid API identity'
  );
  requireThat(
    workflow?.id === run.workflow_id &&
      workflow.path === '.github/workflows/ci.yml' &&
      workflow.name === 'CI',
    'Wrong workflow identity'
  );
  requireThat(Array.isArray(run.pull_requests) && sha(run.head_sha), 'Malformed API run');
  const associations = run.pull_requests.length
    ? run.pull_requests
    : await list(`${PREFIX}/commits/${run.head_sha}/pulls`, undefined, fetchJson);
  requireThat(
    associations.length === 1 && id(associations[0]?.number),
    'Missing or ambiguous PR association'
  );
  const detail = await fetchJson(`${PREFIX}/pulls/${associations[0].number}`);
  const [attemptJobs, artifacts] = await Promise.all([
    list(`${PREFIX}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs`, 'jobs', fetchJson),
    list(`${PREFIX}/actions/runs/${runId}/artifacts`, 'artifacts', fetchJson)
  ]);
  const verdict = verifyOrigin({
    eventRun: eventRun ?? run,
    apiRun: run,
    repositoryId: repository.id,
    associatedPrs: [{ association: associations[0], detail }],
    attemptJobs,
    artifacts
  });
  if (verdict.ineligible || verdict.superseded || verdict.mergedDependabot)
    return { ...verdict, prNumber: detail.number, runId };
  const headRepository = await fetchJson(`/repositories/${verdict.headRepositoryId}`);
  requireThat(
    headRepository?.id === verdict.headRepositoryId &&
      typeof headRepository.full_name === 'string' &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(headRepository.full_name),
    'Invalid head repository name'
  );
  return {
    ...verdict,
    headRepository: headRepository.full_name,
    repositoryId: repository.id,
    dependabot: detail.user?.login === 'dependabot[bot]' && detail.user?.type === 'Bot'
  };
}

/** Final authoritative read. A push/merge can still race the scanner after it. */
export async function finalRead(expected, fetchJson) {
  requireThat(id(expected.prNumber) && sha(expected.headSha), 'Invalid saved provenance');
  const pr = await fetchJson(`${PREFIX}/pulls/${expected.prNumber}`);
  requireThat(
    pr?.number === expected.prNumber &&
      ['open', 'closed'].includes(pr.state) &&
      sha(pr.head?.sha) &&
      typeof pr.head?.ref === 'string' &&
      typeof pr.base?.ref === 'string',
    'Malformed final PR'
  );
  if (
    pr.head.repo?.id !== expected.headRepositoryId ||
    pr.head.sha !== expected.headSha ||
    pr.head.ref !== expected.headRef ||
    pr.base.repo?.id !== expected.repositoryId ||
    pr.base.ref !== expected.baseRef
  )
    return { superseded: true };
  if (pr.state === 'closed') {
    if (pr.user?.login === 'dependabot[bot]' && pr.user?.type === 'Bot' && pr.merged === true) {
      requireThat(sha(pr.merge_commit_sha), 'Invalid merge SHA');
      return { mergedDependabot: true, mergeSha: pr.merge_commit_sha };
    }
    return { superseded: true };
  }
  requireThat(pr.merged === false, 'Inconsistent final PR state');
  return expected;
}

/** Public project APIs only: no scanner secret is available to this check.
 * Bind historical measures to the processed analysis timestamp and bracket the
 * reads with the same analysis. Failure never claims imported coverage.
 */
export async function checkContainingMain(mergeSha, fetchGithub, fetchSonar) {
  try {
    requireThat(sha(mergeSha), 'Invalid merge SHA');
    const path = `/api/project_analyses/search?project=${PROJECT}&branch=main&ps=1`;
    const first = (await fetchSonar(path))?.analyses?.[0];
    requireThat(
      sha(first?.revision) &&
        typeof first.key === 'string' &&
        Number.isFinite(Date.parse(first.date)),
      'Missing processed analysis'
    );
    const date = encodeURIComponent(first.date);
    const measures = await fetchSonar(
      `/api/measures/search_history?component=${PROJECT}&branch=main&metrics=lines_to_cover,conditions_to_cover,line_coverage,branch_coverage&from=${date}&to=${date}&ps=1000`
    );
    requireThat(
      measures?.paging?.pageIndex === 1 &&
        measures.paging.total === 1 &&
        Array.isArray(measures.measures),
      'Unbound coverage measures'
    );
    for (const metric of [
      'lines_to_cover',
      'conditions_to_cover',
      'line_coverage',
      'branch_coverage'
    ]) {
      const found = measures.measures.filter(value => value.metric === metric);
      const history = found[0]?.history;
      requireThat(
        found.length === 1 &&
          Array.isArray(history) &&
          history.length === 1 &&
          Date.parse(history[0].date) === Date.parse(first.date) &&
          typeof history[0].value === 'string' &&
          /^\d+(?:\.\d+)?$/.test(history[0].value),
        'Missing coverage measure'
      );
      const value = Number(history[0].value);
      requireThat(
        Number.isFinite(value) && (metric.endsWith('_to_cover') ? value > 0 : value <= 100),
        'Invalid coverage measure'
      );
    }
    const comparison = await fetchGithub(`${PREFIX}/compare/${mergeSha}...${first.revision}`);
    requireThat(
      ['ahead', 'identical'].includes(comparison?.status) &&
        comparison.merge_base_commit?.sha === mergeSha,
      'Analysis does not contain merge'
    );
    const last = (await fetchSonar(path))?.analyses?.[0];
    requireThat(
      last?.key === first.key && last.revision === first.revision && last.date === first.date,
      'Analysis changed during verification'
    );
    return { containingMain: true, analysisSha: first.revision };
  } catch {
    return { catchUpNeeded: true };
  }
}

function regularFile(path) {
  const stat = lstatSync(path);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_BYTES,
    'Unsafe artifact file'
  );
  return stat;
}

function validateScannerTree(root) {
  // sonar.sources=. includes files beyond LCOV's measured set. Reject every
  // symlink without following it, including internal/dangling links and cycles.
  // No PR code runs between this check and the scanner on the ephemeral runner.
  const pending = [root];
  while (pending.length) {
    const path = pending.pop();
    const stat = lstatSync(path);
    requireThat(!stat.isSymbolicLink(), 'Unsafe scanner source symlink');
    requireThat(stat.isDirectory() || stat.isFile(), 'Unsafe scanner source file type');
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) pending.push(join(path, name));
    }
  }
}

/** Called once before checkout (data validation) and again after exact-head
 * checkout (tracked/physical source validation and exclusive safe placement).
 */
export function verifyDownload(artifactDir, sourceRoot, expected) {
  if (sourceRoot) validateScannerTree(sourceRoot);
  requireThat(
    lstatSync(artifactDir).isDirectory() && !lstatSync(artifactDir).isSymbolicLink(),
    'Unsafe artifact directory'
  );
  const entries = readdirSync(artifactDir).map(name => ({
    name,
    type: 'file',
    size: regularFile(join(artifactDir, name)).size
  }));
  const manifest = JSON.parse(readFileSync(join(artifactDir, 'manifest.json'), 'utf8'));
  const reportText = readFileSync(join(artifactDir, 'lcov.info'), 'utf8');
  const trackedFiles = new Set(
    sourceRoot
      ? sourceExec('git', ['ls-files', '-z'], {
          cwd: sourceRoot,
          encoding: 'utf8',
          maxBuffer: MAX_BYTES
        })
          .split('\0')
          .filter(Boolean)
      : reportText
          .split('\n')
          .filter(line => line.startsWith('SF:'))
          .map(line => line.slice(3))
  );
  const result = verifyDownloaded({ expected, manifest, entries, reportText, trackedFiles });
  if (sourceRoot) {
    // Use only the copied trusted validator; its diagnostics may contain source
    // strings, so capture them and expose only a fixed failure at the CLI boundary.
    sourceExec(
      process.execPath,
      [
        join(dirname(fileURLToPath(import.meta.url)), 'sonar-lcov.mjs'),
        'validate',
        join(resolve(artifactDir), 'lcov.info')
      ],
      { cwd: sourceRoot, stdio: 'pipe' }
    );
    const coverage = join(sourceRoot, 'coverage');
    try {
      mkdirSync(coverage);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    requireThat(
      lstatSync(coverage).isDirectory() && !lstatSync(coverage).isSymbolicLink(),
      'Unsafe coverage directory'
    );
    const fd = openSync(
      join(coverage, 'lcov.info'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      writeFileSync(fd, reportText);
    } finally {
      closeSync(fd);
    }
  }
  return result;
}

async function requestJson(origin, path, token) {
  requireThat(path.startsWith('/') && !path.startsWith('//'), 'Invalid API path');
  const response = await globalThis.fetch(origin + path, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : {})
    },
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30000)
  });
  requireThat(response.ok, 'API request failed');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    requireThat(bytes <= MAX_BYTES, 'Oversized API response');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    requireThat(
      /^[A-Za-z][A-Za-z0-9]*$/.test(key) &&
        (['headRef', 'baseRef'].includes(key)
          ? validBranchRef(value)
          : /^[A-Za-z0-9_./:-]+$/.test(String(value))),
      'Unsafe workflow output'
    );
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
}
async function route(verdict, fetchGithub) {
  if (verdict.ineligible) {
    output({ decision: 'ineligible' });
    summary('Ordinary same-repository PR uses the direct Sonar analysis path.');
    return;
  }
  if (verdict.superseded) {
    output({ decision: 'superseded' });
    summary('Sonar PR analysis superseded by a changed or closed pull request.');
    return;
  }
  if (verdict.mergedDependabot) {
    const result = await checkContainingMain(verdict.mergeSha, fetchGithub, path =>
      requestJson('https://sonarcloud.io', path)
    );
    output({ decision: 'merged', mergeSha: verdict.mergeSha });
    summary(
      `Dependabot merged at ${verdict.mergeSha}. ${result.containingMain ? `Processed main coverage contains this merge at ${result.analysisSha}.` : 'Main coverage verification pending / catch-up needed. A maintainer must verify or dispatch the main catch-up workflow.'}`
    );
    return;
  }
  output({
    decision: 'scan',
    prNumber: verdict.prNumber,
    headSha: verdict.headSha,
    headRef: verdict.headRef,
    baseRef: verdict.baseRef,
    headRepository: verdict.headRepository,
    artifactId: verdict.artifactId,
    archiveDigest: verdict.archiveDigest
  });
}

function writePrRefs(verdict, settingsPath) {
  validateScannerRefs(verdict.headRef, verdict.baseRef);
  regularFile(settingsPath);
  // Java Properties.load decodes UTF-16 escapes. Encode each code unit so even
  // quotes, Unicode whitespace, separators and metacharacters remain data. Refs
  // never enter the action's string-argv tokenizer or a shell command.
  const encode = value =>
    value
      .split('')
      .map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('');
  appendFileSync(
    settingsPath,
    `\nsonar.pullrequest.branch=${encode(verdict.headRef)}\nsonar.pullrequest.base=${encode(verdict.baseRef)}\n`
  );
}

async function main(args) {
  try {
    const statePath = join(process.env.RUNNER_TEMP, 'sonar-followup-state.json');
    const fetchGithub = path =>
      requestJson('https://api.github.com', path, process.env.GITHUB_TOKEN);
    if (args[0] === 'preflight' && args.length === 2) {
      requireThat(/^[1-9]\d*$/.test(args[1]) && id(Number(args[1])), 'Invalid run ID');
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      requireThat(
        event.repository?.full_name === REPOSITORY && id(event.repository.id),
        'Wrong event repository'
      );
      summary(
        `Origin: [CI run ${args[1]}](https://github.com/${REPOSITORY}/actions/runs/${args[1]}).`
      );
      const verdict = await resolveFollowup(Number(args[1]), fetchGithub, {
        eventRun: event.workflow_run
      });
      requireThat(
        event.workflow_run.repository.id === event.repository.id,
        'Wrong event repository ID'
      );
      writeFileSync(statePath, JSON.stringify(verdict), { flag: 'wx', mode: 0o600 });
      summary(
        `Validated target: [PR ${verdict.prNumber}](https://github.com/${REPOSITORY}/pull/${verdict.prNumber}).`
      );
      await route(verdict, fetchGithub);
    } else if (args[0] === 'verify-download' && [2, 3].includes(args.length)) {
      const expected = JSON.parse(readFileSync(statePath, 'utf8'));
      if (args[2])
        requireThat(
          sourceExec('git', ['rev-parse', 'HEAD'], { cwd: args[2], encoding: 'utf8' }).trim() ===
            expected.headSha,
          'Checkout SHA mismatch'
        );
      verifyDownload(args[1], args[2], expected);
    } else if (args[0] === 'final' && args.length === 1) {
      const expected = JSON.parse(readFileSync(statePath, 'utf8'));
      const verdict = await finalRead(expected, fetchGithub);
      if (!verdict.superseded && !verdict.mergedDependabot)
        writePrRefs(verdict, join(process.env.RUNNER_TEMP, 'sonar-project.properties'));
      await route(verdict, fetchGithub);
    } else {
      throw new Error('Invalid command');
    }
  } catch {
    // Never reflect API errors, PR strings, manifest data, or LCOV diagnostics.
    summary(
      'Sonar PR follow-up failed validation. Maintainer investigation is required before manually merging a fork.'
    );
    console.error('Sonar PR follow-up failed validation.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main(process.argv.slice(2));
