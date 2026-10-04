import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  shouldScanMain,
  successfulCatchUpScannerStep,
  successfulCiScannerStep
} from '../../scripts/ci/sonar-main-catch-up.mjs';

const sha = 'a'.repeat(40);
const olderSha = 'b'.repeat(40);

function verifiedMain() {
  return {
    dispatchRef: 'refs/heads/main',
    checkoutSha: sha,
    remoteMainSha: sha,
    latestProcessedAnalysis: { key: 'analysis-1', revision: sha },
    lineCoverage: '75.0',
    branchCoverage: '66.1',
    successfulCiScanAtSha: true,
    successfulCatchUpScanAtSha: false,
    processingTask: false
  };
}

describe('main Sonar coverage catch-up', () => {
  it('skips only verified CI coverage at the current main SHA', () => {
    expect(shouldScanMain(verifiedMain())).toBe(false);
  });

  it('rescans same-SHA Automatic Analysis without imported coverage', () => {
    expect(
      shouldScanMain({
        ...verifiedMain(),
        lineCoverage: undefined,
        branchCoverage: undefined,
        successfulCiScanAtSha: false
      })
    ).toBe(true);
  });

  it('does not skip on an older Sonar SHA, absent measure, or no successful CI scanner step', () => {
    expect(
      shouldScanMain({ ...verifiedMain(), latestProcessedAnalysis: { revision: olderSha } })
    ).toBe(true);
    expect(shouldScanMain({ ...verifiedMain(), branchCoverage: undefined })).toBe(true);
    expect(shouldScanMain({ ...verifiedMain(), successfulCiScanAtSha: false })).toBe(true);
    expect(shouldScanMain({ ...verifiedMain(), latestProcessedAnalysis: undefined })).toBe(true);
  });

  it('skips a processed analysis from a successful prior catch-up scan', () => {
    expect(
      shouldScanMain({
        ...verifiedMain(),
        successfulCiScanAtSha: false,
        successfulCatchUpScanAtSha: true
      })
    ).toBe(false);
  });

  it('fails visibly on wrong dispatch ref, remote drift, or processing Sonar task', () => {
    expect(() => shouldScanMain({ ...verifiedMain(), dispatchRef: 'refs/heads/feature' })).toThrow(
      /main ref/i
    );
    expect(() => shouldScanMain({ ...verifiedMain(), remoteMainSha: olderSha })).toThrow(
      /main head drift/i
    );
    expect(() => shouldScanMain({ ...verifiedMain(), processingTask: true })).toThrow(
      /processing/i
    );
  });

  it('requires the exact SHA, attempt, coverage job, and successful scanner step', () => {
    const run = {
      id: 42,
      name: 'CI',
      path: '.github/workflows/ci.yml',
      event: 'push',
      head_branch: 'main',
      head_sha: sha,
      run_attempt: 2,
      status: 'completed',
      conclusion: 'success'
    };
    const job = {
      name: 'Test Coverage',
      run_id: 42,
      head_sha: sha,
      run_attempt: 2,
      status: 'completed',
      conclusion: 'success',
      steps: [{ name: 'Submit trusted Sonar analysis', conclusion: 'success' }]
    };
    expect(successfulCiScannerStep(run, [job], sha)).toBe(true);
    expect(successfulCiScannerStep({ ...run, conclusion: 'failure' }, [job], sha)).toBe(true);
    expect(successfulCiScannerStep({ ...run, head_sha: olderSha }, [job], sha)).toBe(false);
    expect(successfulCiScannerStep(run, [{ ...job, run_attempt: 1 }], sha)).toBe(false);
    expect(successfulCiScannerStep(run, [{ ...job, run_id: 43 }], sha)).toBe(false);
    expect(successfulCiScannerStep(run, [{ ...job, steps: [] }], sha)).toBe(false);
    expect(successfulCiScannerStep(run, [{ ...job, conclusion: 'failure' }], sha)).toBe(false);
  });

  it('recognizes the exact successful catch-up scanner step even if its workflow failed elsewhere', () => {
    const run = {
      id: 43,
      name: 'Sonar Main Coverage Catch-up',
      path: '.github/workflows/sonar-main-catch-up.yml',
      event: 'schedule',
      head_branch: 'main',
      head_sha: sha,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'failure'
    };
    const job = {
      name: 'Check and scan main coverage',
      run_id: 43,
      head_sha: sha,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      steps: [{ name: 'Submit main catch-up analysis', conclusion: 'success' }]
    };
    expect(successfulCatchUpScannerStep(run, [job], sha)).toBe(true);
    expect(successfulCatchUpScannerStep(run, [{ ...job, steps: [] }], sha)).toBe(false);
  });

  it('uses a main-only trusted workflow with serialized, step-scoped scanner credentials', () => {
    const workflow = parseYaml(
      readFileSync(
        new URL('../../.github/workflows/sonar-main-catch-up.yml', import.meta.url),
        'utf8'
      )
    );
    expect(workflow.on.workflow_dispatch).toEqual({});
    expect(workflow.on.schedule).toHaveLength(1);
    const job = workflow.jobs.scan;
    expect(job.concurrency.group).toBe('sonar-main');
    expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(job.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    const scanner = job.steps.find(step => step.name === 'Submit main catch-up analysis');
    expect(scanner.env).toHaveProperty('SONAR_TOKEN');
    expect(scanner.with.args).toContain(
      '-Dsonar.scm.revision=${{ steps.freshness.outputs.checkout_sha }}'
    );
    expect(job.steps.some(step => String(step.run ?? '').includes('npm ci --ignore-scripts'))).toBe(
      true
    );
  });
});
