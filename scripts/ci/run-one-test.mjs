#!/usr/bin/env node
/**
 * Run ONE existing unit test file under vitest, and nothing else.
 *
 * This exists so the Claude review Action can verify a claim about a single
 * test ("this regression test fails on the old code") without being granted a
 * tool pattern that accepts arbitrary vitest flags. `vitest run` treats
 * --config, --setupFiles, --globalSetup and friends as code to execute, so
 * allowing `npx vitest run <anything>` in a job that carries GITHUB_TOKEN and
 * an OAuth token is arbitrary code execution wearing a test runner's clothes.
 *
 * The guarantee here is positional, not textual: exactly one argument, it may
 * not start with '-', it must resolve inside the repository's test directory,
 * and it must already exist as a .test.js file. Everything else exits non-zero
 * without spawning anything.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const TEST_ROOT = resolve(process.cwd(), 'test');

export function resolveTestFile(argv, { root = TEST_ROOT, exists = existsSync, isFile } = {}) {
  const stat = isFile ?? (p => statSync(p).isFile());

  if (argv.length !== 1) {
    return { ok: false, reason: `expected exactly one test file, got ${argv.length}` };
  }

  const [candidate] = argv;

  if (typeof candidate !== 'string' || candidate.length === 0) {
    return { ok: false, reason: 'test file must be a non-empty string' };
  }

  // An option, not a path. Rejected before any path handling so that a flag
  // can never reach vitest through this script.
  if (candidate.startsWith('-')) {
    return { ok: false, reason: `refusing an option-shaped argument: ${candidate}` };
  }

  if (candidate.includes('\0')) {
    return { ok: false, reason: 'test file must not contain a null byte' };
  }

  if (!candidate.endsWith('.test.js')) {
    return { ok: false, reason: `not a test file: ${candidate}` };
  }

  const full = resolve(root, '..', candidate);

  // Containment is checked on the resolved path, so ../ escapes and absolute
  // paths outside the repo's test directory both fail here.
  if (full !== root && !full.startsWith(root + sep)) {
    return { ok: false, reason: `outside ${root}: ${candidate}` };
  }

  if (!exists(full) || !stat(full)) {
    return { ok: false, reason: `no such test file: ${candidate}` };
  }

  return { ok: true, file: full };
}

function main() {
  const result = resolveTestFile(process.argv.slice(2));

  if (!result.ok) {
    console.error(`run-one-test: ${result.reason}`);
    console.error('usage: npm run test:one -- test/unit/<name>.test.js');
    process.exit(2);
  }

  execFileSync('npx', ['vitest', 'run', result.file], { stdio: 'inherit' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
