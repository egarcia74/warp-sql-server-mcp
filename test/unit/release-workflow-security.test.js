import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { describe, expect, test } from 'vitest';

const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8'));
const step = (job, name) => workflow.jobs[job].steps.find(item => item.name === name);
// The only executable source is the checked-in workflow parsed above. Payloads enter
// the sandbox as environment data, never as source. No GitHub service is contacted.
const script = (job, name, bindings) =>
  runInNewContext(`(async () => {\n${step(job, name).with.script}\n})()`, bindings);

function bash(job, name, env = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'release-inputs-'));
  const log = join(directory, 'calls');
  const output = join(directory, 'output');
  const summary = join(directory, 'summary');
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ version: env.PACKAGE_VERSION ?? '2.1.1' })
  );
  const result = spawnSync('bash', ['-e', '-o', 'pipefail'], {
    cwd: directory,
    input:
      'git() { printf \'git\'; printf \' <%s>\' "$@"; printf \'\\n\'; if [ "$1" = rev-parse ]; then if [ "$COLLIDE" = true ] && [ "$COLLIDED" != 1 ]; then COLLIDED=1; return 0; fi; return 1; fi; if [ "$1" = ls-remote ]; then return 1; fi; } >> "$CALL_LOG"\n' +
      "gh() { printf 'gh'; printf ' <%s>' \"$@\"; printf '\\n'; } >> \"$CALL_LOG\"\n" +
      'touch() { printf \'SENTINEL COMMAND EXECUTED\\n\' >> "$CALL_LOG"; }\n' +
      'npm() { { printf \'npm\'; printf \' <%s>\' "$@"; printf \'\\n\'; } >> "$CALL_LOG"; if [ "$COLLIDED" = 1 ]; then echo "$NPM_PATCH"; else echo "$NPM_VERSION"; fi; }\n' +
      step(job, name).run,
    encoding: 'utf8',
    env: {
      ...process.env,
      CALL_LOG: log,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_REPOSITORY: 'owner/repo',
      NPM_VERSION: 'v2.1.2-0',
      ...env
    }
  });
  const read = path => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
  const captured = { ...result, calls: read(log), output: read(output), summary: read(summary) };
  rmSync(directory, { recursive: true, force: true });
  return captured;
}

async function classify(manual, detected = 'patch', count = 1, ships = true, dry = 'false') {
  const outputs = {};
  const summary = {
    addHeading() {
      return this;
    },
    addRaw() {
      return this;
    },
    addBreak() {
      return this;
    },
    async write() {}
  };
  const core = {
    summary,
    info() {},
    warning() {},
    setOutput(key, value) {
      outputs[key] = value;
    }
  };
  const plan = {
    lastTag: 'v2.0.0',
    commitCount: count,
    releaseType: detected,
    ships,
    commits: [],
    unclassified: [],
    summary: 'fixture',
    unshipped: []
  };
  try {
    await script('check-changes', 'Check conventional commits', {
      require: () => ({ execFileSync: () => JSON.stringify(plan) }),
      process: { env: { MANUAL_TYPE: manual, DRY_RUN: dry } },
      core
    });
  } catch (error) {
    error.outputs = outputs;
    throw error;
  }
  return outputs;
}

describe('release workflow input boundaries', () => {
  test('keeps none at the current version without invoking npm or tag probes', () => {
    const result = bash('release', 'Bump version', { RELEASE_TYPE: 'none' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toBe('version=2.1.1\n');
    expect(result.calls).toBe('');
    const invalid = bash('release', 'Bump version', {
      RELEASE_TYPE: 'none',
      PACKAGE_VERSION: 'v2.1.1'
    });
    expect(invalid.status).not.toBe(0);
    expect(invalid.output).toBe('');
  });
  test('uses canonical versions as single tag and branch arguments', () => {
    const tagged = bash('release', 'Create Git tag (without committing version bump)', {
      VERSION: '2.1.2-0'
    });
    expect(tagged.status, tagged.stderr).toBe(0);
    expect(tagged.calls).toContain('git <tag> <-a> <v2.1.2-0> <-m> <Release v2.1.2-0>');
    const branch = bash('version-pr', 'Prepare version bump commit', { VERSION: '2.1.2-0' });
    expect(branch.status, branch.stderr).toBe(0);
    expect(branch.calls).toContain('git <checkout> <-b> <chore/release/v2.1.2-0>');
    expect(branch.calls).toContain(
      'npm <version> <2.1.2-0> <--no-git-tag-version> <--allow-same-version>'
    );
  });
  test('validates initial and collision candidates before tag queries or output', () => {
    const initial = bash('release', 'Bump version', { RELEASE_TYPE: 'prerelease' });
    expect(initial.status, initial.stderr).toBe(0);
    expect(initial.output).toBe('version=2.1.2-0\n');
    const collision = bash('release', 'Bump version', {
      RELEASE_TYPE: 'patch',
      COLLIDE: 'true',
      NPM_PATCH: 'v2.1.3'
    });
    expect(collision.status, collision.stderr).toBe(0);
    expect(collision.output).toBe('version=2.1.3\n');
  });
  test.each(['vv2.1.2', 'v2.1.2-01', 'v2.1.2\nother', '$(touch sentinel)'])(
    'rejects candidate %j before tag query or output, including collision bumps',
    invalid => {
      const result = bash('release', 'Bump version', {
        RELEASE_TYPE: 'patch',
        NPM_VERSION: invalid
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toBe('');
      expect(result.calls).not.toContain('<rev-parse>');
      const repeated = bash('release', 'Bump version', {
        RELEASE_TYPE: 'patch',
        COLLIDE: 'true',
        NPM_PATCH: invalid
      });
      expect(repeated.status).not.toBe(0);
      expect(repeated.output).toBe('');
    }
  );
  test.each([
    ['notify', 'Create follow-up issue for documentation'],
    ['version-pr', 'Open pull request']
  ])('validates direct JS consumers in %s', async (job, name) => {
    for (const version of [
      '2.1.2-0',
      '2.1.2-alpha.1+build.2',
      'v2.1.2',
      '2.1.2\n',
      '2.1.2-01',
      "'; throw Error('sentinel'); //",
      undefined
    ]) {
      const calls = [];
      const github = {
        rest: {
          issues: {
            create: async args => {
              calls.push(args);
            }
          },
          pulls: {
            list() {},
            create: async args => {
              calls.push(args);
              return { data: { number: 1 } };
            }
          }
        },
        paginate: async () => []
      };
      const run = script(job, name, {
        process: { env: { VERSION: version, BRANCH: 'malicious-other-branch' } },
        github,
        context: { repo: { owner: 'owner', repo: 'repo' } },
        core: { info() {} }
      });
      if (['2.1.2-0', '2.1.2-alpha.1+build.2'].includes(version)) {
        await run;
        expect(calls).toHaveLength(1);
        expect(calls[0].title).toContain(`v${version}`);
        if (job === 'version-pr') expect(calls[0].head).toBe(`chore/release/v${version}`);
      } else {
        await expect(run).rejects.toThrow();
        expect(calls).toHaveLength(0);
      }
    }
  });
  test('renders dry-run and cleanup payloads as data', () => {
    const payload = '"; $(touch sentinel) `touch sentinel`\ntext';
    const preview = bash('release', 'Dry run summary', {
      SKIP_REASON: 'no-packed-changes',
      CHANGELOG: payload
    });
    expect(preview.status).toBe(0);
    expect(preview.summary).toContain('Would create release:** nothing');
    expect(preview.summary).toContain(payload);
    const cleanup = bash('cleanup', 'Workflow summary', {
      RELEASE_TYPE: payload,
      SKIP_REASON: 'no-packed-changes',
      DRY_RUN: 'true',
      RELEASE_RESULT: 'success'
    });
    expect(cleanup.status).toBe(0);
    expect(cleanup.summary).toContain(payload);
    expect(cleanup.summary).toContain('Would be REFUSED');
    expect(cleanup.summary).not.toContain('Completed successfully');
  });
  test.each([
    '',
    'none',
    'unknown',
    ' patch',
    'patch\n',
    '$(touch sentinel)',
    '`touch sentinel`',
    '"; touch sentinel; #'
  ])('rejects manual %j before outputs, even without commits', async value => {
    for (const count of [0, 1])
      await expect(classify(value, 'patch', count)).rejects.toMatchObject({ outputs: {} });
  });
  test.each(['', 'auto', 'unknown', 'patch\n', '$(touch sentinel)'])(
    'rejects computed %j before outputs',
    async value => {
      await expect(classify('auto', value)).rejects.toMatchObject({ outputs: {} });
    }
  );
  test.each(['patch', 'minor', 'major', 'prerelease'])('preserves forced %s', async value => {
    expect(await classify(value, 'none')).toMatchObject({
      release_type: value,
      should_release: 'true'
    });
    expect(await classify(value, 'patch', 0)).toMatchObject({
      release_type: 'none',
      should_release: 'false'
    });
  });
  test('preserves auto skip and dry-run path preview', async () => {
    expect(await classify('auto', 'none')).toMatchObject({
      release_type: 'none',
      should_release: 'false'
    });
    expect(await classify('auto', 'minor', 1, false, 'true')).toMatchObject({
      release_type: 'none',
      should_release: 'true',
      skip_reason: 'no-packed-changes'
    });
  });
  test('keeps dynamic values out of all executable bodies', () => {
    for (const job of Object.values(workflow.jobs))
      for (const item of job.steps) {
        expect(item.run ?? item.with?.script ?? '', item.name).not.toContain('${{');
      }
  });
  test('requires successful branch preparation before opening a PR', () => {
    const condition = step('version-pr', 'Open pull request').if;
    for (const [ok, outcome, expected] of [
      [true, 'success', true],
      [true, 'failure', false],
      [false, 'success', false],
      [true, 'skipped', false]
    ]) {
      expect(
        runInNewContext(condition, {
          success: () => ok,
          always: () => true,
          steps: { bumpfile: { outcome } }
        })
      ).toBe(expected);
    }
  });
  test('keeps dry-run tag and Release writes gated and ordered', () => {
    const steps = workflow.jobs.release.steps;
    const tag = step('release', 'Create Git tag (without committing version bump)');
    const release = step('release', 'Create GitHub Release');
    expect(steps.indexOf(tag)).toBeLessThan(steps.indexOf(release));
    expect(workflow.jobs['version-pr'].needs).toContain('release');
    for (const item of [tag, release]) {
      for (const [dry, expected] of [
        ['true', false],
        ['false', true]
      ]) {
        expect(
          runInNewContext(item.if.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), {
            github: { event: { inputs: { dry_run: dry } } }
          })
        ).toBe(expected);
      }
    }
  });
  test.each(['Create Git tag (without committing version bump)', 'Create GitHub Release'])(
    'rejects malformed versions before %s writes',
    name => {
      for (const VERSION of [
        'v2.1.2',
        '02.1.2',
        '2.1.2\n',
        '-x',
        '2.1.2-01',
        '$(touch sentinel)'
      ]) {
        const result = bash('release', name, { VERSION });
        expect(result.status).not.toBe(0);
        expect(result.calls).toBe('');
      }
    }
  );
  test('rejects malformed version before branch preparation', () => {
    const result = bash('version-pr', 'Prepare version bump commit', { VERSION: '2.1.2\n' });
    expect(result.status).not.toBe(0);
    expect(result.calls).toBe('');
  });
  test('accepts npm prerelease versions and keeps changelog payload inert', () => {
    const result = bash('release', 'Create GitHub Release', {
      VERSION: '2.1.2-0',
      PRERELEASE: 'true',
      CHANGELOG: '"; $(touch sentinel) `touch sentinel`\nnotes'
    });
    expect(result.status).toBe(0);
    expect(result.calls).toContain('<v2.1.2-0>');
    expect(result.calls).toContain('<"; $(touch sentinel) `touch sentinel`\nnotes>');
    expect(result.calls).not.toContain('SENTINEL COMMAND EXECUTED');
  });
});
