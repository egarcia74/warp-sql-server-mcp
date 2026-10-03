import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from '../helpers/git.js';
import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';
import { load } from 'js-yaml';
import { shouldScanMain, checkMain } from '../../scripts/ci/sonar-main-catch-up.mjs';

const sha = 'a'.repeat(40);
const oldSha = 'b'.repeat(40);
const prefix = '/repos/egarcia74/warp-sql-server-mcp';
const analysis = { key: 'analysis-1', revision: sha, date: '2026-10-04T01:00:00Z' };
const roots = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function cli(command, scenario, expectedSha) {
  const checkoutSha = runGit(['rev-parse', 'HEAD']).trim();
  const root = mkdtempSync(join(tmpdir(), 'sonar-main-cli-'));
  roots.push(root);
  const preload = join(root, 'fetch.mjs');
  const f = apiFixture();
  const verifiedData = JSON.stringify(f.data).replaceAll(sha, checkoutSha);
  writeFileSync(
    preload,
    `globalThis.fetch = async (url, options) => {
    if (options.method && options.method !== 'GET') throw new Error('Write forbidden');
    if (url.startsWith('https://sonarcloud.io/') && options.headers.Authorization) throw new Error('Secret on public Sonar read');
    if (${JSON.stringify(scenario)} === 'offline') throw new Error('offline secret');
    if (${JSON.stringify(scenario)} === 'verified' && url.startsWith('https://api.github.com/')) {
      const data = ${verifiedData};
      const path = url.slice('https://api.github.com'.length);
      if (!(path in data)) throw new Error('Unexpected GitHub read');
      return new Response(JSON.stringify(data[path]));
    }
    if (url === 'https://api.github.com${prefix}/git/ref/heads/main') return new Response(JSON.stringify({
      ref: 'refs/heads/main', object: { type: 'commit', sha: ${JSON.stringify(scenario === 'drift' ? oldSha : checkoutSha)} }
    }));
    if (url.startsWith('https://sonarcloud.io/api/project_analyses/search?')) return new Response(JSON.stringify({analyses: [{
      key: 'automatic', revision: ${JSON.stringify(checkoutSha)}, date: '2026-10-04T01:00:00Z'
    }]}));
    if (${JSON.stringify(scenario)} === 'verified' && url.startsWith('https://sonarcloud.io/api/measures/search_history?')) return new Response(JSON.stringify(${JSON.stringify(f.measures)}));
    if (url.startsWith('https://sonarcloud.io/api/measures/search_history?')) return new Response(JSON.stringify({
      paging: { pageIndex: 1, total: 0 }, measures: []
    }));
    throw new Error('Unexpected API read');
  };`
  );
  return {
    checkoutSha,
    result: spawnSync(
      process.execPath,
      ['--import', preload, 'scripts/ci/sonar-main-catch-up.mjs', command],
      {
        encoding: 'utf8',
        env: {
          ...scrubbedEnv(),
          GITHUB_REF: 'refs/heads/main',
          GITHUB_TOKEN: 'fake-github-token',
          SONAR_EXPECTED_SHA: expectedSha ?? '',
          GITHUB_OUTPUT: '',
          GITHUB_STEP_SUMMARY: ''
        }
      }
    )
  };
}
function verified() {
  return {
    dispatchRef: 'refs/heads/main',
    checkoutSha: sha,
    remoteMainSha: sha,
    latestProcessedAnalysis: analysis,
    lineCoverage: 0,
    branchCoverage: 74,
    successfulCiScanAtSha: true
  };
}
function apiFixture() {
  const data = {
    [`${prefix}/git/ref/heads/main`]: { ref: 'refs/heads/main', object: { type: 'commit', sha } },
    [`${prefix}/actions/workflows/ci.yml`]: { id: 11, path: '.github/workflows/ci.yml' },
    [`${prefix}/actions/workflows/sonar-main-catch-up.yml`]: {
      id: 12,
      path: '.github/workflows/sonar-main-catch-up.yml'
    },
    [`${prefix}/actions/workflows/11/runs?branch=main&head_sha=${sha}&per_page=100&page=1`]: {
      total_count: 1,
      workflow_runs: [
        {
          id: 42,
          run_attempt: 2,
          workflow_id: 11,
          path: '.github/workflows/ci.yml',
          head_sha: sha,
          head_branch: 'main',
          event: 'push',
          status: 'completed',
          repository: { full_name: 'egarcia74/warp-sql-server-mcp' },
          head_repository: { full_name: 'egarcia74/warp-sql-server-mcp' }
        }
      ]
    },
    [`${prefix}/actions/workflows/12/runs?branch=main&head_sha=${sha}&per_page=100&page=1`]: {
      total_count: 0,
      workflow_runs: []
    },
    [`${prefix}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`]: {
      total_count: 1,
      jobs: [
        {
          run_id: 42,
          run_attempt: 2,
          head_sha: sha,
          name: 'Test Coverage',
          status: 'completed',
          conclusion: 'success',
          steps: [
            { name: 'Scan trusted revision with Sonar', status: 'completed', conclusion: 'success' }
          ]
        }
      ]
    }
  };
  const measures = {
    paging: { pageIndex: 1, total: 1 },
    measures: [
      ['lines_to_cover', '200'],
      ['conditions_to_cover', '80'],
      ['line_coverage', '0'],
      ['branch_coverage', '74']
    ].map(([metric, value]) => ({ metric, history: [{ date: analysis.date, value }] }))
  };
  return {
    data,
    measures,
    fetchGithub: async path => {
      if (!(path in data)) throw new Error('Unexpected API path: ' + path);
      return globalThis.structuredClone(data[path]);
    },
    fetchSonar: async path => {
      if (path.startsWith('/api/project_analyses/search?')) return { analyses: [analysis] };
      if (path.startsWith('/api/measures/search_history?'))
        return globalThis.structuredClone(measures);
      throw new Error('Unexpected Sonar path');
    }
  };
}

describe('main catch-up decision', () => {
  it('skips verified CI coverage, including valid zero line coverage', () => {
    expect(shouldScanMain(verified())).toBe(false);
  });
  it('rescans Automatic Analysis without coverage at the current SHA', () => {
    expect(
      shouldScanMain({
        ...verified(),
        lineCoverage: undefined,
        branchCoverage: undefined,
        successfulCiScanAtSha: false
      })
    ).toBe(true);
  });
  it.each([
    ['incomplete analysis identity', { latestProcessedAnalysis: { revision: sha } }],
    ['old Sonar SHA', { latestProcessedAnalysis: { ...analysis, revision: oldSha } }],
    ['old CI job', { successfulCiScanAtSha: false }],
    ['processing task', { latestProcessedAnalysis: { ...analysis, status: 'IN_PROGRESS' } }],
    ['empty task status', { latestProcessedAnalysis: { ...analysis, status: '' } }],
    ['null task status', { latestProcessedAnalysis: { ...analysis, status: null } }],
    ['missing line measure', { lineCoverage: undefined }],
    ['missing branch measure', { branchCoverage: undefined }],
    ['Dependabot squash without push CI', { successfulCiScanAtSha: false }]
  ])('requires scanning for %s', (_, change) => {
    expect(shouldScanMain({ ...verified(), ...change })).toBe(true);
  });
  it.each([
    ['wrong dispatch ref', { dispatchRef: 'refs/heads/feature' }],
    ['remote head drift', { remoteMainSha: oldSha }],
    ['invalid SHA', { checkoutSha: 'main' }],
    ['invalid coverage', { branchCoverage: 101 }]
  ])('fails closed for %s', (_, change) => {
    expect(() => shouldScanMain({ ...verified(), ...change })).toThrow();
  });
});

describe('read-only main evidence', () => {
  const check = f => checkMain({ dispatchRef: 'refs/heads/main', checkoutSha: sha, ...f });
  it('binds processed historical measures and successful scanner step to current main', async () => {
    expect(await check(apiFixture())).toBe(false);
  });
  it('does not skip the first cutover dispatch with a current Automatic Analysis record', async () => {
    const f = apiFixture();
    f.measures.measures = [];
    expect(await check(f)).toBe(true);
  });
  it('rescans the live Automatic Analysis history shape with timestamps but no values', async () => {
    const f = apiFixture();
    f.measures.measures.forEach(measure => {
      delete measure.history[0].value;
    });
    expect(await check(f)).toBe(true);
  });
  it('scans old Sonar analysis without trusting newer unbound measures', async () => {
    const f = apiFixture();
    f.fetchSonar = async () => ({ analyses: [{ ...analysis, revision: oldSha }] });
    expect(await check(f)).toBe(true);
  });
  it.each(['skipped', 'failure'])(
    'does not accept a %s scanner in a successful job',
    async conclusion => {
      const f = apiFixture();
      f.data[
        `${prefix}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`
      ].jobs[0].steps[0].conclusion = conclusion;
      expect(await check(f)).toBe(true);
    }
  );
  it.each([
    [
      'old job attempt',
      f => {
        f.data[
          `${prefix}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`
        ].jobs[0].run_attempt = 1;
      }
    ],
    [
      'old job SHA',
      f => {
        f.data[`${prefix}/actions/runs/42/attempts/2/jobs?per_page=100&page=1`].jobs[0].head_sha =
          oldSha;
      }
    ],
    [
      'wrong workflow identity',
      f => {
        f.data[`${prefix}/actions/workflows/ci.yml`].path = '.github/workflows/other.yml';
      }
    ],
    [
      'unbound measure date',
      f => {
        f.measures.measures[0].history[0].date = '2026-10-03T00:00:00Z';
      }
    ],
    [
      'malformed API count',
      f => {
        f.data[
          `${prefix}/actions/workflows/11/runs?branch=main&head_sha=${sha}&per_page=100&page=1`
        ].total_count = 2;
      }
    ],
    [
      'API failure',
      f => {
        f.fetchGithub = async () => {
          throw new Error('offline');
        };
      }
    ],
    [
      'remote head drift',
      f => {
        f.data[`${prefix}/git/ref/heads/main`].object.sha = oldSha;
      }
    ]
  ])('fails closed on %s', async (_, mutate) => {
    const f = apiFixture();
    mutate(f);
    await expect(check(f)).rejects.toThrow();
  });
  it('rejects analysis changes between history and proof reads', async () => {
    const f = apiFixture();
    const fetch = f.fetchSonar;
    let reads = 0;
    f.fetchSonar = path =>
      path.startsWith('/api/project_analyses/search?') && ++reads === 2
        ? { analyses: [{ ...analysis, key: 'new-analysis' }] }
        : fetch(path);
    await expect(check(f)).rejects.toThrow();
  });
  it('accepts successful catch-up scanner evidence after a token-driven merge', async () => {
    const f = apiFixture();
    f.data[`${prefix}/actions/workflows/11/runs?branch=main&head_sha=${sha}&per_page=100&page=1`] =
      { total_count: 0, workflow_runs: [] };
    f.data[`${prefix}/actions/workflows/12/runs?branch=main&head_sha=${sha}&per_page=100&page=1`] =
      {
        total_count: 1,
        workflow_runs: [
          {
            id: 43,
            run_attempt: 1,
            workflow_id: 12,
            path: '.github/workflows/sonar-main-catch-up.yml',
            head_sha: sha,
            head_branch: 'main',
            event: 'schedule',
            status: 'completed',
            repository: { full_name: 'egarcia74/warp-sql-server-mcp' },
            head_repository: { full_name: 'egarcia74/warp-sql-server-mcp' }
          }
        ]
      };
    f.data[`${prefix}/actions/runs/43/attempts/1/jobs?per_page=100&page=1`] = {
      total_count: 1,
      jobs: [
        {
          run_id: 43,
          run_attempt: 1,
          head_sha: sha,
          name: 'Main coverage catch-up',
          status: 'completed',
          conclusion: 'success',
          steps: [
            { name: 'Analyze current main with Sonar', status: 'completed', conclusion: 'success' }
          ]
        }
      ]
    };
    expect(await check(f)).toBe(false);
  });
  it('CLI rejects non-main dispatch without producing a successful skip', () => {
    const result = spawnSync(process.execPath, ['scripts/ci/sonar-main-catch-up.mjs', 'check'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_REF: 'refs/heads/feature' }
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('scan=false');
  });
  it('CLI emits validated SHA and scan=true for Automatic Analysis without coverage', () => {
    const { checkoutSha, result } = cli('check', 'automatic');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`scan=true\nsha=${checkoutSha}\n`);
  });
  it('CLI emits scan=false only after verified CI and bound coverage', () => {
    const { checkoutSha, result } = cli('check', 'verified');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`scan=false\nsha=${checkoutSha}\n`);
  });
  it.each(['offline', 'drift'])('CLI fails closed on %s without green scan output', scenario => {
    const { result } = cli('check', scenario);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('secret');
  });
  it('final freshness CLI emits the exact checked and remote revision', () => {
    const { checkoutSha, result } = cli('fresh', 'automatic');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`scan=true\nsha=${checkoutSha}\n`);
  });
  it('final freshness rejects checkout changes after coverage', () => {
    const { result } = cli('fresh', 'automatic', oldSha);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });
});

describe('main catch-up workflow boundaries', () => {
  const workflow = () => load(readFileSync('.github/workflows/sonar-main-catch-up.yml', 'utf8'));
  const admit = (
    expression,
    github,
    enabled,
    decision = 'true',
    freshness = 'true',
    success = true
  ) =>
    success &&
    new Function('github', 'vars', 'steps', `return (${expression});`)(
      github,
      { SONAR_CI_ENABLED: enabled },
      { decision: { outputs: { scan: decision } }, freshness: { outputs: { scan: freshness } } }
    );
  it.each([
    ['unset switch', undefined, 'refs/heads/main', false],
    ['disabled switch', 'false', 'refs/heads/main', false],
    ['enabled main', 'true', 'refs/heads/main', true],
    ['enabled non-main', 'true', 'refs/heads/feature', false],
    ['enabled PR', 'true', 'refs/pull/1/merge', false]
  ])('evaluates main code admission for %s', (_, enabled, ref, want) => {
    expect(admit(workflow().jobs.catchup.if, { ref }, enabled)).toBe(want);
  });
  it('fails non-main dispatch while permitting only a fresh scanner decision', () => {
    const w = workflow();
    expect(
      admit(
        w.jobs.rejectRef.if,
        { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' },
        'false'
      )
    ).toBe(true);
    const scanner = w.jobs.catchup.steps.find(s => s.id === 'scan');
    expect(admit(scanner.if, {}, 'true')).toBe(true);
    expect(admit(scanner.if, {}, 'true', 'false')).toBe(false);
    expect(admit(scanner.if, {}, 'true', 'true', 'false')).toBe(false);
    expect(admit(scanner.if, {}, 'true', 'true', 'true', false)).toBe(false);
  });
  it('gates all main code behind the explicit switch and rejects non-main dispatches', () => {
    const w = load(readFileSync('.github/workflows/sonar-main-catch-up.yml', 'utf8'));
    expect(w.on.workflow_dispatch).toBeDefined();
    expect(w.on.schedule).toHaveLength(1);
    expect(w.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(w.jobs.catchup.if).toBe(
      "vars.SONAR_CI_ENABLED == 'true' && github.ref == 'refs/heads/main'"
    );
    expect(w.jobs.rejectRef.if).toBe(
      "github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'"
    );
    expect(w.jobs.catchup.concurrency).toEqual({
      group: 'sonar-main',
      'cancel-in-progress': false
    });
    const steps = w.jobs.catchup.steps;
    const checkout = steps.find(s => s.uses?.startsWith('actions/checkout@'));
    expect(checkout.with).toEqual({ ref: 'main', 'fetch-depth': 0, 'persist-credentials': false });
    expect(w.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    expect(w.jobs.catchup.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    const scanner = steps.find(s => s.id === 'scan');
    expect(scanner.uses).toBe(
      'SonarSource/sonarqube-scan-action@d209202bc7d53ff1cc128f7f907dac145c9d6ae9'
    );
    expect(scanner.env).toEqual({ SONAR_TOKEN: '${{ secrets.SONAR_TOKEN }}' });
    expect(steps.filter(s => s.env?.SONAR_TOKEN)).toEqual([scanner]);
    expect(steps.find(s => s.id === 'freshness').run).toBe(
      'node scripts/ci/sonar-main-catch-up.mjs fresh'
    );
    expect(scanner.if).toBe(
      "steps.decision.outputs.scan == 'true' && steps.freshness.outputs.scan == 'true'"
    );
  });
});
