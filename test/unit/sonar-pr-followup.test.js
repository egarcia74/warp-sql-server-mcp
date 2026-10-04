import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  decideFollowupFinal,
  formatFailureSummary,
  resolveFollowup,
  verifyContainingMainCoverage
} from '../../scripts/ci/sonar-pr-followup.mjs';

const sha = 'a'.repeat(40);
const mergeSha = 'b'.repeat(40);
const digest = 'c'.repeat(64);

function fixture() {
  const run = {
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
    head_repository: { id: 20, full_name: 'forker/warp-sql-server-mcp' },
    pull_requests: []
  };
  const pr = {
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
  };
  const responses = {
    '/actions/runs/42': run,
    '/actions/runs/42/attempts/2/jobs?per_page=100': {
      total_count: 1,
      jobs: [
        {
          name: 'Test Coverage',
          status: 'completed',
          conclusion: 'success',
          run_attempt: 2,
          run_id: 42,
          head_sha: sha
        }
      ]
    },
    '/actions/runs/42/artifacts?per_page=100': {
      total_count: 1,
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
    },
    [`/commits/${sha}/pulls?per_page=100`]: [{ number: 1403 }],
    '/pulls/1403': pr
  };
  const fetchJson = async path => {
    if (!(path in responses)) throw new Error(`missing mock API path ${path}`);
    return responses[path];
  };
  return { run, pr, responses, fetchJson };
}

describe('read-only Sonar PR follow-up', () => {
  it('resolves a run with an empty PR list through commit association', async () => {
    const { run, fetchJson } = fixture();
    await expect(resolveFollowup(42, fetchJson, run)).resolves.toMatchObject({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headSha: sha,
      headRepositoryName: 'forker/warp-sql-server-mcp',
      artifactId: 99,
      archiveDigest: digest
    });
  });

  it('rejects ambiguous commit-to-PR association', async () => {
    const { run, responses, fetchJson } = fixture();
    responses[`/commits/${sha}/pulls?per_page=100`] = [{ number: 1403 }, { number: 1404 }];
    await expect(resolveFollowup(42, fetchJson, run)).rejects.toThrow(/ambiguous/i);
  });

  it('rejects a jobs response that omits the successful current-attempt coverage job', async () => {
    const { run, responses, fetchJson } = fixture();
    responses['/actions/runs/42/attempts/2/jobs?per_page=100'].jobs[0].run_attempt = 1;
    await expect(resolveFollowup(42, fetchJson, run)).rejects.toThrow(/attempt/i);
  });

  it('rejects a missing coverage artifact', async () => {
    const { run, responses, fetchJson } = fixture();
    responses['/actions/runs/42/artifacts?per_page=100'] = { total_count: 0, artifacts: [] };
    await expect(resolveFollowup(42, fetchJson, run)).rejects.toThrow(/artifact/i);
  });

  it('rejects an API failure rather than producing a green skip', async () => {
    const { run } = fixture();
    await expect(
      resolveFollowup(
        42,
        async () => {
          throw new Error('API unavailable');
        },
        run
      )
    ).rejects.toThrow(/API unavailable/);
  });

  it('treats a closed fork as superseded', async () => {
    const { run, pr, fetchJson } = fixture();
    pr.state = 'closed';
    await expect(resolveFollowup(42, fetchJson, run)).resolves.toEqual({ superseded: true });
  });

  it('routes a merged Dependabot update to main-coverage verification', async () => {
    const { run, pr, responses, fetchJson } = fixture();
    run.head_repository = { id: 10, full_name: 'egarcia74/warp-sql-server-mcp' };
    pr.head.repo = { id: 10, full_name: 'egarcia74/warp-sql-server-mcp' };
    pr.user.login = 'dependabot[bot]';
    pr.state = 'closed';
    pr.merged = true;
    pr.merge_commit_sha = mergeSha;
    responses[
      '/actions/runs/42/artifacts?per_page=100'
    ].artifacts[0].workflow_run.head_repository_id = 10;
    await expect(resolveFollowup(42, fetchJson, run)).resolves.toMatchObject({
      mergedDependabot: true,
      mergeSha,
      prNumber: 1403
    });
  });

  it('accepts a processed main revision containing the Dependabot squash only with both coverage measures', () => {
    const analysisSha = 'd'.repeat(40);
    const analysis = { key: 'analysis-1', revision: analysisSha, date: '2026-10-04T06:11:39+0000' };
    const measures = {
      component: {
        measures: [
          { metric: 'line_coverage', value: '72.5' },
          { metric: 'branch_coverage', value: '61.0' }
        ]
      }
    };
    const comparison = {
      status: 'ahead',
      base_commit: { sha: mergeSha },
      merge_base_commit: { sha: mergeSha },
      commits: [{ sha: analysisSha }]
    };
    expect(
      verifyContainingMainCoverage({ mergeSha, analysis, measures, comparison })
    ).toMatchObject({
      verified: true,
      revision: analysisSha,
      lineCoverage: 72.5,
      branchCoverage: 61
    });
    expect(
      verifyContainingMainCoverage({
        mergeSha,
        analysis,
        measures: { component: { measures: [] } },
        comparison
      })
    ).toEqual({
      verified: false,
      reason: 'main coverage measures missing',
      revision: analysisSha
    });
  });

  it('accepts a containing main analysis when GitHub truncates the compare commits list', () => {
    const analysisSha = 'd'.repeat(40);
    const result = verifyContainingMainCoverage({
      mergeSha,
      analysis: { revision: analysisSha, date: '2026-10-04T06:11:39+0000' },
      measures: {
        component: {
          measures: [
            { metric: 'line_coverage', value: '72.5' },
            { metric: 'branch_coverage', value: '61.0' }
          ]
        }
      },
      comparison: {
        status: 'ahead',
        base_commit: { sha: mergeSha },
        merge_base_commit: { sha: mergeSha },
        commits: Array.from({ length: 250 }, () => ({ sha: 'e'.repeat(40) }))
      }
    });
    expect(result).toMatchObject({ verified: true, revision: analysisSha });
  });

  it('writes only fixed safe links in failure summaries', () => {
    expect(formatFailureSummary({ runId: 42, prNumber: 1403 })).toContain(
      'https://github.com/egarcia74/warp-sql-server-mcp/actions/runs/42'
    );
    expect(formatFailureSummary({ runId: 42, prNumber: 1403 })).toContain(
      'https://github.com/egarcia74/warp-sql-server-mcp/pull/1403'
    );
    expect(formatFailureSummary({ runId: 42, prNumber: '<script>' })).not.toContain('<script>');
    expect(formatFailureSummary({ runId: '<script>', prNumber: 1403 })).not.toContain('<script>');
  });

  it('does not accept a non-containing or malformed main analysis', () => {
    const analysisSha = 'd'.repeat(40);
    const analysis = { revision: analysisSha, date: '2026-10-04T06:11:39+0000' };
    const measures = {
      component: {
        measures: [
          { metric: 'line_coverage', value: '0.0' },
          { metric: 'branch_coverage', value: '0.0' }
        ]
      }
    };
    expect(
      verifyContainingMainCoverage({
        mergeSha,
        analysis,
        measures,
        comparison: { status: 'behind' }
      })
    ).toEqual({
      verified: false,
      reason: 'main analysis does not contain merge',
      revision: analysisSha
    });
    expect(() =>
      verifyContainingMainCoverage({
        mergeSha,
        analysis: { revision: 'oops' },
        measures,
        comparison: {}
      })
    ).toThrow(/analysis revision/i);
  });

  it('marks an absent processed main analysis as pending catch-up', () => {
    expect(verifyContainingMainCoverage({ mergeSha, analysis: undefined })).toEqual({
      verified: false,
      reason: 'processed main analysis missing',
      revision: null
    });
  });

  it('accepts an identical processed main revision after the Dependabot squash', () => {
    const result = verifyContainingMainCoverage({
      mergeSha,
      analysis: { revision: mergeSha, date: '2026-10-04T06:11:39+0000' },
      measures: {
        component: {
          measures: [
            { metric: 'line_coverage', value: '0.0' },
            { metric: 'branch_coverage', value: '0.0' }
          ]
        }
      },
      comparison: { status: 'identical', base_commit: { sha: mergeSha } }
    });
    expect(result).toMatchObject({
      verified: true,
      revision: mergeSha,
      lineCoverage: 0,
      branchCoverage: 0
    });
  });

  it('rechecks the PR immediately before the privileged scan', () => {
    const expected = {
      prNumber: 1403,
      headRepositoryId: 20,
      headSha: sha,
      headRef: 'fix/coverage',
      baseRef: 'main'
    };
    const { pr } = fixture();
    expect(decideFollowupFinal(expected, pr)).toEqual({ scan: true });
    expect(decideFollowupFinal(expected, { ...pr, head: { ...pr.head, sha: mergeSha } })).toEqual({
      scan: false,
      reason: 'superseded PR'
    });
    expect(decideFollowupFinal(expected, { ...pr, state: 'closed' })).toEqual({
      scan: false,
      reason: 'superseded PR'
    });
  });

  it('keeps privileged workflow execution and scanner settings trusted', () => {
    const workflow = parseYaml(
      readFileSync(
        new URL('../../.github/workflows/sonar-pr-followup.yml', import.meta.url),
        'utf8'
      )
    );
    const job = workflow.jobs.scan;
    expect(workflow.on.workflow_run.workflows).toEqual(['CI']);
    expect(job.permissions).toEqual({ actions: 'read', contents: 'read', 'pull-requests': 'read' });
    expect(job.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    const steps = job.steps;
    const trustedCopy = steps.findIndex(step => step.name === 'Preserve trusted scanner helpers');
    const untrustedCheckout = steps.findIndex(step => step.name === 'Checkout verified PR head');
    expect(trustedCopy).toBeGreaterThan(-1);
    expect(untrustedCheckout).toBeGreaterThan(trustedCopy);
    expect(steps.some(step => /npm (?:ci|install|run|test)/.test(step.run ?? ''))).toBe(false);
    expect(steps.some(step => String(step.uses ?? '').includes('cache'))).toBe(false);
    const scanner = steps.find(step => step.name === 'Submit isolated Sonar PR analysis');
    expect(scanner.env).toHaveProperty('SONAR_TOKEN');
    expect(scanner.with.args).toContain(
      '-Dproject.settings=${{ runner.temp }}/sonar-trusted/sonar-project.properties'
    );
    expect(scanner.with.args).toContain(
      '-Dsonar.pullrequest.key=${{ steps.preflight.outputs.pr_number }}'
    );
    expect(scanner.with.args).toContain(
      '-Dsonar.scm.revision=${{ steps.preflight.outputs.head_sha }}'
    );
    const failureReport = steps.find(step => step.name === 'Report failed follow-up');
    expect(failureReport.if).toContain('failure()');
    expect(failureReport.run).toContain('report-failure');
    expect(failureReport.run).toMatch(/&& node .*report-failure.*; then\s+exit 0/);
  });
});
