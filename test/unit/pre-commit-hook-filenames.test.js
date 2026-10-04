import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scrubbedEnv } from '../../scripts/ci/verify-publish-tree.mjs';
import { runGit } from '../helpers/git.js';

const hook = fileURLToPath(new URL('../../hooks/pre-commit', import.meta.url));

describe('pre-commit staged filenames', () => {
  it('passes quoted Markdown filenames as arguments without evaluating them', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'wssm-hook-filenames-'));
    const tools = path.join(fixture, 'tools');
    const filename = "evil'$(touch PWNED)'.md";

    try {
      mkdirSync(tools);
      mkdirSync(path.join(fixture, 'scripts'));
      writeFileSync(path.join(tools, 'npx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      writeFileSync(path.join(tools, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      writeFileSync(path.join(fixture, 'scripts', 'markdownlint.mjs'), 'process.exit(0);\n');
      writeFileSync(path.join(fixture, 'package.json'), '{"scripts":{"test":"true"}}\n');
      writeFileSync(path.join(fixture, filename), '# Fixture\n');

      runGit(['init', '-q'], { cwd: fixture });
      runGit(['add', '--', 'package.json', filename], { cwd: fixture });

      const result = spawnSync('bash', [hook], {
        cwd: fixture,
        encoding: 'utf8',
        env: { ...scrubbedEnv(), PATH: `${tools}:${process.env.PATH}` }
      });

      expect(result.status).toBe(0);
      expect(existsSync(path.join(fixture, 'PWNED'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
