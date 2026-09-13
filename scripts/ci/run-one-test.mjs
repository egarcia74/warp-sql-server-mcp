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
import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const TEST_ROOT = resolve(REPO_ROOT, 'test');

export function resolveTestFile(
  argv,
  { root = TEST_ROOT, exists = existsSync, isFile, realpath = realpathSync } = {}
) {
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

  const lexical = resolve(root, '..', candidate);

  // Containment is checked on the resolved path, so ../ escapes and absolute
  // paths outside the repo's test directory both fail here.
  if (!contains(root, lexical)) {
    return { ok: false, reason: `outside ${root}: ${candidate}` };
  }

  if (!exists(lexical) || !stat(lexical)) {
    return { ok: false, reason: `no such test file: ${candidate}` };
  }

  // Lexical resolution does not follow symlinks, so test/unit/x.test.js could
  // still be a link pointing anywhere. Re-check containment on the canonical
  // path, with the root canonicalised too so a symlinked checkout does not
  // reject everything. Only reached once the file is known to exist.
  let canonical;
  let canonicalRoot;
  try {
    canonical = realpath(lexical);
    canonicalRoot = realpath(root);
  } catch {
    return { ok: false, reason: `cannot resolve: ${candidate}` };
  }

  if (!contains(canonicalRoot, canonical)) {
    return { ok: false, reason: `resolves outside ${root}: ${candidate}` };
  }

  return { ok: true, file: canonical };
}

function contains(root, path) {
  return path === root || path.startsWith(root + sep);
}

function main() {
  const result = resolveTestFile(process.argv.slice(2));

  if (!result.ok) {
    console.error(`run-one-test: ${result.reason}`);
    console.error('usage: npm run test:one -- test/unit/<name>.test.js');
    process.exit(2);
  }

  let vitest;
  try {
    vitest = resolveVitest();
  } catch (error) {
    console.error(`run-one-test: ${error.message}`);
    process.exit(2);
  }

  execFileSync(process.execPath, [vitest, 'run', result.file], { stdio: 'inherit' });
}

/**
 * Locate this repository's own vitest.
 *
 * Not `npx vitest`: that resolves the binary through PATH (Sonar S4036) and puts a package
 * manager between this guard and the runner. `createRequire` anchors lookup at the working
 * directory but does not confine it there - with the dependency absent or NODE_PATH set it
 * can reach an ancestor or global install - so the resolved entry point is required to sit
 * under this repository's own node_modules before it is executed.
 */
export function resolveVitest({
  root = REPO_ROOT,
  require = createRequire(`${REPO_ROOT}${sep}`)
} = {}) {
  const modules = resolve(root, 'node_modules');
  const entry = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

  let canonicalEntry;
  let canonicalModules;
  try {
    canonicalEntry = realpathSync(entry);
    canonicalModules = realpathSync(modules);
  } catch {
    throw new Error(`cannot resolve vitest under ${modules}`);
  }

  if (canonicalEntry !== canonicalModules && !canonicalEntry.startsWith(canonicalModules + sep)) {
    throw new Error(`refusing a vitest outside ${modules}: ${entry}`);
  }

  return canonicalEntry;
}

// pathToFileURL, not a hand-built `file://` string: a checkout path containing a space or a
// Windows drive letter percent-encodes differently, and a mismatched comparison would exit
// zero without running anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
