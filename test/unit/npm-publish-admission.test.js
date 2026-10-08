import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflow = parseYaml(
  readFileSync(new URL('../../.github/workflows/npm-publish.yml', import.meta.url), 'utf8')
);
const publish = workflow.jobs.publish;

function admitted({
  repository = 'egarcia74/warp-sql-server-mcp',
  event_name = 'workflow_dispatch',
  ref = 'refs/heads/main'
} = {}) {
  const expression = publish.if?.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/)?.[1];
  expect(expression, 'publish job needs a GitHub Actions admission expression').toBeDefined();
  // This checks the actual YAML expression against the lowercase fixtures below, using JS.
  // GitHub's string == ignores case: refs/heads/MAIN can pass the YAML comparison even
  // though JS rejects it. The exact-main environment restriction must cover that case.
  return runInNewContext(
    expression,
    { github: { repository, event_name, ref } },
    { timeout: 1000 }
  );
}

describe('npm publishing admission', () => {
  it('accepts only the intended push and manual retry on main', () => {
    expect(workflow.on.push).toEqual({ branches: ['main'], paths: ['package.json'] });
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(admitted({ event_name: 'push' })).toBe(true);
    expect(admitted({ event_name: 'workflow_dispatch' })).toBe(true);
  });

  it.each([
    [{ ref: 'refs/heads/feature' }, 'branch dispatch'],
    [{ event_name: 'push', ref: 'refs/heads/feature' }, 'branch push'],
    [{ ref: 'refs/tags/main' }, 'tag named main'],
    [{ ref: 'refs/tags/v2.1.2' }, 'release tag'],
    [{ repository: 'other-owner/warp-sql-server-mcp' }, 'other repository'],
    [{ event_name: 'pull_request' }, 'other event']
  ])('rejects %s (%s)', (fixture, _description) => {
    expect(admitted(fixture)).toBe(false);
  });

  it('holds OIDC in the named environment and checks out the admitted event SHA', () => {
    expect(publish.environment).toBe('npm-publish');
    expect(publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });

    const checkout = publish.steps.find(step => step.name === 'Checkout');
    expect(checkout.with).toMatchObject({
      ref: '${{ github.sha }}',
      'persist-credentials': false,
      'fetch-depth': 0
    });
  });
});
