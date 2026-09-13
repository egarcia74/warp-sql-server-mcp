/**
 * Makes the ABSENCE of the GIT_* scrub a CI failure (#1214).
 *
 * #1207 fixed one file. The lint rule in `eslint.config.js` is what stops the next test
 * from reintroducing the incident, and a lint rule nobody exercises is a comment. So this
 * suite runs the project's REAL ESLint configuration - not a hand-built copy of the
 * selectors - over generated sources and over the repository's own files, and asserts:
 *
 *   1. an unscrubbed git spawn under `test/` is reported (the negative case: the guard fires);
 *   2. the scrubbed spawns already in `verify-publish-tree.test.js` are not (the positive case);
 *   3. the same unscrubbed spawn under `scripts/` and `lib/` is NOT reported, because those
 *      spawn git against the real repository on purpose;
 *   4. `test/` is still inside the lint scope at all, so the rule cannot be "made to pass"
 *      by quietly narrowing what gets linted;
 *   5. the complete set of suppressions of the rule in the test tree is exactly the one
 *      documented control in `verify-publish-tree.test.js` - an `eslint-disable` defeats any
 *      lint rule, so the escape hatch is pinned rather than pretended away;
 *   6. `runGit()` - the sanctioned path the rule's message points at - actually scrubs, so a
 *      helper that merely looked like it scrubbed could not pass.
 *
 * The unscrubbed fixtures are generated as source strings and linted through `lintText` at a
 * path under `test/`. They are never written to disk, so `npm run lint` cannot see them and
 * nothing can execute them.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

import { UNSCRUBBED_GIT_SPAWN_MESSAGE } from '../../eslint.config.js';
import { runGit } from '../helpers/git.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Discovers `eslint.config.js` the same way `npm run lint` does - no overrides. */
const eslint = new ESLint({ cwd: REPO_ROOT });

/** Only reports from the #1214 guard; other rules firing on a fixture are not the subject. */
const guardReports = result =>
  (result.messages ?? []).filter(
    message =>
      message.ruleId === 'no-restricted-syntax' && message.message === UNSCRUBBED_GIT_SPAWN_MESSAGE
  );

async function lintSource(code, relativePath) {
  const [result] = await eslint.lintText(code, {
    filePath: resolve(REPO_ROOT, relativePath),
    warnIgnored: false
  });
  return result;
}

// Assembled rather than written literally so this file's own source contains no spawn the
// guard would have to report - the fixtures are data here, not code.
const GIT = `${'g'}it`;

/** Every shape of unscrubbed git spawn the guard claims to catch. */
const UNSCRUBBED_FIXTURES = {
  'execFileSync with cwd but no env': `import { execFileSync } from 'node:child_process';
export const show = dir => execFileSync('${GIT}', ['rev-parse', '--show-toplevel'], { cwd: dir });`,
  'execFileSync with no options at all': `import { execFileSync } from 'node:child_process';
export const show = () => execFileSync('${GIT}', ['status']);`,
  'the inherited environment passed through explicitly': `import { spawnSync } from 'node:child_process';
export const show = dir => spawnSync('${GIT}', ['status'], { cwd: dir, env: process.env });`,
  'the inherited environment spread into a fresh object': `import { spawnSync } from 'node:child_process';
export const show = dir => spawnSync('${GIT}', ['status'], { cwd: dir, env: { ...process.env } });`,
  'a namespace import of child_process': `import * as cp from 'node:child_process';
export const show = dir => cp.execFileSync('${GIT}', ['status'], { cwd: dir });`,
  'execSync with a string command': `import { execSync } from 'node:child_process';
export const show = dir => execSync('${GIT} status', { cwd: dir });`,
  'execSync with a template-literal command': `import { execSync } from 'node:child_process';
export const show = (dir, sub) => execSync(\`${GIT} \${sub}\`, { cwd: dir });`,
  // Windows resolves executables without regard to case, so these launch the same binary
  // and inherit the same GIT_* variables as the lowercase spelling.
  'the Windows-cased Git': `import { execFileSync } from 'node:child_process';
export const show = dir => execFileSync('${GIT.replace('g', 'G')}', ['status'], { cwd: dir });`,
  'the Windows executable GIT.EXE': `import { execFileSync } from 'node:child_process';
export const show = dir => execFileSync('${GIT.toUpperCase()}.EXE', ['status'], { cwd: dir });`
};

/** Spawns that must stay legal, so the guard is not a blanket ban on child processes. */
const ALLOWED_FIXTURES = {
  'a direct spawn that passes the scrub': `import { execFileSync } from 'node:child_process';
import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';
export const show = dir =>
  execFileSync('${GIT}', ['status'], { cwd: dir, encoding: 'utf8', env: scrubbedEnv() });`,
  'a spawn routed through the shared helper': `import { runGit } from '../helpers/git.js';
export const show = dir => runGit(['status'], { cwd: dir });`,
  'npm, node and docker, which carry no GIT_* hazard': `import { execFileSync, execSync, spawn } from 'node:child_process';
export const a = dir => execFileSync('npm', ['run', 'build'], { cwd: dir });
export const b = () => execSync('docker ps', { stdio: 'ignore' });
export const c = script => spawn('node', [script]);`,
  'a command that merely starts with the same letters': `import { execFileSync } from 'node:child_process';
export const show = () => execFileSync('${GIT}leaks', ['detect']);`
};

describe('the #1214 guard fires on an unscrubbed git spawn under test/', () => {
  for (const [shape, source] of Object.entries(UNSCRUBBED_FIXTURES)) {
    it(`reports ${shape}`, async () => {
      const result = await lintSource(source, 'test/unit/generated-unscrubbed-fixture.js');
      const reports = guardReports(result);
      expect(reports).toHaveLength(1);
      expect(reports[0].severity).toBe(2); // an error, so `eslint .` exits non-zero
      expect(reports[0].message).toMatch(/runGit\(\) from test\/helpers\/git\.js/);
    });
  }
});

describe('the #1214 guard stays silent where it should', () => {
  for (const [shape, source] of Object.entries(ALLOWED_FIXTURES)) {
    it(`does not report ${shape}`, async () => {
      const result = await lintSource(source, 'test/unit/generated-allowed-fixture.js');
      expect(guardReports(result)).toEqual([]);
    });
  }

  it('does not report the scrubbed spawns already in verify-publish-tree.test.js', async () => {
    const target = resolve(REPO_ROOT, 'test/unit/verify-publish-tree.test.js');
    const [result] = await eslint.lintFiles([target]);
    expect(guardReports(result)).toEqual([]);
    expect(result.errorCount).toBe(0);
  });

  // scripts/ and lib/ spawn git against the real repository deliberately - that is the whole
  // job of scripts/ci/verify-publish-tree.mjs. The same source must be clean there.
  for (const outside of ['scripts/ci/generated-fixture.mjs', 'lib/utils/generated-fixture.js']) {
    it(`does not apply outside test/ (${outside})`, async () => {
      const result = await lintSource(
        UNSCRUBBED_FIXTURES['execFileSync with cwd but no env'],
        outside
      );
      expect(guardReports(result)).toEqual([]);
    });
  }

  it('leaves the real scripts/ci/verify-publish-tree.mjs unreported', async () => {
    const [result] = await eslint.lintFiles([
      resolve(REPO_ROOT, 'scripts/ci/verify-publish-tree.mjs')
    ]);
    expect(guardReports(result)).toEqual([]);
  });
});

describe('the guard cannot be satisfied by shrinking what gets linted', () => {
  it('keeps test/ inside the lint scope', async () => {
    for (const file of [
      'test/unit/verify-publish-tree.test.js',
      'test/helpers/git.js',
      'test/docker/detect-platform.js'
    ]) {
      expect(await eslint.isPathIgnored(resolve(REPO_ROOT, file))).toBe(false);
    }
  });

  it("ignores gitignored agent worktrees, so one branch cannot fail another branch's push", async () => {
    // The pre-push hook runs `eslint .` over the whole tree. .claude/worktrees/ holds
    // gitignored checkouts, so a half-written file in one would otherwise block every
    // other branch's push - it did, on 2026-09-12.
    for (const file of [
      '.claude/worktrees/agent-example/test/unit/whatever.test.js',
      '.worktrees/other/index.js'
    ]) {
      expect(await eslint.isPathIgnored(resolve(REPO_ROOT, file))).toBe(true);
    }
  });

  it('configures the rule for every JavaScript file under test/, not only *.test.js', async () => {
    for (const file of [
      'test/unit/verify-publish-tree.test.js',
      'test/helpers/git.js',
      'test/unit/fixtures/cleanup-inspector-harness.js',
      'test/docker/developer-stress-test.js'
    ]) {
      const config = await eslint.calculateConfigForFile(resolve(REPO_ROOT, file));
      expect(config.rules['no-restricted-syntax']?.[0]).toBe(2);
    }
  });

  it('leaves the rule off for scripts/ and lib/', async () => {
    for (const file of ['scripts/ci/verify-publish-tree.mjs', 'lib/utils/logger.js', 'index.js']) {
      const config = await eslint.calculateConfigForFile(resolve(REPO_ROOT, file));
      expect(config.rules['no-restricted-syntax']?.[0] ?? 0).toBe(0);
    }
  });
});

describe('the escape hatch is pinned, not pretended away', () => {
  // An `eslint-disable` comment defeats any lint rule, so the honest guarantee is not "no
  // suppression can exist" but "a new one cannot appear silently". ESLint reports suppressed
  // problems separately from live ones; this asserts the complete set across the test tree.
  it('allows exactly one suppression of the rule in the whole test tree', async () => {
    const results = await eslint.lintFiles([resolve(REPO_ROOT, 'test')]);
    const suppressed = results.flatMap(result =>
      (result.suppressedMessages ?? [])
        .filter(
          message =>
            message.ruleId === 'no-restricted-syntax' &&
            message.message === UNSCRUBBED_GIT_SPAWN_MESSAGE
        )
        .map(() => relative(REPO_ROOT, result.filePath))
    );
    expect(suppressed).toEqual(['test/unit/verify-publish-tree.test.js']);
  });

  // A suppression is not the only escape hatch. An inline CONFIGURATION comment can turn
  // the rule off outright, in which case ESLint produces no problem at all and the file
  // shows up in neither the reports nor the suppressed messages - both assertions around
  // this one pass while an unscrubbed spawn sits in the file. Verified against real ESLint.
  //
  // The scanned set comes from ESLint itself rather than a glob, so it cannot drift from
  // what is actually linted: a glob of `test/**/*.js` silently omits hidden paths, and a
  // file such as `test/.hidden-bypass.js` IS linted - verified - so it could have carried
  // the override and gone unseen.
  //
  // The directive words are assembled rather than written, for the same reason the git
  // fixtures above are: this file must contain no directive text of its own, or the scan
  // would match its own source. That also means this file cannot exempt itself.
  it('allows exactly the known ESLint directive comments in everything it lints under test/', async () => {
    const word = `${'esl'}int`;
    // Every inline form ESLint honours: the rule-config and disable families, plus the
    // environment ones, which are directives too even though they cannot disable a rule.
    const labels = [word, `${word}-disable`, `${word}-enable`, 'global', 'globals', 'exported'];
    const directive = new RegExp(
      `\\/\\*\\s*(?:${labels.join('|')})[-\\w]*[\\s\\S]*?\\*\\/|` +
        `\\/\\/\\s*${word}-(?:disable|enable)[-\\w]*[^\\n]*`,
      'g'
    );
    const nextLine = `${word}-disable-next-line`;

    const results = await eslint.lintFiles([resolve(REPO_ROOT, 'test')]);
    const found = [];

    for (const result of results) {
      const source = await readFile(result.filePath, 'utf8');
      for (const [text] of source.matchAll(directive)) {
        found.push(`${relative(REPO_ROOT, result.filePath)}: ${text.trim()}`);
      }
    }

    expect(found.sort()).toEqual(
      [
        `test/unit/classify-dependabot-pr.test.js: // ${nextLine} no-control-regex`,
        `test/unit/verify-publish-tree.test.js: // ${nextLine} no-restricted-syntax -- deliberate unscrubbed control, see above`
      ].sort()
    );
  });

  it('lints the whole test tree clean under the guard', async () => {
    const results = await eslint.lintFiles([resolve(REPO_ROOT, 'test')]);
    const live = results.flatMap(result =>
      guardReports(result).map(message => `${result.filePath}:${message.line}`)
    );
    expect(live).toEqual([]);
  });
});

describe('runGit(), the path the guard points at, actually scrubs', () => {
  // The lint rule can only see that the name `scrubbedEnv` appears. This is the behavioural
  // half: the helper must survive a live GIT_DIR, which is precisely what went wrong in 2026-09-11.
  it('ignores an inherited GIT_DIR and stays on its own cwd', () => {
    const temporary = [];
    const makeRepo = () => {
      const dir = mkdtempSync(join(tmpdir(), 'git-scrub-guard-'));
      temporary.push(dir);
      runGit(['init', '-q', '-b', 'main'], { cwd: dir });
      runGit(['config', 'user.email', 'test@example.com'], { cwd: dir });
      runGit(['config', 'user.name', 'Test'], { cwd: dir });
      runGit(['commit', '-q', '--allow-empty', '-m', 'initial'], { cwd: dir });
      return dir;
    };

    const saved = { ...process.env };
    try {
      const victim = makeRepo();
      const scratch = makeRepo();

      process.env.GIT_DIR = join(victim, '.git');
      process.env.GIT_WORK_TREE = victim;
      process.env.GIT_INDEX_FILE = join(victim, '.git', 'index');
      // Windows environment names are case-insensitive and git there honours `git_dir` as
      // readily as `GIT_DIR`; the helper must not depend on the case a name was set in.
      process.env.git_ceiling_directories = '/nonexistent';

      // A write through the helper must land in `scratch` and nowhere else.
      runGit(['tag', '-a', 'v9.9.9', '-m', 'fixture'], { cwd: scratch });

      expect(runGit(['tag', '-l'], { cwd: scratch }).trim()).toBe('v9.9.9');
      expect(runGit(['tag', '-l'], { cwd: victim }).trim()).toBe(''); // no leaked tag
      expect(runGit(['log', '--oneline'], { cwd: victim }).trim().split('\n')).toHaveLength(1);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
    }
  });
});
