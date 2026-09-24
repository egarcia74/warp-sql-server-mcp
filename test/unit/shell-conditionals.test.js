import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';
import { runGit } from '../helpers/git.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const shellDescribe = process.platform === 'win32' ? describe.skip : describe;
let fixtureDir;
let traceFile;

function stub(name, source) {
  const file = path.join(fixtureDir, name);
  writeFileSync(file, `#!/bin/sh\n${source}\n`);
  chmodSync(file, 0o755);
}

function runRunner(args, dockerRunning) {
  return spawnSync('bash', [path.join(repoRoot, 'scripts/docker-test-runner.sh'), ...args], {
    cwd: fixtureDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixtureDir}${path.delimiter}${process.env.PATH}`,
      TRACE_FILE: traceFile,
      DOCKER_RUNNING: dockerRunning ? '1' : '0'
    },
    timeout: 15_000
  });
}

function trace() {
  return readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean);
}

function prepareInstaller() {
  const repo = path.join(fixtureDir, 'repo with spaces');
  mkdirSync(repo);
  runGit(['init', '-q'], { cwd: repo });
  copyFileSync(
    path.join(repoRoot, 'install-git-hooks.sh'),
    path.join(repo, 'install-git-hooks.sh')
  );
  return repo;
}

function runInstaller(repo) {
  return spawnSync('bash', [path.join(repo, 'install-git-hooks.sh')], {
    cwd: repo,
    encoding: 'utf8',
    env: scrubbedEnv(),
    timeout: 15_000
  });
}

beforeEach(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'shell-conditionals-'));
  traceFile = path.join(fixtureDir, 'trace.txt');
  writeFileSync(traceFile, '');
  stub(
    'docker',
    'printf "docker:%s\\n" "$*" >> "$TRACE_FILE"\nif [ "$DOCKER_RUNNING" = 1 ]; then printf "warp-mcp-sqlserver\\n"; fi'
  );
  stub('npm', 'printf "npm:%s\\n" "$*" >> "$TRACE_FILE"');
  stub('node', 'printf "node:%s\\n" "$*" >> "$TRACE_FILE"');
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

shellDescribe('Docker test runner decisions', () => {
  it('defaults to phase 1 and reuses an already running container', () => {
    const result = runRunner([], true);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('defaulting to phase1');
    expect(trace()).toEqual([
      'docker:ps --filter name=warp-mcp-sqlserver --filter status=running',
      'node:test/integration/manual/phase1-readonly-security.test.js'
    ]);
    expect(result.stdout).not.toContain('Clean run completed');
  });

  it('starts a container when none is running', () => {
    const result = runRunner(['phase2'], false);

    expect(result.status).toBe(0);
    expect(trace()).toEqual([
      'docker:ps --filter name=warp-mcp-sqlserver --filter status=running',
      'npm:run docker:start:init',
      'node:test/integration/manual/phase2-dml-operations.test.js'
    ]);
  });

  it('cleans and starts before all phases without checking a stale container', () => {
    const result = runRunner(['all', '--clean'], true);

    expect(result.status).toBe(0);
    expect(trace()).toEqual([
      'npm:run docker:clean',
      'npm:run docker:start:init',
      'node:test/integration/manual/phase1-readonly-security.test.js',
      'node:test/integration/manual/phase2-dml-operations.test.js',
      'node:test/integration/manual/phase3-ddl-operations.test.js',
      'node:test/protocol/mcp-server-startup-test.js'
    ]);
    expect(result.stdout).toContain('Clean run completed');
  });
});

shellDescribe('Git hook installation decisions', () => {
  it('rejects a missing source hook directory', () => {
    const repo = prepareInstaller();
    const result = runInstaller(repo);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Hooks directory not found');
  });

  it('rejects an empty source hook directory', () => {
    const repo = prepareInstaller();
    mkdirSync(path.join(repo, 'hooks'));
    const result = runInstaller(repo);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('No hooks found');
  });

  it('replaces existing files and broken links, installing only hook files', () => {
    const repo = prepareInstaller();
    const sourceHooks = path.join(repo, 'hooks');
    const gitHooks = path.join(repo, '.git', 'hooks');
    mkdirSync(sourceHooks);
    mkdirSync(path.join(sourceHooks, 'not-a-hook'));
    for (const name of ['pre-commit', 'pre-push']) {
      writeFileSync(path.join(sourceHooks, name), `#!/bin/bash\n# ${name} description\n`);
    }
    writeFileSync(path.join(gitHooks, 'pre-commit'), 'old hook');
    symlinkSync(path.join(fixtureDir, 'missing-target'), path.join(gitHooks, 'pre-push'));

    const result = runInstaller(repo);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Removing existing pre-commit hook');
    expect(result.stdout).toContain('Removing existing pre-push hook');
    expect(result.stdout).toContain('Successfully installed 2 git hook(s)');
    for (const name of ['pre-commit', 'pre-push']) {
      const source = path.join(sourceHooks, name);
      expect(readlinkSync(path.join(gitHooks, name))).toBe(source);
      expect(statSync(source).mode & 0o111).not.toBe(0);
    }
    expect(existsSync(path.join(gitHooks, 'not-a-hook'))).toBe(false);
  });

  it('ignores an inherited Git directory when installing fixture hooks', () => {
    const repo = prepareInstaller();
    const sourceHooks = path.join(repo, 'hooks');
    mkdirSync(sourceHooks);
    writeFileSync(path.join(sourceHooks, 'pre-commit'), '#!/bin/bash\n# fixture hook\n');

    const otherRepo = path.join(fixtureDir, 'other repo');
    mkdirSync(otherRepo);
    runGit(['init', '-q'], { cwd: otherRepo });
    const otherHook = path.join(otherRepo, '.git', 'hooks', 'pre-commit');
    writeFileSync(otherHook, 'unrelated hook');

    const previousGitDir = process.env.GIT_DIR;
    let result;
    try {
      process.env.GIT_DIR = path.join(otherRepo, '.git');
      result = runInstaller(repo);
    } finally {
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
    }

    expect(result.status).toBe(0);
    expect(readFileSync(otherHook, 'utf8')).toBe('unrelated hook');
    expect(readlinkSync(path.join(repo, '.git', 'hooks', 'pre-commit'))).toBe(
      path.join(sourceHooks, 'pre-commit')
    );
  });
});
