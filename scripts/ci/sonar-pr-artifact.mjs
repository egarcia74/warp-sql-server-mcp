import { createHash, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubbedEnv } from './verify-publish-tree.mjs';

const shaPattern = /^[a-f0-9]{40}$/i;
const digestPattern = /^[a-f0-9]{64}$/i;
const safeRefPattern = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+$/;
const repositoryNamePattern = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;
const maxArchiveBytes = 10 * 1024 * 1024;

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${label}`);
  return value;
}

function sha(value, label) {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new Error(`invalid ${label}`);
  return value.toLowerCase();
}

function digest(value, label) {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw new Error(`invalid ${label}`);
  return value.toLowerCase();
}

function safeRef(value, label) {
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    !safeRefPattern.test(value) ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.')
  )
    throw new Error(`invalid ${label}`);
  return value;
}

function sameDigest(first, second) {
  return timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));
}

export function checkedTrackedFiles(indexText) {
  if (typeof indexText !== 'string' || !indexText.endsWith('\0'))
    throw new Error('invalid Git index listing');
  const files = new Set();
  for (const entry of indexText.split('\0').slice(0, -1)) {
    const match = /^(100644|100755) [a-f0-9]{40} 0\t([^\0]+)$/.exec(entry);
    if (!match) throw new Error('non-regular or unmerged tracked path');
    files.add(match[2]);
  }
  if (files.size === 0) throw new Error('empty Git index listing');
  return files;
}

export function createManifest({
  runId,
  runAttempt,
  prNumber,
  headRepositoryId,
  headSha,
  baseRef,
  lcovSha256
}) {
  return {
    version: 1,
    runId: positiveInteger(runId, 'run ID'),
    runAttempt: positiveInteger(runAttempt, 'run attempt'),
    prNumber: positiveInteger(prNumber, 'PR number'),
    headRepositoryId: positiveInteger(headRepositoryId, 'head repository ID'),
    headSha: sha(headSha, 'head SHA'),
    baseRef: safeRef(baseRef, 'base ref'),
    lcovSha256: digest(lcovSha256, 'LCOV digest')
  };
}

function validateRun(eventRun, apiRun, repositoryId) {
  const repoId = positiveInteger(repositoryId, 'repository ID');
  const runId = positiveInteger(eventRun?.id, 'event run ID');
  const runAttempt = positiveInteger(eventRun?.run_attempt, 'event run attempt');
  const runSha = sha(eventRun?.head_sha, 'event run SHA');
  const headRepositoryId = positiveInteger(eventRun?.head_repository?.id, 'head repository ID');
  const headRepositoryName = eventRun?.head_repository?.full_name;
  if (typeof headRepositoryName !== 'string' || !repositoryNamePattern.test(headRepositoryName))
    throw new Error('invalid head repository name');
  const fields = [
    'id',
    'workflow_id',
    'name',
    'path',
    'event',
    'run_attempt',
    'status',
    'head_sha',
    'head_branch'
  ];
  if (fields.some(field => apiRun?.[field] !== eventRun?.[field]))
    throw new Error('workflow run API disagrees with event');
  if (
    eventRun.name !== 'CI' ||
    eventRun.path !== '.github/workflows/ci.yml' ||
    eventRun.event !== 'pull_request' ||
    eventRun.status !== 'completed' ||
    positiveInteger(eventRun.workflow_id, 'workflow ID') !== apiRun.workflow_id ||
    eventRun.repository?.id !== repoId ||
    apiRun.repository?.id !== repoId ||
    apiRun.head_repository?.id !== headRepositoryId ||
    apiRun.head_repository?.full_name !== headRepositoryName
  )
    throw new Error('workflow identity or repository mismatch');
  safeRef(eventRun.head_branch, 'run head ref');
  return { repoId, runId, runAttempt, runSha, headRepositoryId, headRepositoryName };
}

function requireCoverageJob(attemptJobs, runAttempt) {
  if (!Array.isArray(attemptJobs)) throw new Error('missing attempt jobs');
  const coverageJobs = attemptJobs.filter(job => job?.name === 'Test Coverage');
  if (
    coverageJobs.length !== 1 ||
    coverageJobs[0].run_attempt !== runAttempt ||
    coverageJobs[0].status !== 'completed' ||
    coverageJobs[0].conclusion !== 'success'
  )
    throw new Error('coverage job did not succeed in this attempt');
}

function requireArtifact(artifacts, { runId, runAttempt, runSha, repoId, headRepositoryId }) {
  if (!Array.isArray(artifacts)) throw new Error('missing artifacts');
  const artifactName = `sonar-pr-lcov-${runId}-${runAttempt}`;
  const matching = artifacts.filter(artifact => artifact?.name === artifactName);
  if (matching.length !== 1) {
    const oldAttempt = artifacts.some(artifact =>
      artifact?.name?.startsWith(`sonar-pr-lcov-${runId}-`)
    );
    throw new Error(oldAttempt ? 'artifact attempt mismatch' : 'missing or duplicate artifact');
  }
  const artifact = matching[0];
  const artifactId = positiveInteger(artifact.id, 'artifact ID');
  if (
    artifact.expired !== false ||
    artifact.workflow_run?.id !== runId ||
    artifact.workflow_run?.repository_id !== repoId ||
    artifact.workflow_run?.head_repository_id !== headRepositoryId ||
    artifact.workflow_run?.head_sha !== runSha ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes < 1 ||
    artifact.size_in_bytes > maxArchiveBytes
  )
    throw new Error('artifact provenance or size mismatch');
  if (typeof artifact.digest !== 'string' || !artifact.digest.startsWith('sha256:'))
    throw new Error('missing artifact digest');
  return {
    artifactName,
    artifactId,
    archiveDigest: digest(artifact.digest.slice('sha256:'.length), 'artifact digest')
  };
}

export function verifyOrigin({
  eventRun,
  apiRun,
  attemptJobs,
  associatedPrs,
  artifacts,
  repositoryId
}) {
  const { repoId, runId, runAttempt, runSha, headRepositoryId, headRepositoryName } = validateRun(
    eventRun,
    apiRun,
    repositoryId
  );
  requireCoverageJob(attemptJobs, runAttempt);
  if (!Array.isArray(associatedPrs) || associatedPrs.length !== 1)
    throw new Error('ambiguous or missing PR association');
  const pr = associatedPrs[0];
  const prNumber = positiveInteger(pr.number, 'PR number');
  const isDependabot = pr.user?.login === 'dependabot[bot]';
  if (headRepositoryId === repoId && !isDependabot) return { trustedDirect: true };
  if (!['open', 'closed'].includes(pr.state)) throw new Error('invalid PR state');
  if (pr.state === 'closed') {
    if (isDependabot && pr.merged)
      return { mergedDependabot: true, mergeSha: sha(pr.merge_commit_sha, 'merge SHA'), prNumber };
    return { superseded: true };
  }
  const headSha = sha(pr.head?.sha, 'PR head SHA');
  const headRef = safeRef(pr.head?.ref, 'PR head ref');
  const baseRef = safeRef(pr.base?.ref, 'PR base ref');
  if (pr.head?.repo?.id !== headRepositoryId || pr.head?.repo?.full_name !== headRepositoryName)
    throw new Error('PR head does not match workflow run repository');
  if (headSha !== runSha || headRef !== eventRun.head_branch) return { superseded: true };
  const { artifactName, artifactId, archiveDigest } = requireArtifact(artifacts, {
    runId,
    runAttempt,
    runSha,
    repoId,
    headRepositoryId
  });
  return {
    runId,
    runAttempt,
    prNumber,
    headRepositoryId,
    headRepositoryName,
    headSha,
    headRef,
    baseRef,
    artifactName,
    artifactId,
    archiveDigest
  };
}

function requireSafeLcovSource(path, trackedFiles, sourceRoot) {
  if (path !== 'index.js' && (!path.startsWith('lib/') || !path.endsWith('.js')))
    throw new Error('LCOV source path outside measured scope');
  if (
    path.includes('..') ||
    path.includes('\\') ||
    path.includes('//') ||
    !/^[A-Za-z0-9_./-]+$/.test(path) ||
    !trackedFiles.has(path)
  )
    throw new Error('unsafe or untracked LCOV source path');
  if (!sourceRoot) return;
  let current = resolve(sourceRoot);
  for (const segment of path.split('/')) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error('symlinked LCOV source path');
  }
  if (!lstatSync(current).isFile()) throw new Error('non-regular LCOV source path');
}

function isLcovDataLine(line, inRecord) {
  if (line.startsWith('DA:')) {
    if (!inRecord || !/^DA:[1-9]\d*,\d+(?:,[^\r\n,]+)?$/.test(line))
      throw new Error('malformed LCOV line data');
    return true;
  }
  if (line.startsWith('TN:') || /^(?:FN|FNDA|BRDA|FNF|FNH|LF|LH|BRF|BRH):/.test(line)) {
    if (!inRecord && !line.startsWith('TN:')) throw new Error('malformed LCOV record');
    return false;
  }
  throw new Error('malformed LCOV report');
}

function addLcovSource(line, seenSources, trackedFiles, sourceRoot) {
  const path = line.slice(3);
  requireSafeLcovSource(path, trackedFiles, sourceRoot);
  if (seenSources.has(path)) throw new Error('incomplete LCOV coverage set: duplicate source');
  seenSources.add(path);
}

function requireCompleteLcov({ inRecord, hasData, seenSources, expectedSources }) {
  if (
    inRecord ||
    !hasData ||
    !expectedSources.has('index.js') ||
    expectedSources.size < 2 ||
    seenSources.size !== expectedSources.size
  )
    throw new Error('incomplete LCOV coverage set');
}

function validateLcovPaths(reportText, trackedFiles, sourceRoot) {
  if (
    typeof reportText !== 'string' ||
    reportText.length === 0 ||
    reportText.length > maxArchiveBytes
  )
    throw new Error('invalid LCOV report');
  if (!(trackedFiles instanceof Set)) throw new Error('missing tracked file set');
  const expectedSources = new Set(
    [...trackedFiles].filter(path => path === 'index.js' || /^lib\/.*\.js$/.test(path))
  );
  const seenSources = new Set();
  let hasData = false;
  let inRecord = false;
  let recordData = false;
  for (const line of reportText.split(/\r?\n/)) {
    if (line === '') continue;
    if (line.startsWith('SF:')) {
      if (inRecord) throw new Error('incomplete LCOV record');
      addLcovSource(line, seenSources, trackedFiles, sourceRoot);
      inRecord = true;
      recordData = false;
    } else if (line === 'end_of_record') {
      if (!inRecord || !recordData) throw new Error('incomplete LCOV record');
      inRecord = false;
    } else {
      const isData = isLcovDataLine(line, inRecord);
      recordData ||= isData;
      hasData ||= isData;
    }
  }
  requireCompleteLcov({ inRecord, hasData, seenSources, expectedSources });
}

export function verifyDownloaded({
  expected,
  manifest,
  entries,
  reportText,
  trackedFiles,
  sourceRoot
}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot)
    throw new Error('missing checkout root for LCOV validation');
  if (!expected || expected.superseded || expected.mergedDependabot)
    throw new Error('no open PR scan expected');
  if (
    !Array.isArray(entries) ||
    entries.length !== 2 ||
    new Set(entries).size !== 2 ||
    !entries.includes('manifest.json') ||
    !entries.includes('lcov.info')
  )
    throw new Error('unexpected artifact entries');
  const validated = createManifest(manifest);
  if (manifest.version !== 1 || Object.keys(manifest).length !== Object.keys(validated).length)
    throw new Error('invalid manifest schema');
  for (const field of ['runId', 'runAttempt', 'prNumber', 'headRepositoryId', 'headSha', 'baseRef'])
    if (validated[field] !== expected[field]) throw new Error(`manifest ${field} mismatch`);
  const reportDigest = createHash('sha256').update(reportText).digest('hex');
  if (!sameDigest(reportDigest, validated.lcovSha256)) throw new Error('LCOV digest mismatch');
  validateLcovPaths(reportText, trackedFiles, sourceRoot);
  return { headSha: expected.headSha, prNumber: expected.prNumber, sha256: reportDigest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'create')
      throw new Error('usage: sonar-pr-artifact.mjs create');
    const reportText = readFileSync('coverage/lcov.info', 'utf8');
    const trackedFiles = new Set(
      execFileSync('/usr/bin/git', ['ls-files', '-z'], { encoding: 'utf8', env: scrubbedEnv() })
        .split('\0')
        .filter(Boolean)
    );
    validateLcovPaths(reportText, trackedFiles, process.cwd());
    const manifest = createManifest({
      runId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      prNumber: Number(process.env.SONAR_PR_NUMBER),
      headRepositoryId: Number(process.env.SONAR_HEAD_REPOSITORY_ID),
      headSha: process.env.SONAR_HEAD_SHA,
      baseRef: process.env.SONAR_BASE_REF,
      lcovSha256: createHash('sha256').update(reportText).digest('hex')
    });
    writeFileSync('coverage/manifest.json', `${JSON.stringify(manifest)}\n`, { flag: 'wx' });
    console.log(`Sonar coverage manifest created for PR #${manifest.prNumber}`);
  } catch (error) {
    console.error(`Sonar coverage manifest rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
