import { readFileSync, existsSync } from 'node:fs';
import { load } from 'js-yaml';

const workflow = load(readFileSync('.github/workflows/ci.yml', 'utf8'));
const coverage = workflow.jobs.coverage;
const scanner = coverage.steps.find(step => step.id === 'sonar-scan');
const freshness = coverage.steps.find(step => step.id === 'sonar-freshness');
const sha = 'a'.repeat(40);
const newerSha = 'b'.repeat(40);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function parseProperties(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .map(line => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
}

function fixture(eventName = 'pull_request') {
  return {
    event_name: eventName,
    actor: 'maintainer',
    repository: 'owner/repo',
    sha: eventName === 'push' ? sha : newerSha,
    ref: eventName === 'push' ? 'refs/heads/main' : 'refs/pull/1403/merge',
    run_id: 42,
    run_attempt: 1,
    event: {
      repository: { id: 7 },
      pull_request: {
        number: 1403,
        state: 'open',
        merged: false,
        user: { login: 'maintainer' },
        head: { sha, ref: 'feature/coverage', repo: { id: 7, full_name: 'owner/repo' } },
        base: { ref: 'main', repo: { id: 7 } }
      }
    }
  };
}

// These fixtures contain only booleans, strings and the documented expression
// operators used here. Execute the parsed expression, including implicit success().
function evaluate(expression, github, decision = 'scan', enabled = 'true', success = true) {
  expect(typeof expression).toBe('string');
  const source = expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    // GitHub expression property traversal tolerates missing event fields.
    .replace(/\bgithub(?:\.[A-Za-z_][A-Za-z_0-9]*)+/g, path => path.replaceAll('.', '?.'))
    .replaceAll('steps.sonar-freshness', 'steps["sonar-freshness"]');
  return (
    success &&
    new Function('github', 'vars', 'steps', 'format', `return (${source});`)(
      github,
      { SONAR_CI_ENABLED: enabled },
      { 'sonar-freshness': { outputs: { decision, sha } } },
      (pattern, ...values) => pattern.replace(/\{(\d+)\}/g, (_, index) => values[index])
    )
  );
}

async function runFreshness({
  github = fixture(),
  currentPr,
  remoteSha = sha,
  checkoutSha = sha,
  apiError
} = {}) {
  expect(freshness).toBeDefined();
  const outputs = {};
  const summaries = [];
  const calls = [];
  const response = currentPr === undefined ? github.event.pull_request : currentPr;
  const api = {
    rest: {
      pulls: {
        get: async request => {
          calls.push(['pulls.get', request]);
          if (apiError) throw apiError;
          return { data: response };
        }
      },
      git: {
        getRef: async request => {
          calls.push(['git.getRef', request]);
          if (apiError) throw apiError;
          return { data: { ref: 'refs/heads/main', object: { type: 'commit', sha: remoteSha } } };
        }
      }
    }
  };
  const core = {
    setOutput: (key, value) => {
      outputs[key] = value;
    },
    info: message => {
      summaries.push(message);
    },
    summary: {
      addRaw: message => {
        summaries.push(message);
        return core.summary;
      },
      write: async () => {}
    }
  };
  const exec = {
    getExecOutput: async (command, args) => {
      expect([command, args]).toEqual(['git', ['rev-parse', 'HEAD']]);
      return { exitCode: 0, stdout: checkoutSha + '\n', stderr: '' };
    }
  };
  await new AsyncFunction('github', 'context', 'core', 'exec', freshness.with.script)(
    api,
    {
      eventName: github.event_name,
      payload: github.event,
      sha: github.sha,
      ref: github.ref,
      repo: { owner: 'owner', repo: 'repo' }
    },
    core,
    exec
  );
  return { outputs, summaries, calls };
}

describe('trusted direct Sonar workflow contracts', () => {
  it('preserves scanner scope and both T-SQL exclusions', () => {
    const text = existsSync('sonar-project.properties')
      ? readFileSync('sonar-project.properties', 'utf8')
      : '';
    expect(parseProperties(text)).toEqual({
      'sonar.projectKey': 'egarcia74_warp-sql-server-mcp',
      'sonar.organization': 'egarcia74',
      'sonar.javascript.lcov.reportPaths': 'coverage/lcov.info',
      'sonar.sources': '.',
      'sonar.tests': 'test',
      'sonar.test.inclusions': 'test/**',
      'sonar.exclusions': 'test/docker/init-db.sql',
      'sonar.test.exclusions': 'test/docker/init-db.sql'
    });
    expect(
      parseProperties(readFileSync('.sonarcloud.properties', 'utf8'))['sonar.exclusions']
    ).toBe('test/docker/init-db.sql');
  });

  it('keeps token step-scoped and retains Codecov failure policy', () => {
    expect(scanner).toBeDefined();
    expect(workflow.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    expect(coverage.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    for (const step of coverage.steps.filter(step => step !== scanner)) {
      expect(step.env ?? {}).not.toHaveProperty('SONAR_TOKEN');
    }
    expect(scanner.env.SONAR_TOKEN).toBe('${{ secrets.SONAR_TOKEN }}');
    expect(scanner['continue-on-error']).not.toBe(true);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.on).not.toHaveProperty('pull_request_target');
    const codecov = coverage.steps.find(step => step.name.includes('Codecov'));
    expect(codecov.with.fail_ci_if_error).toBe(false);
    expect(codecov['continue-on-error']).toBe(true);
  });

  it('uses exact PR head or push SHA with full history and no persisted credentials', () => {
    const checkout = coverage.steps[0].with;
    expect(evaluate(checkout.ref, fixture())).toBe(sha);
    const push = fixture('push');
    delete push.event.pull_request;
    expect(evaluate(checkout.ref, push)).toBe(sha);
    expect(checkout['fetch-depth']).toBe(0);
    expect(checkout['persist-credentials']).toBe(false);
  });

  it.each(['', 'false', undefined])('disables scanner by default with variable %s', enabled => {
    expect(scanner).toBeDefined();
    // undefined models an absent repository variable (GitHub resolves it to '').
    expect(evaluate(scanner.if, fixture(), 'scan', enabled ?? '')).toBe(false);
  });

  it.each([
    ['current trusted PR', x => x, 'scan', true],
    ['current main', () => fixture('push'), 'scan', true],
    [
      'current main with bot actor',
      () => {
        const x = fixture('push');
        x.actor = 'dependabot[bot]';
        return x;
      },
      'scan',
      true
    ],
    [
      'fork PR',
      x => {
        x.event.pull_request.head.repo.id = 9;
        return x;
      },
      'scan',
      false
    ],
    [
      'Dependabot PR author',
      x => {
        x.event.pull_request.user.login = 'dependabot[bot]';
        return x;
      },
      'scan',
      false
    ],
    [
      'Dependabot actor',
      x => {
        x.actor = 'dependabot[bot]';
        return x;
      },
      'scan',
      false
    ],
    [
      'non-main push',
      x => {
        x.event_name = 'push';
        x.ref = 'refs/heads/release';
        return x;
      },
      'scan',
      false
    ],
    [
      'unexpected event',
      x => {
        x.event_name = 'workflow_dispatch';
        return x;
      },
      'scan',
      false
    ],
    ['superseded PR', x => x, 'superseded', false],
    ['missing verdict', x => x, '', false]
  ])('evaluates effective scanner admission: %s', (_, update, decision, want) => {
    expect(scanner).toBeDefined();
    expect(evaluate(scanner.if, update(fixture()), decision)).toBe(want);
  });

  it('does not run the scanner after coverage or freshness failure', () => {
    expect(scanner).toBeDefined();
    expect(evaluate(scanner.if, fixture(), 'scan', 'true', false)).toBe(false);
  });

  it('serializes main submissions without treating concurrency as freshness', () => {
    expect(coverage.concurrency).toBeDefined();
    expect(evaluate(coverage.concurrency.group, fixture('push'))).toBe('sonar-main');
    expect(evaluate(coverage.concurrency.group, fixture())).not.toBe('sonar-main');
    expect(coverage.concurrency['cancel-in-progress']).toBe(false);
  });

  it('pins actions and places freshness immediately before the scanner with validated revision args', () => {
    expect(scanner).toBeDefined();
    expect(scanner.uses).toBe(
      'SonarSource/sonarqube-scan-action@d209202bc7d53ff1cc128f7f907dac145c9d6ae9'
    );
    expect(freshness.uses).toBe('actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3');
    expect(coverage.steps.indexOf(scanner)).toBe(coverage.steps.indexOf(freshness) + 1);
    expect(scanner.with).not.toHaveProperty('projectBaseDir');
    const args = scanner.with.args
      .replace('${{ steps.sonar-freshness.outputs.sha }}', sha)
      .trim()
      .split(/\s+/);
    expect(args).toEqual(['-Dsonar.scm.revision=' + sha]);
  });

  it('reads current PR API state and admits the exact checked-out head', async () => {
    const result = await runFreshness();
    expect(result.outputs).toEqual({ decision: 'scan', sha });
    expect(result.calls).toEqual([
      ['pulls.get', { owner: 'owner', repo: 'repo', pull_number: 1403 }]
    ]);
  });

  it.each([
    [
      'head changed after coverage',
      pr => {
        pr.head.sha = newerSha;
      }
    ],
    [
      'closed PR',
      pr => {
        pr.state = 'closed';
      }
    ],
    [
      'merged PR',
      pr => {
        pr.state = 'closed';
        pr.merged = true;
      }
    ],
    [
      'base changed',
      pr => {
        pr.base.ref = 'release/2';
      }
    ],
    [
      'head repository changed',
      pr => {
        pr.head.repo.id = 9;
      }
    ],
    [
      'base repository changed',
      pr => {
        pr.base.repo.id = 9;
      }
    ],
    [
      'head ref changed',
      pr => {
        pr.head.ref = 'replacement';
      }
    ]
  ])('visibly skips superseded PR: %s', async (_, change) => {
    const currentPr = globalThis.structuredClone(fixture().event.pull_request);
    change(currentPr);
    const result = await runFreshness({ currentPr });
    expect(result.outputs.decision).toBe('superseded');
    expect(result.summaries.join('\n')).toMatch(/superseded/i);
    expect(evaluate(scanner.if, fixture(), result.outputs.decision)).toBe(false);
  });

  it.each([
    ['old run admitted first', [sha, newerSha]],
    ['new run admitted first', [newerSha, sha]]
  ])(
    'rejects stale main regardless of completion/admission order: %s',
    async (_, admissionOrder) => {
      for (const checkoutSha of admissionOrder) {
        const github = fixture('push');
        github.sha = checkoutSha;
        const result = await runFreshness({ github, checkoutSha, remoteSha: newerSha });
        const want = checkoutSha === sha ? 'superseded' : 'scan';
        expect(result.outputs.decision).toBe(want);
        if (want === 'superseded') expect(result.summaries.join('\n')).toMatch(/superseded/i);
        expect(evaluate(scanner.if, github, result.outputs.decision)).toBe(want === 'scan');
        expect(result.calls).toEqual([
          ['git.getRef', { owner: 'owner', repo: 'repo', ref: 'heads/main' }]
        ]);
      }
    }
  );

  it('admits main only when checked-out and remote revisions match', async () => {
    expect((await runFreshness({ github: fixture('push') })).outputs).toEqual({
      decision: 'scan',
      sha
    });
  });

  it.each([
    ['unavailable PR API', { apiError: new Error('network unavailable') }],
    [
      'unavailable main API',
      { github: fixture('push'), apiError: new Error('network unavailable') }
    ],
    ['malformed PR', { currentPr: {} }],
    ['malformed remote main SHA', { github: fixture('push'), remoteSha: 'bad\nsha' }],
    ['wrong checkout', { checkoutSha: newerSha }],
    ['malformed checkout', { checkoutSha: 'bad\nsha' }]
  ])('fails closed: %s', async (_, input) => {
    expect(freshness).toBeDefined();
    await expect(runFreshness(input)).rejects.toThrow();
  });
});
