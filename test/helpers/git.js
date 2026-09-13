/**
 * The one sanctioned way for a test to spawn git.
 *
 * A test spawns git against a temp-directory fixture and locates that repository by `cwd`.
 * But `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` beat `cwd`, and a linked git worktree
 * exports them into hook environments - so under the pre-commit hook on 2026-09-11 a suite
 * that believed it was operating on `mkdtempSync()` fixtures rewrote the REAL repository:
 * `core.worktree` re-pointed at a temp dir that was then deleted, the committer identity
 * overwritten, a fake `v1.8.0` tag created and five fixture commits landed on a live branch.
 *
 * Nothing a test spawns wants those variables, so this helper strips them at every spawn.
 * The scrub itself is `scrubbedEnv()` from `scripts/ci/verify-publish-tree.mjs`, imported
 * rather than copied: a second implementation is exactly the drift #1214 is about, and that
 * one is the copy the publish gate itself runs behind.
 *
 * `eslint.config.js` makes a direct `child_process` git spawn under `test/` a lint error
 * unless it passes `env: scrubbedEnv()`, so this file's own spawn is the sanctioned shape
 * and needs no exemption.
 */
import { execFileSync } from 'node:child_process';

import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';

/**
 * Runs git synchronously and returns its stdout as a string.
 *
 * @param {string[]} args - git arguments, passed through `execFileSync` with no shell.
 * @param {object} [options] - `execFileSync` options; `cwd` is what selects the repository.
 *   `env` is deliberately NOT overridable - a caller that could pass its own environment
 *   could pass the unscrubbed one, which is the whole failure being prevented.
 * @returns {string} git's stdout.
 */
export function runGit(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    ...options,
    env: scrubbedEnv()
  });
}
