import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubbedEnv } from './verify-publish-tree.mjs';

const repository = 'egarcia74/warp-sql-server-mcp';
const shaPattern = /^[a-f0-9]{40}$/i;

function validSha(value, label) {
  if (typeof value !== 'string' || !shaPattern.test(value)) throw new Error(`invalid ${label}`);
  return value.toLowerCase();
}

function validId(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${label}`);
  return value;
}

export function isDirectScanEligible({
  eventName,
  branch,
  headRepositoryId,
  repositoryId,
  author
}) {
  if (eventName === 'push') return branch === 'main';
  if (eventName !== 'pull_request') return false;
  return (
    Number.isSafeInteger(headRepositoryId) &&
    Number.isSafeInteger(repositoryId) &&
    headRepositoryId === repositoryId &&
    author !== 'dependabot[bot]'
  );
}

export function decideScan({
  eventName,
  checkedOutSha,
  remoteMainSha,
  expectedBase,
  expectedRepositoryId,
  pr
}) {
  const checkout = validSha(checkedOutSha, 'checkout SHA');
  if (eventName === 'push') {
    return checkout === validSha(remoteMainSha, 'remote main SHA')
      ? { scan: true }
      : { scan: false, reason: 'superseded main' };
  }
  if (eventName !== 'pull_request') throw new Error('unsupported scan event');
  validId(expectedRepositoryId, 'expected repository ID');
  if (typeof expectedBase !== 'string' || !expectedBase || /[\r\n\0]/.test(expectedBase))
    throw new Error('invalid expected base');
  if (!pr || typeof pr !== 'object') throw new Error('missing PR state');
  const currentHead = validSha(pr.head?.sha, 'current PR head SHA');
  if (!validId(pr.head?.repo?.id, 'current PR head repository ID'))
    throw new Error('invalid current PR head repository ID');
  if (typeof pr.base?.ref !== 'string' || !pr.base.ref) throw new Error('missing current PR base');
  if (
    pr.state !== 'open' ||
    currentHead !== checkout ||
    pr.head.repo.id !== expectedRepositoryId ||
    pr.base.ref !== expectedBase
  )
    return { scan: false, reason: 'superseded PR' };
  return { scan: true };
}

async function fetchJson(path, token) {
  const response = await globalThis.fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    redirect: 'error',
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== 'preflight')
    throw new Error('usage: sonar-scan-guard.mjs preflight');
  if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('unexpected repository');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('missing GitHub read token');
  const eventName = process.env.GITHUB_EVENT_NAME;
  const checkedOutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    env: scrubbedEnv()
  }).trim();
  const eligible = isDirectScanEligible({
    eventName,
    branch: process.env.GITHUB_REF === 'refs/heads/main' ? 'main' : undefined,
    headRepositoryId: Number(process.env.SONAR_HEAD_REPOSITORY_ID),
    repositoryId: Number(process.env.GITHUB_REPOSITORY_ID),
    author: process.env.SONAR_PR_AUTHOR
  });
  if (!eligible) throw new Error('event is not eligible for direct Sonar scan');
  let decision;
  if (eventName === 'push') {
    const ref = await fetchJson('/git/ref/heads/main', token);
    decision = decideScan({ eventName, checkedOutSha, remoteMainSha: ref.object?.sha });
  } else {
    const prNumber = Number(process.env.SONAR_PR_NUMBER);
    validId(prNumber, 'PR number');
    const pr = await fetchJson(`/pulls/${prNumber}`, token);
    decision = decideScan({
      eventName,
      checkedOutSha,
      expectedBase: process.env.SONAR_BASE_REF,
      expectedRepositoryId: Number(process.env.GITHUB_REPOSITORY_ID),
      pr
    });
  }
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('missing workflow output file');
  appendFileSync(output, `scan=${decision.scan}\n`);
  if (!decision.scan) {
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Sonar scan skipped: ${decision.reason}.\n`);
    console.log(`Sonar scan skipped: ${decision.reason}.`);
  } else {
    console.log(`Sonar scan preflight passed for ${checkedOutSha}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Sonar scan preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
