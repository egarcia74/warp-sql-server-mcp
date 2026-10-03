import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runGit } from '../helpers/git.js';
import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  lstatSync,
  existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  resolveFollowup,
  finalRead,
  checkContainingMain,
  verifyDownload
} from '../../scripts/ci/sonar-pr-followup.mjs';

const sha = 'a'.repeat(40),
  mergeSha = 'b'.repeat(40);
const prefix = '/repos/egarcia74/warp-sql-server-mcp';
const roots = [];
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), 'sonar-followup-'));
  roots.push(root);
  return root;
};
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const pr = {
    number: 1403,
    head: { repo: { id: 9 }, sha, ref: 'feature/coverage' },
    base: { repo: { id: 7 }, ref: 'main' },
    state: 'open',
    merged: false,
    user: { login: 'contributor', type: 'User' }
  };
  const run = {
    id: 42,
    run_attempt: 2,
    workflow_id: 11,
    path: '.github/workflows/ci.yml',
    name: 'CI',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'failure',
    repository: { id: 7 },
    head_repository: { id: 9 },
    head_sha: sha,
    head_branch: pr.head.ref,
    pull_requests: [globalThis.structuredClone(pr)]
  };
  const data = {
    [prefix]: { id: 7 },
    [`${prefix}/actions/workflows/ci.yml`]: {
      id: 11,
      path: '.github/workflows/ci.yml',
      name: 'CI'
    },
    [`${prefix}/actions/runs/42`]: run,
    [`${prefix}/pulls/1403`]: pr,
    [`${prefix}/commits/${sha}/pulls?per_page=100&page=1`]: [globalThis.structuredClone(pr)],
    ['/repositories/9']: { id: 9, full_name: 'contributor/fork' },
    [`${prefix}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [
        {
          name: 'Test Coverage',
          run_id: 42,
          run_attempt: 2,
          head_sha: sha,
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-10-03T01:00:00Z',
          completed_at: '2026-10-03T01:05:00Z'
        }
      ]
    },
    [`${prefix}/actions/runs/42/artifacts?per_page=100&page=1`]: {
      total_count: 1,
      artifacts: [
        {
          id: 12,
          name: 'sonar-coverage-42-2',
          expired: false,
          size_in_bytes: 500,
          digest: 'sha256:' + 'c'.repeat(64),
          created_at: '2026-10-03T01:04:00Z',
          workflow_run: {
            id: 42,
            repository_id: 7,
            head_repository_id: 9,
            head_sha: sha,
            head_branch: pr.head.ref
          }
        }
      ]
    }
  };
  return {
    data,
    pr,
    run,
    fetch: async url => {
      if (!(url in data)) throw new Error('Unexpected API URL: ' + url);
      return globalThis.structuredClone(data[url]);
    }
  };
}

describe('follow-up authenticated resolution', () => {
  it.each([
    'feature/${env.SONAR_TOKEN}',
    'feature/${sonar.projectKey}',
    'feature/${unknown}',
    'feature/${future-syntax}'
  ])('fails closed before scanner property interpolation for %s', async ref => {
    const f = fixture();
    f.run.head_branch = f.pr.head.ref = f.run.pull_requests[0].head.ref = ref;
    f.data[
      `${prefix}/actions/runs/42/artifacts?per_page=100&page=1`
    ].artifacts[0].workflow_run.head_branch = ref;
    await expect(resolveFollowup(42, f.fetch)).rejects.toThrow(/interpolation/i);
  });
  it('uses the authenticated Dependabot PR author when a maintainer triggers the run', async () => {
    const f = fixture();
    f.run.actor = { login: 'maintainer' };
    f.run.head_repository.id = 7;
    f.pr.head.repo.id = 7;
    f.pr.user = { login: 'dependabot[bot]', type: 'Bot' };
    f.run.pull_requests[0].head.repo.id = 7;
    f.data[
      `${prefix}/actions/runs/42/artifacts?per_page=100&page=1`
    ].artifacts[0].workflow_run.head_repository_id = 7;
    f.data['/repositories/7'] = { id: 7, full_name: 'egarcia74/warp-sql-server-mcp' };
    const job = load(readFileSync('.github/workflows/sonar-pr-followup.yml', 'utf8')).jobs.followup;
    const admitted = new Function('github', 'vars', `return (${job.if});`)(
      { event: { workflow_run: f.run, repository: { id: 7 } } },
      { SONAR_CI_ENABLED: 'true' }
    );
    expect(admitted).toBe(true);
    const ci = load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.coverage;
    const github = {
      event_name: 'pull_request',
      actor: 'maintainer',
      event: { repository: { id: 7 }, pull_request: f.pr }
    };
    const evaluate = expression =>
      new Function(
        'github',
        'vars',
        'steps',
        `return (${expression.replaceAll('steps.sonar-freshness', 'steps["sonar-freshness"]')});`
      )(
        github,
        { SONAR_CI_ENABLED: 'true' },
        { 'sonar-freshness': { outputs: { decision: 'scan' } } }
      );
    expect(
      evaluate(ci.steps.find(step => step.name === 'Create isolated-analysis coverage manifest').if)
    ).toBe(true);
    expect(evaluate(ci.steps.find(step => step.id === 'sonar-scan').if)).toBe(false);
    expect(await resolveFollowup(42, f.fetch)).toMatchObject({ dependabot: true, artifactId: 12 });
  });
  it('skips authenticated ordinary same-repository PRs without demanding a fork artifact', async () => {
    const f = fixture();
    f.run.head_repository.id = f.pr.head.repo.id = f.run.pull_requests[0].head.repo.id = 7;
    f.data[`${prefix}/actions/runs/42/artifacts?per_page=100&page=1`] = {
      total_count: 0,
      artifacts: []
    };
    expect(await resolveFollowup(42, f.fetch)).toMatchObject({ ineligible: true });
  });
  it('resolves empty run PR list via commit association', async () => {
    const f = fixture();
    f.run.pull_requests = [];
    expect(await resolveFollowup(42, f.fetch)).toMatchObject({
      prNumber: 1403,
      artifactId: 12,
      headSha: sha,
      headRepository: 'contributor/fork'
    });
  });
  it('rejects ambiguity', async () => {
    const f = fixture();
    f.run.pull_requests = [];
    f.data[`${prefix}/commits/${sha}/pulls?per_page=100&page=1`].push({ ...f.pr, number: 1404 });
    await expect(resolveFollowup(42, f.fetch)).rejects.toThrow(/ambiguous/i);
  });
  it.each([
    [
      'wrong attempt',
      f =>
        (f.data[
          `${prefix}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`
        ].jobs[0].run_attempt = 1)
    ],
    [
      'missing artifact',
      f => {
        f.data[`${prefix}/actions/runs/42/artifacts?per_page=100&page=1`] = {
          total_count: 0,
          artifacts: []
        };
      }
    ],
    ['malformed run', f => (f.run.pull_requests = null)],
    ['wrong workflow ID', f => (f.run.workflow_id = 19)],
    [
      'malformed count',
      f => (f.data[`${prefix}/actions/runs/42/artifacts?per_page=100&page=1`].total_count = -1)
    ],
    [
      'repository output injection',
      f => (f.data['/repositories/9'].full_name = 'fork/repo\nevil=true')
    ],
    ['API identity mismatch', f => (f.run.id = 43)]
  ])('rejects %s', async (_, mutate) => {
    const f = fixture();
    mutate(f);
    await expect(resolveFollowup(42, f.fetch)).rejects.toThrow();
  });
  it('propagates API failure', async () => {
    await expect(
      resolveFollowup(42, async () => {
        throw new Error('offline');
      })
    ).rejects.toThrow();
  });
  it('rejects an ambiguous artifact found only on a later page', async () => {
    const f = fixture();
    const url = `${prefix}/actions/runs/42/artifacts?per_page=100&page=1`;
    const artifact = f.data[url].artifacts[0];
    f.data[url] = {
      total_count: 101,
      artifacts: [artifact, ...Array.from({ length: 99 }, (_, i) => ({ name: `other-${i}` }))]
    };
    f.data[url.replace('&page=1', '&page=2')] = {
      total_count: 101,
      artifacts: [{ ...artifact, id: 13 }]
    };
    await expect(resolveFollowup(42, f.fetch)).rejects.toThrow(/ambiguous/i);
  });
  it.each(['closed', 'stale'])('marks a %s fork superseded', async state => {
    const f = fixture();
    if (state === 'closed') f.pr.state = 'closed';
    else f.pr.head.sha = mergeSha;
    expect(await resolveFollowup(42, f.fetch)).toMatchObject({ superseded: true });
  });
  it('binds event attempt before accepting API evidence', async () => {
    const f = fixture();
    const eventRun = { ...f.run, run_attempt: 1 };
    await expect(resolveFollowup(42, f.fetch, { eventRun })).rejects.toThrow(/attempt/i);
  });
  it('routes merged Dependabot with verified SHA', async () => {
    const f = fixture();
    f.pr.user = { login: 'dependabot[bot]', type: 'Bot' };
    f.pr.state = 'closed';
    f.pr.merged = true;
    f.pr.merge_commit_sha = mergeSha;
    expect(await resolveFollowup(42, f.fetch)).toMatchObject({
      mergedDependabot: true,
      mergeSha,
      prNumber: 1403
    });
  });
  it.each(['push', 'close', 'base', 'merge'])(
    'rechecks %s immediately before scanning',
    async change => {
      const f = fixture();
      const expected = await resolveFollowup(42, f.fetch);
      if (change === 'push') f.pr.head.sha = mergeSha;
      if (change === 'close') f.pr.state = 'closed';
      if (change === 'base') f.pr.base.ref = 'release';
      if (change === 'merge') {
        f.pr.state = 'closed';
        f.pr.merged = true;
        f.pr.merge_commit_sha = mergeSha;
        f.pr.user = { login: 'dependabot[bot]', type: 'Bot' };
      }
      const result = await finalRead(expected, f.fetch);
      expect(result).toMatchObject(
        change === 'merge' ? { mergedDependabot: true, mergeSha } : { superseded: true }
      );
    }
  );
});

describe('merged Dependabot containing main verification', () => {
  function evidence() {
    const date = '2026-10-04T01:00:00+0000';
    const analysis = { analyses: [{ key: 'analysis-1', revision: sha, date }] };
    return {
      analysis,
      fetchSonar: async path =>
        path.startsWith('/api/project_analyses/')
          ? globalThis.structuredClone(analysis)
          : {
              paging: { pageIndex: 1, pageSize: 1000, total: 1 },
              measures: [
                { metric: 'lines_to_cover', history: [{ date, value: '10' }] },
                { metric: 'conditions_to_cover', history: [{ date, value: '2' }] },
                { metric: 'line_coverage', history: [{ date, value: '80' }] },
                { metric: 'branch_coverage', history: [{ date, value: '50' }] }
              ]
            },
      fetchGithub: async path => {
        expect(path).toBe(`${prefix}/compare/${mergeSha}...${sha}`);
        return { status: 'ahead', merge_base_commit: { sha: mergeSha } };
      }
    };
  }
  it('recognizes stable processed main coverage containing the merge', async () => {
    const e = evidence();
    expect(await checkContainingMain(mergeSha, e.fetchGithub, e.fetchSonar)).toEqual({
      containingMain: true,
      analysisSha: sha
    });
  });
  it('reports pending when no coverage or API is available', async () => {
    const e = evidence();
    expect(
      await checkContainingMain(mergeSha, e.fetchGithub, async () => {
        throw new Error('secret <script>');
      })
    ).toEqual({ catchUpNeeded: true });
  });
  it('does not accept populated current measures when target history has no values', async () => {
    const e = evidence();
    const get = async path => {
      if (path.startsWith('/api/measures/component'))
        return {
          component: {
            key: 'egarcia74_warp-sql-server-mcp',
            analysisDate: e.analysis.analyses[0].date,
            measures: [
              'lines_to_cover',
              'conditions_to_cover',
              'line_coverage',
              'branch_coverage'
            ].map(metric => ({ metric, value: '10' }))
          }
        };
      const result = await e.fetchSonar(path);
      if (result.measures) result.measures.forEach(metric => delete metric.history[0].value);
      return result;
    };
    expect(await checkContainingMain(mergeSha, e.fetchGithub, get)).toEqual({
      catchUpNeeded: true
    });
  });
  it.each(['missing', 'duplicate', 'date'])('rejects %s historical evidence', async kind => {
    const e = evidence();
    const get = async path => {
      const result = await e.fetchSonar(path);
      if (result.measures) {
        if (kind === 'missing') delete result.measures[0].history[0].value;
        if (kind === 'duplicate')
          result.measures[0].history.push({ ...result.measures[0].history[0] });
        if (kind === 'date') result.measures[0].history[0].date = '2026-10-01T00:00:00Z';
      }
      return result;
    };
    expect(await checkContainingMain(mergeSha, e.fetchGithub, get)).toEqual({
      catchUpNeeded: true
    });
  });
  it('does not accept coverage from a different analysis', async () => {
    const e = evidence();
    let calls = 0;
    const get = async path => {
      const result = await e.fetchSonar(path);
      if (path.startsWith('/api/project_analyses/') && ++calls === 2)
        result.analyses[0].key = 'analysis-2';
      return result;
    };
    expect(await checkContainingMain(mergeSha, e.fetchGithub, get)).toEqual({
      catchUpNeeded: true
    });
  });
  it('does not treat unrelated revision as containing', async () => {
    const e = evidence();
    expect(
      await checkContainingMain(
        mergeSha,
        async () => ({ status: 'diverged', merge_base_commit: { sha: 'c'.repeat(40) } }),
        e.fetchSonar
      )
    ).toEqual({ catchUpNeeded: true });
  });
});

describe('download and hostile source boundary', () => {
  const report =
    'SF:index.js\nDA:1,1\nBRDA:1,0,0,1\nend_of_record\nSF:lib/a.js\nDA:1,1\nend_of_record\n';
  async function download() {
    const f = fixture(),
      expected = await resolveFollowup(42, f.fetch),
      root = temp(),
      source = join(root, 'source'),
      artifact = join(root, 'artifact');
    mkdirSync(source);
    mkdirSync(artifact);
    mkdirSync(join(source, 'lib'));
    writeFileSync(join(source, 'index.js'), '');
    writeFileSync(join(source, 'lib/a.js'), '');
    runGit(['init', '-q', source]);
    runGit(['-C', source, 'add', 'index.js', 'lib/a.js']);
    writeFileSync(
      join(source, 'sonar-project.properties'),
      'sonar.projectKey=attacker\nsonar.exclusions=**\n'
    );
    const manifest = {
      schemaVersion: 1,
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 9,
      headSha: sha,
      baseRef: 'main',
      lcovSha256: createHash('sha256').update(report).digest('hex')
    };
    writeFileSync(join(artifact, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(artifact, 'lcov.info'), report);
    return { expected, source, artifact, root };
  }
  it('validates and places only trusted coverage without executing hostile source', async () => {
    const f = await download();
    expect(verifyDownload(f.artifact, f.source, f.expected)).toMatchObject({
      prNumber: 1403,
      headSha: sha
    });
    expect(readFileSync(join(f.source, 'coverage/lcov.info'), 'utf8')).toBe(report);
  });
  it('keeps inherited Git hook variables from redirecting source validation', async () => {
    const f = await download();
    vi.stubEnv('GIT_INDEX_FILE', join(f.root, 'unrelated-index'));
    try {
      expect(verifyDownload(f.artifact, f.source, f.expected)).toMatchObject({ headSha: sha });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each(['outside-file', 'outside-directory', 'chain', 'cycle', 'dangling', 'internal'])(
    'rejects a real Git checkout with a non-LCOV %s symlink',
    async kind => {
      const f = await download();
      mkdirSync(join(f.source, 'docs'));
      writeFileSync(join(f.root, 'outside.js'), 'outside source');
      const targets = {
        'outside-file': join(f.root, 'outside.js'),
        'outside-directory': f.root,
        chain: 'second.js',
        cycle: 'leak.js',
        dangling: join(f.root, 'absent.js'),
        internal: '../index.js'
      };
      symlinkSync(targets[kind], join(f.source, 'docs/leak.js'));
      if (kind === 'chain')
        symlinkSync(join(f.root, 'outside.js'), join(f.source, 'docs/second.js'));
      runGit(['add', '.'], { cwd: f.source });
      runGit(
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          '-c',
          'core.hooksPath=/dev/null',
          'commit',
          '-qm',
          'fixture'
        ],
        { cwd: f.source }
      );
      expect(runGit(['ls-files', '--stage', 'docs/leak.js'], { cwd: f.source })).toMatch(
        /^120000 /
      );
      const checkout = join(f.root, 'checkout');
      runGit(['clone', '-q', '--no-hardlinks', f.source, checkout]);
      expect(lstatSync(join(checkout, 'docs/leak.js')).isSymbolicLink()).toBe(true);
      expect(() => verifyDownload(f.artifact, checkout, f.expected)).toThrow(/symlink/i);
      expect(existsSync(join(checkout, 'coverage/lcov.info'))).toBe(false);
    }
  );
  it('rejects untracked directory symlinks outside LCOV before placement', async () => {
    const f = await download();
    mkdirSync(join(f.source, 'extra'));
    symlinkSync(f.root, join(f.source, 'extra/directory'));
    expect(() => verifyDownload(f.artifact, f.source, f.expected)).toThrow(/symlink/i);
    expect(existsSync(join(f.source, 'coverage/lcov.info'))).toBe(false);
  });
  it.each(['coverage', 'source', 'manifest'])('rejects %s symlink before placement', async kind => {
    const f = await download();
    if (kind === 'coverage') symlinkSync(f.root, join(f.source, 'coverage'));
    if (kind === 'source') {
      rmSync(join(f.source, 'lib/a.js'));
      symlinkSync(join(f.root, 'outside.js'), join(f.source, 'lib/a.js'));
    }
    if (kind === 'manifest') {
      const file = join(f.artifact, 'manifest.json');
      const text = readFileSync(file);
      rmSync(file);
      writeFileSync(join(f.root, 'manifest'), text);
      symlinkSync(join(f.root, 'manifest'), file);
    }
    expect(() => verifyDownload(f.artifact, f.source, f.expected)).toThrow();
  });
  it('rejects manifest mismatch before checkout', async () => {
    const f = await download();
    const file = join(f.artifact, 'manifest.json');
    const manifest = JSON.parse(readFileSync(file));
    manifest.prNumber++;
    writeFileSync(file, JSON.stringify(manifest));
    expect(() => verifyDownload(f.artifact, undefined, f.expected)).toThrow(/provenance/i);
  });
  it('sanitizes CLI errors without emitting attacker input', () => {
    const f = temp();
    const event = join(f, 'event');
    writeFileSync(event, '<script>ATTACK</script>');
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/ci/sonar-pr-followup.mjs'), 'preflight', '42'],
      { env: { ...process.env, GITHUB_EVENT_PATH: event, RUNNER_TEMP: f }, encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('ATTACK');
  });
  it('links the originating run even when API provenance fails, without reflecting its error', () => {
    const root = temp(),
      event = join(root, 'event.json'),
      summary = join(root, 'summary.md'),
      loader = join(root, 'offline.mjs');
    writeFileSync(
      event,
      JSON.stringify({
        repository: { id: 7, full_name: 'egarcia74/warp-sql-server-mcp' },
        workflow_run: fixture().run
      })
    );
    writeFileSync(
      loader,
      'globalThis.fetch = async () => { throw new Error("ATTACK <script> secret"); };'
    );
    const result = spawnSync(
      process.execPath,
      ['--import', loader, resolve('scripts/ci/sonar-pr-followup.mjs'), 'preflight', '42'],
      {
        env: {
          ...scrubbedEnv(),
          GITHUB_EVENT_PATH: event,
          GITHUB_STEP_SUMMARY: summary,
          RUNNER_TEMP: root
        },
        encoding: 'utf8'
      }
    );
    expect(result.status).toBe(1);
    expect(readFileSync(summary, 'utf8')).toContain(
      'https://github.com/egarcia74/warp-sql-server-mcp/actions/runs/42'
    );
    expect(readFileSync(summary, 'utf8') + result.stderr).not.toContain('ATTACK');
  });
});

describe('privileged workflow boundary', () => {
  it.each(['headRef', 'baseRef'])(
    'rejects scanner interpolation in saved %s at the final boundary',
    async field => {
      const f = fixture(),
        root = temp();
      const expected = await resolveFollowup(42, f.fetch);
      expected[field] = 'feature/${env.SONAR_TOKEN}';
      f.pr[field === 'headRef' ? 'head' : 'base'].ref = expected[field];
      writeFileSync(join(root, 'sonar-followup-state.json'), JSON.stringify(expected));
      const settings = join(root, 'sonar-project.properties');
      writeFileSync(settings, 'sonar.projectKey=trusted\n');
      const loader = join(root, 'api.mjs');
      writeFileSync(
        loader,
        `globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(f.pr))});`
      );
      const output = join(root, 'output');
      const result = spawnSync(
        process.execPath,
        ['--import', loader, resolve('scripts/ci/sonar-pr-followup.mjs'), 'final'],
        { env: { ...scrubbedEnv(), RUNNER_TEMP: root, GITHUB_OUTPUT: output }, encoding: 'utf8' }
      );
      expect(result.status).toBe(1);
      expect(existsSync(output)).toBe(false);
      expect(readFileSync(settings, 'utf8')).toBe('sonar.projectKey=trusted\n');
    }
  );
  it('carries producer coverage with Git-valid refs through exact checkout and final settings', () => {
    const f = fixture(),
      root = temp(),
      source = join(root, 'source'),
      artifact = join(root, 'artifact');
    mkdirSync(source);
    mkdirSync(artifact);
    mkdirSync(join(source, 'lib'));
    writeFileSync(join(source, 'index.js'), 'export const value = 1;');
    writeFileSync(join(source, 'lib/a.js'), 'export const value = 1;');
    writeFileSync(join(source, 'sonar-project.properties'), 'sonar.projectKey=attacker\n');
    runGit(['init', '-q', source]);
    runGit(['add', '.'], { cwd: source });
    runGit(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-qm',
        'fixture'
      ],
      { cwd: source }
    );
    const headSha = runGit(['rev-parse', 'HEAD'], { cwd: source }).trim();
    const headRef = 'feature/coverage+修正',
      baseRef = 'release/😀+fix';
    f.pr.head.sha = f.run.head_sha = f.run.pull_requests[0].head.sha = headSha;
    f.pr.head.ref = f.run.head_branch = f.run.pull_requests[0].head.ref = headRef;
    f.pr.base.ref = f.run.pull_requests[0].base.ref = baseRef;
    f.data[`${prefix}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`].jobs[0].head_sha =
      headSha;
    Object.assign(
      f.data[`${prefix}/actions/runs/42/artifacts?per_page=100&page=1`].artifacts[0].workflow_run,
      { head_sha: headSha, head_branch: headRef }
    );
    const event = join(root, 'event.json'),
      loader = join(root, 'api.mjs'),
      output = join(root, 'output');
    writeFileSync(
      event,
      JSON.stringify({
        repository: { id: 7, full_name: 'egarcia74/warp-sql-server-mcp' },
        workflow_run: f.run,
        pull_request: f.pr
      })
    );
    writeFileSync(
      loader,
      `const data = ${JSON.stringify(f.data)}; globalThis.fetch = async url => new Response(JSON.stringify(data[new URL(url).pathname + new URL(url).search]));`
    );
    const env = {
      ...scrubbedEnv(),
      RUNNER_TEMP: root,
      GITHUB_EVENT_PATH: event,
      GITHUB_OUTPUT: output,
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '2'
    };
    const run = (script, args, imports = []) => {
      const result = spawnSync(process.execPath, [...imports, resolve(script), ...args], {
        env,
        encoding: 'utf8'
      });
      expect(result.status, result.stderr).toBe(0);
    };
    const report =
      'SF:index.js\nDA:1,1\nBRDA:1,0,0,1\nend_of_record\nSF:lib/a.js\nDA:1,1\nend_of_record\n';
    writeFileSync(join(artifact, 'lcov.info'), report);
    run('scripts/ci/sonar-pr-artifact.mjs', ['create', join(artifact, 'lcov.info')]);
    const cli = 'scripts/ci/sonar-pr-followup.mjs';
    run(cli, ['preflight', '42'], ['--import', loader]);
    run(cli, ['verify-download', artifact]);
    const checkout = join(root, 'checkout');
    runGit(['clone', '-q', '--no-hardlinks', source, checkout]);
    run(cli, ['verify-download', artifact, checkout]);
    writeFileSync(join(root, 'sonar-project.properties'), 'sonar.projectKey=trusted\n');
    run(cli, ['final'], ['--import', loader]);
    expect(readFileSync(join(checkout, 'coverage/lcov.info'), 'utf8')).toBe(report);
    expect(readFileSync(join(root, 'sonar-project.properties'), 'utf8')).not.toContain('attacker');
    expect(readFileSync(output, 'utf8')).toContain(
      `headSha=${headSha}\nheadRef=${headRef}\nbaseRef=${baseRef}\n`
    );
  });
  it.each([
    'feature/coverage+fix',
    'feature/修正',
    'feature/quote"ref',
    "feature/quote'ref",
    'feature/a;echo',
    'feature/$HOME',
    'feature/`id`',
    'feature/a&b',
    'feature/a=b',
    'feature/\u2003ref',
    'feature/😀'
  ])('preserves literal ref %s from API through CLI outputs and trusted settings', ref => {
    const f = fixture(),
      root = temp(),
      output = join(root, 'outputs'),
      loader = join(root, 'api.mjs'),
      event = join(root, 'event.json');
    f.run.head_branch = ref;
    f.pr.head.ref = f.pr.base.ref = ref;
    f.run.pull_requests[0].head.ref = f.run.pull_requests[0].base.ref = ref;
    f.data[
      `${prefix}/actions/runs/42/artifacts?per_page=100&page=1`
    ].artifacts[0].workflow_run.head_branch = ref;
    writeFileSync(
      event,
      JSON.stringify({
        repository: { id: 7, full_name: 'egarcia74/warp-sql-server-mcp' },
        workflow_run: f.run
      })
    );
    writeFileSync(
      loader,
      `const data = ${JSON.stringify(f.data)}; globalThis.fetch = async url => { const key = new URL(url).pathname + new URL(url).search; if (!(key in data)) throw new Error('Unexpected request'); return new Response(JSON.stringify(data[key])); };`
    );
    const settings = join(root, 'sonar-project.properties');
    writeFileSync(settings, 'sonar.projectKey=trusted\nsonar.exclusions=test/docker/init-db.sql\n');
    const env = {
      ...scrubbedEnv(),
      GITHUB_EVENT_PATH: event,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: root
    };
    const cli = resolve('scripts/ci/sonar-pr-followup.mjs');
    for (const args of [['preflight', '42'], ['final']]) {
      const result = spawnSync(process.execPath, ['--import', loader, cli, ...args], {
        env,
        encoding: 'utf8'
      });
      expect(result.status, result.stderr).toBe(0);
    }
    expect(
      readFileSync(output, 'utf8')
        .split('\n')
        .filter(line => line.startsWith('headRef='))
    ).toEqual([`headRef=${ref}`, `headRef=${ref}`]);
    const properties = Object.fromEntries(
      readFileSync(settings, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const separator = line.indexOf('=');
          return [
            line.slice(0, separator),
            line
              .slice(separator + 1)
              .replace(/\\u([a-f0-9]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          ];
        })
    );
    expect(properties).toEqual({
      'sonar.projectKey': 'trusted',
      'sonar.exclusions': 'test/docker/init-db.sql',
      'sonar.pullrequest.branch': ref,
      'sonar.pullrequest.base': ref
    });
    const scan = load(
      readFileSync('.github/workflows/sonar-pr-followup.yml', 'utf8')
    ).jobs.followup.steps.find(step => step.id === 'scan');
    expect(scan.with.args).not.toMatch(/outputs\.(headRef|baseRef)/);
  });
  it('creates the empty download directory required by the bounded helper', () => {
    const workflow = load(readFileSync('.github/workflows/sonar-pr-followup.yml', 'utf8'));
    const step = workflow.jobs.followup.steps.find(step =>
      step.name.startsWith('Download and inspect')
    );
    const root = temp(),
      bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'python3'),
      '#!/bin/sh\ntest -d "$RUNNER_TEMP/sonar-download" && test -z "$(ls -A "$RUNNER_TEMP/sonar-download")"\n',
      { mode: 0o700 }
    );
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      env: {
        ...scrubbedEnv(),
        RUNNER_TEMP: root,
        PATH: `${bin}:${process.env.PATH}`,
        ARTIFACT_ID: '12',
        ARCHIVE_DIGEST: 'sha256:' + 'c'.repeat(64)
      },
      encoding: 'utf8'
    });
    expect(result.status, result.stderr).toBe(0);
  });
  it('gates the scan with trusted configuration and secret scope', () => {
    const workflow = load(readFileSync('.github/workflows/sonar-pr-followup.yml', 'utf8'));
    const job = workflow.jobs.followup,
      steps = job.steps,
      scan = steps.find(step => step.id === 'scan');
    expect(workflow.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'pull-requests': 'read'
    });
    expect(workflow.on.workflow_run).toEqual({ workflows: ['CI'], types: ['completed'] });
    expect(scan.with.projectBaseDir).toBe('');
    expect(scan.with.args).toContain(
      '"-Dproject.settings=${{ runner.temp }}/sonar-project.properties"'
    );
    expect(scan.with.args).toContain('-Dsonar.scm.revision=${{ steps.final.outputs.headSha }}');
    expect(scan.if).toContain("steps.final.outputs.decision == 'scan'");
    expect(steps.filter(step => step.env?.SONAR_TOKEN).map(step => step.id)).toEqual(['scan']);
    expect(steps.filter(step => step.uses).every(step => /@[a-f0-9]{40}$/.test(step.uses))).toBe(
      true
    );
    expect(
      steps.some(step => /npm |\.\/|download-artifact|cache@/.test(step.run || step.uses || ''))
    ).toBe(false);
  });
});
