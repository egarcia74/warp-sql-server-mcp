import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import {
  createManifest,
  verifyDownloaded,
  verifyOrigin
} from '../../scripts/ci/sonar-pr-artifact.mjs';
import { runGit } from '../helpers/git.js';

const sha = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const lcov = 'SF:index.js\nDA:1,1\nend_of_record\nSF:lib/config.js\nDA:1,0\nend_of_record\n';
const temporaryDirectories = [];
const script = fileURLToPath(new URL('../../scripts/ci/sonar-pr-artifact.mjs', import.meta.url));
const clone = value => JSON.parse(JSON.stringify(value));

function makeSourceRoot() {
  const directory = mkdtempSync(join(tmpdir(), 'wssm-sonar-source-'));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, 'lib'));
  writeFileSync(join(directory, 'index.js'), 'export {};\n');
  writeFileSync(join(directory, 'lib/config.js'), 'export {};\n');
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

function validOrigin() {
  const eventRun = {
    id: 42,
    workflow_id: 7,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    run_attempt: 2,
    status: 'completed',
    head_sha: sha,
    head_branch: 'fix/coverage',
    repository: { id: 10 },
    head_repository: { id: 20, full_name: 'forker/warp-sql-server-mcp' }
  };
  return {
    repositoryId: 10,
    eventRun,
    apiRun: clone(eventRun),
    attemptJobs: [
      { name: 'Test Coverage', status: 'completed', conclusion: 'success', run_attempt: 2 }
    ],
    associatedPrs: [
      {
        number: 1403,
        state: 'open',
        merged: false,
        head: {
          sha,
          ref: 'fix/coverage',
          repo: { id: 20, full_name: 'forker/warp-sql-server-mcp' }
        },
        base: { ref: 'main' },
        user: { login: 'fork-user' }
      }
    ],
    artifacts: [
      {
        id: 99,
        name: 'sonar-pr-lcov-42-2',
        expired: false,
        digest: `sha256:${digest}`,
        size_in_bytes: 400,
        workflow_run: { id: 42, repository_id: 10, head_repository_id: 20, head_sha: sha }
      }
    ]
  };
}

describe('Sonar PR artifact provenance', () => {
  it('rejects a head repository name that differs from the API or PR', () => {
    const origin = validOrigin();
    origin.associatedPrs[0].head.repo.full_name = 'someone-else/warp-sql-server-mcp';
    expect(() => verifyOrigin(origin)).toThrow(/PR head does not match/i);
  });
  it('binds a successful coverage attempt to exactly one open PR and artifact', () => {
    expect(verifyOrigin(validOrigin())).toMatchObject({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      artifactId: 99,
      archiveDigest: digest
    });
  });

  it('rejects an artifact from an old attempt', () => {
    const origin = validOrigin();
    origin.artifacts[0].name = 'sonar-pr-lcov-42-1';
    expect(() => verifyOrigin(origin)).toThrow(/attempt/i);
  });

  it.each([
    ['wrong workflow', origin => (origin.apiRun.path = '.github/workflows/other.yml')],
    ['wrong repository', origin => (origin.apiRun.repository.id = 11)],
    ['wrong event', origin => (origin.apiRun.event = 'push')],
    ['failed coverage job', origin => (origin.attemptJobs[0].conclusion = 'failure')],
    ['old coverage job', origin => (origin.attemptJobs[0].run_attempt = 1)],
    ['duplicate artifact', origin => origin.artifacts.push(clone(origin.artifacts[0]))],
    ['ambiguous PR', origin => origin.associatedPrs.push(clone(origin.associatedPrs[0]))],
    ['wrong PR head SHA', origin => (origin.associatedPrs[0].head.sha = 'c'.repeat(40))],
    ['wrong PR head repository', origin => (origin.associatedPrs[0].head.repo.id = 21)],
    ['invalid digest', origin => (origin.artifacts[0].digest = 'sha256:xyz')],
    ['unsafe ref', origin => (origin.associatedPrs[0].head.ref = 'evil\n-Dsonar.projectKey=other')]
  ])('rejects %s', (_name, mutate) => {
    const origin = validOrigin();
    mutate(origin);
    expect(() => verifyOrigin(origin)).toThrow();
  });

  it('marks a stale fork PR as superseded instead of scanning it', () => {
    const origin = validOrigin();
    origin.associatedPrs[0].state = 'closed';
    expect(verifyOrigin(origin)).toEqual({ superseded: true });
  });

  it('routes merged Dependabot to the containing-main check', () => {
    const origin = validOrigin();
    origin.apiRun.head_repository.id = 10;
    origin.eventRun.head_repository.id = 10;
    origin.apiRun.head_repository.full_name = 'egarcia74/warp-sql-server-mcp';
    origin.eventRun.head_repository.full_name = 'egarcia74/warp-sql-server-mcp';
    origin.associatedPrs[0].head.repo.id = 10;
    origin.associatedPrs[0].head.repo.full_name = 'egarcia74/warp-sql-server-mcp';
    origin.artifacts[0].workflow_run.head_repository_id = 10;
    origin.associatedPrs[0].user.login = 'dependabot[bot]';
    origin.associatedPrs[0].state = 'closed';
    origin.associatedPrs[0].merged = true;
    origin.associatedPrs[0].merge_commit_sha = 'd'.repeat(40);
    expect(verifyOrigin(origin)).toEqual({
      mergedDependabot: true,
      mergeSha: 'd'.repeat(40),
      prNumber: 1403
    });
  });

  it('creates a manifest with only validated provenance fields', () => {
    expect(
      createManifest({
        runId: 42,
        runAttempt: 2,
        prNumber: 1403,
        headRepositoryId: 20,
        headSha: sha,
        baseRef: 'main',
        lcovSha256: digest
      })
    ).toEqual({
      version: 1,
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      baseRef: 'main',
      lcovSha256: digest
    });
  });

  it('writes a manifest only for tracked coverage paths and exact PR metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wssm-sonar-manifest-'));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, 'lib'));
    mkdirSync(join(directory, 'coverage'));
    writeFileSync(join(directory, 'index.js'), 'export {};\n');
    writeFileSync(join(directory, 'lib/config.js'), 'export {};\n');
    writeFileSync(join(directory, 'coverage/lcov.info'), lcov);
    expect(() => runGit(['init', '-q'], { cwd: directory })).not.toThrow();
    expect(() => runGit(['add', 'index.js', 'lib/config.js'], { cwd: directory })).not.toThrow();
    const result = spawnSync(process.execPath, [script, 'create'], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_RUN_ID: '42',
        GITHUB_RUN_ATTEMPT: '2',
        SONAR_PR_NUMBER: '1403',
        SONAR_HEAD_REPOSITORY_ID: '20',
        SONAR_HEAD_SHA: sha,
        SONAR_BASE_REF: 'main'
      }
    });
    expect(result.status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(directory, 'coverage/manifest.json'), 'utf8'))
    ).toMatchObject({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headSha: sha,
      lcovSha256: '5de7895db38e498ca8bf76a94a91290df160bf4c9083b7f326041632ef6f7a9e'
    });
  });

  it('accepts matching manifest and tracked LCOV paths', () => {
    const sourceRoot = makeSourceRoot();
    const expected = verifyOrigin(validOrigin());
    const manifest = createManifest({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      baseRef: 'main',
      lcovSha256: '5de7895db38e498ca8bf76a94a91290df160bf4c9083b7f326041632ef6f7a9e'
    });
    expect(
      verifyDownloaded({
        expected,
        manifest,
        entries: ['manifest.json', 'lcov.info'],
        reportText: lcov,
        trackedFiles: new Set(['index.js', 'lib/config.js']),
        sourceRoot
      })
    ).toEqual({ headSha: sha, prNumber: 1403, sha256: manifest.lcovSha256 });
  });

  it('rejects a manifest whose LCOV digest differs from the downloaded data', () => {
    const sourceRoot = makeSourceRoot();
    const expected = verifyOrigin(validOrigin());
    const manifest = createManifest({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      baseRef: 'main',
      lcovSha256: 'c'.repeat(64)
    });
    expect(() =>
      verifyDownloaded({
        expected,
        manifest,
        entries: ['manifest.json', 'lcov.info'],
        reportText: lcov,
        trackedFiles: new Set(['index.js', 'lib/config.js']),
        sourceRoot
      })
    ).toThrow(/digest/i);
  });

  it('rejects a tracked LCOV source that resolves through a symlink', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wssm-sonar-symlink-'));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, 'lib'));
    writeFileSync(join(directory, 'index.js'), 'export {};\n');
    symlinkSync(join(directory, 'index.js'), join(directory, 'lib/config.js'));
    const expected = verifyOrigin(validOrigin());
    const manifest = createManifest({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      baseRef: 'main',
      lcovSha256: '5de7895db38e498ca8bf76a94a91290df160bf4c9083b7f326041632ef6f7a9e'
    });
    expect(() =>
      verifyDownloaded({
        expected,
        manifest,
        entries: ['manifest.json', 'lcov.info'],
        reportText: lcov,
        trackedFiles: new Set(['index.js', 'lib/config.js']),
        sourceRoot: directory
      })
    ).toThrow(/symlink/i);
  });

  it.each([
    ['traversal', 'SF:../secret.js\nDA:1,1\nend_of_record\n'],
    ['absolute', 'SF:/tmp/secret.js\nDA:1,1\nend_of_record\n'],
    ['untracked', 'SF:lib/secret.js\nDA:1,1\nend_of_record\n'],
    ['wrong scope', 'SF:test/secret.js\nDA:1,1\nend_of_record\n']
  ])('rejects %s in downloaded LCOV', (_name, reportText) => {
    const sourceRoot = makeSourceRoot();
    const expected = verifyOrigin(validOrigin());
    const manifest = createManifest({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      baseRef: 'main',
      lcovSha256: 'c'.repeat(64)
    });
    expect(() =>
      verifyDownloaded({
        expected,
        manifest,
        entries: ['manifest.json', 'lcov.info'],
        reportText,
        trackedFiles: new Set(['index.js', 'lib/config.js']),
        sourceRoot
      })
    ).toThrow();
  });

  it('requires a checkout root for symlink validation', () => {
    const expected = verifyOrigin(validOrigin());
    const manifest = createManifest({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      baseRef: 'main',
      lcovSha256: '5de7895db38e498ca8bf76a94a91290df160bf4c9083b7f326041632ef6f7a9e'
    });
    expect(() =>
      verifyDownloaded({
        expected,
        manifest,
        entries: ['manifest.json', 'lcov.info'],
        reportText: lcov,
        trackedFiles: new Set(['index.js', 'lib/config.js'])
      })
    ).toThrow(/checkout root/i);
  });
});
