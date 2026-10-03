import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateLcov } from './sonar-lcov.mjs';

const MAX_BYTES = 10 * 1024 * 1024;
const fail = message => {
  throw new Error(message);
};
const requireThat = (condition, message) => {
  if (!condition) fail(message);
};
const id = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validBranchRef(value) {
  if (typeof value !== 'string' || !value || value.startsWith('-')) return false;
  try {
    // Validate the literal full ref, avoiding --branch's @{-n} expansion.
    // An argv array keeps Git-valid shell metacharacters entirely inert.
    execFileSync('git', ['check-ref-format', `refs/heads/${value}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const ref = validBranchRef;

export function validateScannerRefs(...refs) {
  // Scanner CLI PropertyResolver expands ${...} even after Java-properties
  // decoding. There is no literal escape at that boundary: fail before secrets.
  requireThat(
    refs.every(ref) && refs.every(value => !value.includes('${')),
    'Invalid scanner ref or unsupported interpolation'
  );
}

/** All fields are untrusted claims until verifyDownloaded binds them to API evidence. */
export function createManifest({
  runId,
  runAttempt,
  prNumber,
  headRepositoryId,
  headSha,
  baseRef,
  lcovSha256
}) {
  requireThat(
    [runId, runAttempt, prNumber, headRepositoryId].every(id),
    'Invalid manifest ID or attempt'
  );
  requireThat(sha(headSha) && hash(lcovSha256), 'Invalid manifest SHA or digest');
  requireThat(ref(baseRef), 'Invalid manifest base ref');
  return {
    schemaVersion: 1,
    runId,
    runAttempt,
    prNumber,
    headRepositoryId,
    headSha,
    baseRef,
    lcovSha256
  };
}

function validatePr(pr, repositoryId) {
  requireThat(id(pr?.number) && id(pr.head?.repo?.id), 'Invalid PR identity');
  requireThat(sha(pr.head.sha) && ref(pr.head.ref), 'Invalid PR head SHA/ref');
  requireThat(
    pr.base?.repo?.id === repositoryId && ref(pr.base.ref),
    'Invalid PR base repository/ref'
  );
  validateScannerRefs(pr.head.ref, pr.base.ref);
}

function matchAssociation(association, run, repositoryId) {
  validatePr(association, repositoryId);
  requireThat(
    association.head.repo.id === run.head_repository.id &&
      association.head.sha === run.head_sha &&
      association.head.ref === run.head_branch,
    'PR association does not match run head'
  );
}

/**
 * associatedPrs: [{association, detail}]. Resolver supplies association from
 * run.pull_requests, or commit-to-PR API when absent, plus GET /pulls/{number}
 * detail. Require both snapshots: run metadata alone contains no base ref.
 * attemptJobs must come from the attempt-specific jobs endpoint (all pages).
 */
export function verifyOrigin({
  eventRun,
  apiRun,
  attemptJobs,
  associatedPrs,
  artifacts,
  repositoryId
}) {
  requireThat(id(repositoryId), 'Invalid repository ID');
  for (const run of [eventRun, apiRun]) {
    requireThat(
      id(run?.id) && id(run.run_attempt) && id(run.workflow_id),
      'Invalid run identity/attempt'
    );
    requireThat(run.path === '.github/workflows/ci.yml' && run.name === 'CI', 'Wrong workflow');
    requireThat(run.repository?.id === repositoryId, 'Wrong run repository');
    requireThat(
      run.event === 'pull_request' && run.status === 'completed',
      'Wrong run event/status'
    );
    requireThat(
      id(run.head_repository?.id) && sha(run.head_sha) && ref(run.head_branch),
      'Invalid run head'
    );
  }
  for (const field of ['id', 'run_attempt', 'workflow_id', 'head_sha', 'head_branch']) {
    requireThat(
      eventRun[field] === apiRun[field],
      'Event does not match authenticated run/attempt'
    );
  }
  requireThat(
    eventRun.head_repository.id === apiRun.head_repository.id,
    'Event head repository mismatch'
  );
  requireThat(
    Array.isArray(associatedPrs) && associatedPrs.length === 1,
    'Missing or ambiguous PR association'
  );
  requireThat(
    Array.isArray(apiRun.pull_requests) && apiRun.pull_requests.length <= 1,
    'Ambiguous run PR association'
  );
  const { association, detail } = associatedPrs[0];
  matchAssociation(association, apiRun, repositoryId);
  if (apiRun.pull_requests.length) {
    const runPr = apiRun.pull_requests[0];
    matchAssociation(runPr, apiRun, repositoryId);
    requireThat(
      runPr.number === association.number && runPr.base.ref === association.base.ref,
      'Run and resolved PR association mismatch'
    );
  }
  validatePr(detail, repositoryId);
  requireThat(
    detail.number === association.number &&
      detail.head.repo.id === association.head.repo.id &&
      detail.base.ref === association.base.ref,
    'Current PR repository/base association mismatch'
  );
  const dependabot = detail.user?.login === 'dependabot[bot]' && detail.user?.type === 'Bot';
  if (!dependabot && apiRun.head_repository.id === repositoryId) return { ineligible: true };
  requireThat(['open', 'closed'].includes(detail.state), 'Invalid PR state');
  if (detail.head.sha !== apiRun.head_sha || detail.head.ref !== apiRun.head_branch)
    return { superseded: true };
  if (detail.state === 'closed') {
    if (dependabot && detail.merged === true) {
      requireThat(sha(detail.merge_commit_sha), 'Invalid merged Dependabot SHA');
      return { mergedDependabot: true, mergeSha: detail.merge_commit_sha };
    }
    return { superseded: true };
  }

  requireThat(Array.isArray(attemptJobs), 'Missing attempt jobs');
  const jobs = attemptJobs.filter(job => job.name === 'Test Coverage');
  requireThat(jobs.length === 1, 'Missing or ambiguous coverage job for attempt');
  const job = jobs[0];
  requireThat(
    job.run_id === apiRun.id &&
      job.run_attempt === apiRun.run_attempt &&
      job.head_sha === apiRun.head_sha,
    'Coverage job run/attempt/head mismatch'
  );
  requireThat(
    job.status === 'completed' && job.conclusion === 'success',
    'Coverage job did not succeed'
  );
  const started = Date.parse(job.started_at),
    completed = Date.parse(job.completed_at);
  requireThat(
    Number.isFinite(started) && Number.isFinite(completed) && started <= completed,
    'Invalid coverage job timestamps'
  );
  const artifactName = `sonar-coverage-${apiRun.id}-${apiRun.run_attempt}`;
  requireThat(Array.isArray(artifacts), 'Missing artifacts');
  const matches = artifacts.filter(artifact => artifact.name === artifactName);
  requireThat(matches.length === 1, 'Missing or ambiguous artifact for exact attempt');
  const artifact = matches[0],
    source = artifact.workflow_run;
  requireThat(
    id(artifact.id) &&
      artifact.expired === false &&
      id(artifact.size_in_bytes) &&
      artifact.size_in_bytes <= MAX_BYTES,
    'Invalid, expired or oversized artifact'
  );
  requireThat(
    typeof artifact.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(artifact.digest),
    'Missing or malformed archive digest'
  );
  requireThat(
    source?.id === apiRun.id &&
      source.repository_id === repositoryId &&
      source.head_repository_id === apiRun.head_repository.id &&
      source.head_sha === apiRun.head_sha &&
      source.head_branch === apiRun.head_branch,
    'Artifact run/head association mismatch'
  );
  // Artifacts have no run_attempt field. Immutable creation time binds the
  // attempt-scoped name to the successful job; updated_at is not attempt proof.
  const created = Date.parse(artifact.created_at);
  requireThat(
    Number.isFinite(created) && created >= started && created <= completed,
    'Artifact creation time is outside coverage attempt'
  );
  return {
    prNumber: detail.number,
    headRepositoryId: apiRun.head_repository.id,
    headSha: apiRun.head_sha,
    headRef: apiRun.head_branch,
    baseRef: detail.base.ref,
    artifactName,
    artifactId: artifact.id,
    archiveDigest: artifact.digest,
    runId: apiRun.id,
    runAttempt: apiRun.run_attempt
  };
}

/** entries are produced by the trusted ZIP inspector, never by the manifest. */
export function verifyDownloaded({ expected, manifest, entries, reportText, trackedFiles }) {
  const canonical = createManifest(manifest);
  requireThat(
    manifest.schemaVersion === 1 && Object.keys(manifest).length === Object.keys(canonical).length,
    'Unsupported manifest schema'
  );
  for (const field of [
    'runId',
    'runAttempt',
    'prNumber',
    'headRepositoryId',
    'headSha',
    'baseRef'
  ]) {
    requireThat(
      manifest[field] === expected[field],
      'Manifest does not match authenticated provenance'
    );
  }
  requireThat(
    Array.isArray(entries) && entries.length === 2,
    'Artifact must contain exactly two files'
  );
  const names = new Set();
  let total = 0;
  for (const entry of entries) {
    requireThat(
      ['manifest.json', 'lcov.info'].includes(entry.name) &&
        !names.has(entry.name) &&
        entry.type === 'file' &&
        Number.isSafeInteger(entry.size) &&
        entry.size > 0,
      'Unsafe artifact entry'
    );
    names.add(entry.name);
    total += entry.size;
  }
  requireThat(
    total <= MAX_BYTES &&
      typeof reportText === 'string' &&
      Buffer.byteLength(reportText) <= MAX_BYTES,
    'Oversized artifact contents'
  );
  requireThat(
    entries.find(entry => entry.name === 'lcov.info').size === Buffer.byteLength(reportText),
    'LCOV byte size mismatch'
  );
  const measuredFiles = new Set(
    [...trackedFiles].filter(path => path === 'index.js' || /^lib\/.+\.js$/.test(path))
  );
  const result = validateLcov(reportText, measuredFiles);
  requireThat(result.sha256 === manifest.lcovSha256, 'LCOV digest mismatch');
  return { headSha: expected.headSha, prNumber: expected.prNumber, sha256: result.sha256 };
}

function main(args) {
  try {
    requireThat(
      args.length === 2 && args[0] === 'create',
      'usage: sonar-pr-artifact.mjs create coverage/lcov.info'
    );
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const reportPath = resolve(args[1]);
    const reportText = readFileSync(reportPath, 'utf8');
    requireThat(
      reportText.length > 0 && Buffer.byteLength(reportText) <= MAX_BYTES,
      'Missing or oversized LCOV'
    );
    // The producer has already validated paths. This checksum binds the bytes only;
    // the trusted consumer independently validates both provenance and LCOV paths.
    const manifest = createManifest({
      runId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      prNumber: event.pull_request?.number,
      headRepositoryId: event.pull_request?.head?.repo?.id,
      headSha: event.pull_request?.head?.sha,
      baseRef: event.pull_request?.base?.ref,
      lcovSha256: createHash('sha256').update(reportText).digest('hex')
    });
    writeFileSync(join(dirname(reportPath), 'manifest.json'), JSON.stringify(manifest) + '\n');
  } catch (error) {
    console.error(`sonar-pr-artifact: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2));
