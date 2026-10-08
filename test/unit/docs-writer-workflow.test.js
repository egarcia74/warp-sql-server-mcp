import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';
import { runGit } from '../helpers/git.js';

const workflow = YAML.parse(readFileSync('.github/workflows/docs.yml', 'utf8'));
const generate = workflow.jobs['generate-api-docs'];
const writer = workflow.jobs['create-docs-pr'];
const expectedFiles = ['docs-data/tools.json', 'docs/index.html', 'docs/tools.html'];

function step(job, id) {
  return job?.steps?.find(candidate => candidate.id === id);
}

function allowed(job, eventName, ref) {
  if (typeof job?.if !== 'string') return false;
  const github = { event_name: eventName, ref };
  return Function('github', `return Boolean(${job.if});`)(github);
}

function write(root, relative, content) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function git(root, ...args) {
  return runGit(args, { cwd: root }).trim();
}

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-writer-workflow-'));
  const checkout = join(root, 'checkout');
  const artifact = join(root, 'generated-docs');
  mkdirSync(checkout);
  mkdirSync(artifact);

  git(checkout, 'init', '-q');
  git(checkout, 'remote', 'add', 'origin', 'https://github.com/example/project');
  for (const relative of expectedFiles) write(checkout, relative, `old ${relative}\n`);
  git(checkout, 'add', ...expectedFiles);
  git(
    checkout,
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test',
    'commit',
    '-qm',
    'base'
  );

  for (const relative of expectedFiles) {
    write(artifact, relative, overrides.unchanged ? `old ${relative}\n` : `new ${relative}\n`);
  }

  const hashes = Object.fromEntries(
    expectedFiles.map(relative => [
      relative,
      createHash('sha256')
        .update(readFileSync(join(artifact, relative)))
        .digest('hex')
    ])
  );

  return { root, checkout, artifact, hashes };
}

function preflight(options = {}) {
  const item = fixture(options);
  const output = join(item.root, 'job-output');
  writeFileSync(output, '');
  const shell = step(writer, 'validate-generated-docs')?.run ?? 'exit 99';

  const run = (envOverrides = {}) =>
    spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
      cwd: item.checkout,
      encoding: 'utf8',
      env: {
        ...scrubbedEnv(),
        GITHUB_WORKSPACE: item.checkout,
        RUNNER_TEMP: item.root,
        GITHUB_OUTPUT: output,
        DOCS_INDEX_SHA256: item.hashes['docs/index.html'],
        DOCS_TOOLS_SHA256: item.hashes['docs/tools.html'],
        TOOLS_JSON_SHA256: item.hashes['docs-data/tools.json'],
        TOOLS_COUNT: '16',
        ...envOverrides
      }
    });

  return {
    ...item,
    output,
    run,
    cleanup: () => rmSync(item.root, { recursive: true, force: true })
  };
}

function credentialedRun(item, overrides = {}) {
  const fakeBin = join(item.root, 'fake-bin');
  mkdirSync(fakeBin);
  const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const gitShim = join(fakeBin, 'git');
  writeFileSync(
    gitShim,
    `#!/usr/bin/env bash\nargs=("$@")\nwhile [[ "$1" == -c ]]; do shift 2; done\nif [[ "$1" == push ]]; then printf '%s\\n' "$@" >> "$TEST_PUSH_LOG"; exit 0; fi\nexec '${gitPath}' "\${args[@]}"\n`
  );
  chmodSync(gitShim, 0o755);
  const ghShim = join(fakeBin, 'gh');
  writeFileSync(
    ghShim,
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$TEST_GH_LOG"\nif [[ "$*" == *"/pulls"* ]]; then\n  if [ "${GH_FAIL_PULLS:-}" = 1 ]; then exit 1; fi\n  echo 123\nfi\n'
  );
  chmodSync(ghShim, 0o755);

  const script = step(writer, 'create-documentation-pr')?.run ?? 'exit 99';
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: item.checkout,
    encoding: 'utf8',
    env: {
      ...scrubbedEnv(),
      PATH: `${fakeBin}:${process.env.PATH}`,
      RUNNER_TEMP: item.root,
      GITHUB_REPOSITORY: 'example/project',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      DOCS_PAT: 'test-secret',
      TOOLS_COUNT: '16',
      TEST_PUSH_LOG: join(item.root, 'push-log'),
      TEST_GH_LOG: join(item.root, 'gh-log'),
      ...overrides
    }
  });
}

describe('documentation writer trust boundary', () => {
  it.each([
    ['main push', 'push', 'refs/heads/main', true],
    ['main dispatch', 'workflow_dispatch', 'refs/heads/main', true],
    ['pull request', 'pull_request', 'refs/pull/123/merge', false],
    ['fork pull request', 'pull_request', 'refs/pull/456/merge', false],
    ['schedule', 'schedule', 'refs/heads/main', false],
    ['other-branch push', 'push', 'refs/heads/feature', false],
    ['other-branch dispatch', 'workflow_dispatch', 'refs/heads/feature', false]
  ])('%s reaches both jobs only when expected', (_name, event, ref, expected) => {
    expect(allowed(generate, event, ref)).toBe(expected);
    expect(allowed(writer, event, ref)).toBe(expected);
  });

  it('generates from the exact event SHA without a writable token', () => {
    expect(generate?.permissions).toEqual({ contents: 'read' });
    const checkout = step(generate, 'checkout-source');
    expect(checkout?.with?.ref).toBe('${{ github.sha }}');
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    const source = JSON.stringify(generate);
    expect(source).not.toContain('DOCS_PAT');
    expect(source).not.toContain('contents":"write');
    expect(source).not.toContain('pull-requests":"write');
  });

  it('downloads only the same-run generated artifact into the writer', () => {
    expect(writer?.needs).toBe('generate-api-docs');
    const upload = step(generate, 'upload-generated-docs');
    const download = step(writer, 'download-generated-docs');
    expect(upload?.with?.['if-no-files-found']).toBe('error');
    expect(upload?.with?.path.trim().split(/\s+/).sort()).toEqual(expectedFiles);
    expect(upload?.with?.name).toContain('${{ github.run_id }}');
    expect(upload?.with?.name).toContain('${{ github.run_attempt }}');
    expect(download?.with?.name).toBe(upload?.with?.name);
    expect(download?.with).not.toHaveProperty('run-id');
    expect(download?.with).not.toHaveProperty('repository');
    expect(download?.with).not.toHaveProperty('github-token');
  });

  it('includes the writer result in the documentation summary', () => {
    expect(workflow.jobs.summary.needs).toContain('create-docs-pr');
    expect(JSON.stringify(workflow.jobs.summary)).toContain('needs.create-docs-pr.result');
  });

  it('keeps a write token out of the generator and writer preflight', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(writer?.permissions).toEqual({ contents: 'read' });
    const checkout = step(writer, 'checkout-main');
    expect(checkout?.with?.ref).toBe('${{ github.sha }}');
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    const credentialed = step(writer, 'create-documentation-pr');
    expect(credentialed?.env?.DOCS_PAT).toBe('${{ secrets.DOCS_PAT }}');
    expect(JSON.stringify(credentialed)).not.toContain('secrets.GITHUB_TOKEN');
    expect(JSON.stringify(credentialed)).not.toContain('github.token');
    expect(writer?.steps?.at(-1)?.id).toBe('create-documentation-pr');
    expect(credentialed?.if).toBe("steps.validate-generated-docs.outputs.changed == 'true'");
    for (const prior of writer?.steps?.slice(0, -1) ?? []) {
      expect(JSON.stringify(prior)).not.toMatch(/DOCS_PAT|npm |npx |node |scripts\//);
    }
  });
});

describe('generated artifact preflight', () => {
  it('stages exactly the three verified files and reports a change', () => {
    const item = preflight();
    try {
      const result = item.run();
      expect(result.status, result.stderr).toBe(0);
      expect(git(item.checkout, 'diff', '--cached', '--name-only').split('\n')).toEqual(
        expectedFiles
      );
      expect(readFileSync(item.output, 'utf8')).toContain('changed=true');
    } finally {
      item.cleanup();
    }
  });

  it('skips the credentialed step when generated files match the checkout', () => {
    const item = preflight({ unchanged: true });
    try {
      const result = item.run();
      expect(result.status, result.stderr).toBe(0);
      expect(git(item.checkout, 'diff', '--cached', '--name-only')).toBe('');
      expect(readFileSync(item.output, 'utf8')).toContain('changed=false');
    } finally {
      item.cleanup();
    }
  });

  it('rejects an artifact with an unexpected file', () => {
    const item = preflight();
    try {
      write(item.artifact, 'docs/extra.html', 'unexpected');
      expect(item.run().status).not.toBe(0);
    } finally {
      item.cleanup();
    }
  });

  it('rejects an artifact missing one of the required files', () => {
    const item = preflight();
    try {
      rmSync(join(item.artifact, 'docs/tools.html'));
      expect(item.run().status).not.toBe(0);
    } finally {
      item.cleanup();
    }
  });

  it('rejects a symlink even when all expected file hashes match', () => {
    const item = preflight();
    try {
      symlinkSync(join(item.artifact, 'docs/index.html'), join(item.artifact, 'docs/link.html'));
      expect(item.run().status).not.toBe(0);
    } finally {
      item.cleanup();
    }
  });

  it('rejects modified bytes after artifact upload', () => {
    const item = preflight();
    try {
      write(item.artifact, 'docs/tools.html', 'changed after hashing');
      expect(item.run().status).not.toBe(0);
    } finally {
      item.cleanup();
    }
  });

  it('rejects a malformed hash output before copying', () => {
    const item = preflight();
    try {
      expect(item.run({ DOCS_INDEX_SHA256: 'invalid' }).status).not.toBe(0);
      expect(git(item.checkout, 'diff', '--cached', '--name-only')).toBe('');
    } finally {
      item.cleanup();
    }
  });

  it.each(['0', '-1', '1000', 'oops', '16; echo injected'])(
    'rejects invalid tool counts: %s',
    count => {
      const item = preflight();
      try {
        expect(item.run({ TOOLS_COUNT: count }).status).not.toBe(0);
      } finally {
        item.cleanup();
      }
    }
  );
});

describe('documentation PR write step', () => {
  it('fails before commit or push when DOCS_PAT is absent', () => {
    const item = preflight();
    try {
      expect(item.run().status).toBe(0);
      const before = git(item.checkout, 'rev-parse', 'HEAD');
      const result = credentialedRun(item, { DOCS_PAT: '' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/DOCS_PAT/);
      expect(git(item.checkout, 'rev-parse', 'HEAD')).toBe(before);
    } finally {
      item.cleanup();
    }
  }, 30000);

  it('makes one token-free non-force push and creates a PR for the run branch', () => {
    const item = preflight();
    try {
      expect(item.run().status).toBe(0);
      const result = credentialedRun(item);
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(item.root, 'push-log'), 'utf8')).toBe(
        'push\norigin\nHEAD:refs/heads/docs/auto-update-123-1\n'
      );
      const ghArgs = readFileSync(join(item.root, 'gh-log'), 'utf8');
      expect(ghArgs).toContain('repos/example/project/pulls');
      expect(ghArgs).not.toContain('test-secret');
      expect(readFileSync(join(item.checkout, '.git/config'), 'utf8')).not.toContain('test-secret');
    } finally {
      item.cleanup();
    }
  }, 30000);

  it('does not execute repository git hooks while the PAT is present', () => {
    const item = preflight();
    try {
      const script = step(writer, 'create-documentation-pr').run;
      expect(script).toMatch(/git -c core\.hooksPath=\/dev\/null commit/);
      expect(script).toMatch(/git -c core\.hooksPath=\/dev\/null -c credential\.helper= push/);
      expect(item.run().status).toBe(0);
      const hook = join(item.checkout, '.git/hooks/pre-commit');
      writeFileSync(hook, '#!/usr/bin/env bash\necho executed > "$TEST_HOOK_MARKER"\nexit 1\n');
      chmodSync(hook, 0o755);
      const result = credentialedRun(item, { TEST_HOOK_MARKER: join(item.root, 'hook-executed') });
      expect(result.status, result.stderr).toBe(0);
      expect(() => readFileSync(join(item.root, 'hook-executed'))).toThrow();
    } finally {
      item.cleanup();
    }
  }, 30000);

  it('reports the created branch without deleting it if PR creation fails', () => {
    const item = preflight();
    try {
      expect(item.run().status).toBe(0);
      const result = credentialedRun(item, { GH_FAIL_PULLS: '1' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('docs/auto-update-123-1');
      expect(readFileSync(join(item.root, 'push-log'), 'utf8')).toBe(
        'push\norigin\nHEAD:refs/heads/docs/auto-update-123-1\n'
      );
    } finally {
      item.cleanup();
    }
  }, 30000);
});
