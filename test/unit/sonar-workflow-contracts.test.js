import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { decideScan, isDirectScanEligible } from '../../scripts/ci/sonar-scan-guard.mjs';

const sha = 'a'.repeat(40);
const newerSha = 'b'.repeat(40);

function properties(path) {
  return Object.fromEntries(
    readFileSync(new URL(path, import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const equals = line.indexOf('=');
        return [line.slice(0, equals), line.slice(equals + 1)];
      })
  );
}

function coverageJob() {
  const workflow = parseYaml(
    readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  );
  return workflow.jobs.coverage;
}

describe('trusted Sonar scanner workflow contract', () => {
  it('keeps the existing T-SQL exclusion in both scanner scopes', () => {
    const config = properties('../../sonar-project.properties');
    expect(config).toMatchObject({
      'sonar.projectKey': 'egarcia74_warp-sql-server-mcp',
      'sonar.organization': 'egarcia74',
      'sonar.javascript.lcov.reportPaths': 'coverage/lcov.info',
      'sonar.sources': '.',
      'sonar.tests': 'test',
      'sonar.test.inclusions': 'test/**',
      'sonar.exclusions': 'test/docker/init-db.sql',
      'sonar.test.exclusions': 'test/docker/init-db.sql'
    });
    expect(properties('../../.sonarcloud.properties')['sonar.exclusions']).toBe(
      'test/docker/init-db.sql'
    );
  });

  it('passes the Sonar token only to a pinned scanner step behind the cutover switch', () => {
    const coverage = coverageJob();
    const scan = coverage.steps.find(step => step.name === 'Submit trusted Sonar analysis');
    const freshness = coverage.steps.find(step => step.name === 'Check Sonar scan freshness');
    expect(coverage.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    expect(scan.env).toHaveProperty('SONAR_TOKEN');
    expect(scan.uses).toBe(
      'SonarSource/sonarqube-scan-action@d209202bc7d53ff1cc128f7f907dac145c9d6ae9'
    );
    expect(scan.if).toContain("vars.SONAR_CI_ENABLED == 'true'");
    expect(scan.if).toContain("steps.sonar_freshness.outputs.scan == 'true'");
    expect(freshness.if).toContain("vars.SONAR_CI_ENABLED == 'true'");
    expect(freshness.env).not.toHaveProperty('SONAR_TOKEN');
  });

  it('checks out the exact PR head with full history and no retained credential', () => {
    const checkout = coverageJob().steps.find(step => step.name === 'Checkout code');
    expect(checkout.with.ref).toContain('github.event.pull_request.head.sha');
    expect(checkout.with['fetch-depth']).toBe(0);
    expect(checkout.with['persist-credentials']).toBe(false);
  });

  it('allows only main push and same-repository non-Dependabot PRs', () => {
    expect(isDirectScanEligible({ eventName: 'push', branch: 'main' })).toBe(true);
    expect(
      isDirectScanEligible({
        eventName: 'pull_request',
        headRepositoryId: 10,
        repositoryId: 10,
        author: 'maintainer'
      })
    ).toBe(true);
    expect(
      isDirectScanEligible({
        eventName: 'pull_request',
        headRepositoryId: 11,
        repositoryId: 10,
        author: 'forker'
      })
    ).toBe(false);
    expect(
      isDirectScanEligible({
        eventName: 'pull_request',
        headRepositoryId: 10,
        repositoryId: 10,
        author: 'dependabot[bot]'
      })
    ).toBe(false);
  });

  it('skips an older main SHA even if it enters the serialized queue first', () => {
    expect(decideScan({ eventName: 'push', checkedOutSha: sha, remoteMainSha: sha })).toEqual({
      scan: true
    });
    expect(decideScan({ eventName: 'push', checkedOutSha: sha, remoteMainSha: newerSha })).toEqual({
      scan: false,
      reason: 'superseded main'
    });
  });

  it('skips a changed or closed PR immediately before submission', () => {
    const original = {
      eventName: 'pull_request',
      checkedOutSha: sha,
      expectedBase: 'main',
      expectedRepositoryId: 10,
      pr: {
        state: 'open',
        head: { sha, repo: { id: 10 } },
        base: { ref: 'main' }
      }
    };
    expect(decideScan(original)).toEqual({ scan: true });
    expect(
      decideScan({ ...original, pr: { ...original.pr, head: { sha: newerSha, repo: { id: 10 } } } })
    ).toEqual({
      scan: false,
      reason: 'superseded PR'
    });
    expect(decideScan({ ...original, pr: { ...original.pr, state: 'closed' } })).toEqual({
      scan: false,
      reason: 'superseded PR'
    });
  });
});
