#!/usr/bin/env node
/**
 * Runs every documentation drift check and reports ALL of them, then fails if any failed.
 *
 * `npm run docs:check` used to chain the checks with `&&`, which stops at the first failure.
 * That is the exact problem `.github/workflows/docs.yml` solves with `if: always()` on its
 * report steps, and the comments there spell out why: a run that reports only the first drift,
 * then publishes a report with the second section missing entirely, hides the second behind the
 * first. Chaining with `&&` reintroduced that one layer up - a contributor would fix the orphan
 * drift, push, and only then discover the tool-doc drift, paying a second CI round trip for
 * information the first run already had.
 *
 * Each check is a separate process so its own output, exit code and error formatting are
 * preserved exactly as when run on its own.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The checks, in reporting order. Each is a standalone script that exits non-zero on drift. */
export const CHECKS = [
  { name: 'Documentation nav reachability', script: 'check-orphan-docs.mjs' },
  { name: 'Environment variable doc sync', script: 'check-env-var-docs.mjs' },
  { name: 'MCP tool doc sync', script: 'check-tool-docs.mjs' }
];

export function runCheck(script, run = spawnSync) {
  const result = run(process.execPath, [path.join(here, script)], { stdio: 'inherit' });
  return result.status === 0;
}

function main() {
  const failed = [];

  for (const check of CHECKS) {
    if (!runCheck(check.script)) failed.push(check.name);
    console.log('');
  }

  if (failed.length === 0) return;

  console.error(`::error::${failed.length} documentation check(s) failed: ${failed.join(', ')}`);
  console.error('Every check above ran, so this is the complete list - fix them together.');
  process.exitCode = 1;
}

// Compare as file URLs: process.argv[1] is a plain filesystem path while import.meta.url is
// percent-encoded, so a hand-built `file://` + path string fails to match whenever the checkout
// contains a space, and main() would be skipped silently - exit 0, gate never run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
