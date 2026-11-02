import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/cleanup-test-processes.js'
);
const invoke = args =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 4000 });

describe('process inspector CLI', () => {
  it('documents the identity-only KILL check', () => {
    const result = invoke(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Before KILL/);
    expect(result.stdout).toMatch(/start time/);
  });

  it('does not fail a report when process inspection is unavailable', () => {
    const result = invoke([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/WARP Test Process Inspector/);
  });

  it('rejects an empty kill request with code 2', () => {
    const result = invoke(['--kill']);
    expect(result.status).toBe(2);
  });

  it('keeps the pre-push hook nonblocking when the report cannot read ps', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cleanup-hook-'));
    const repo = path.resolve(path.dirname(script), '..');
    try {
      mkdirSync(path.join(root, 'scripts'));
      mkdirSync(path.join(root, 'hooks'));
      mkdirSync(path.join(root, 'bin'));
      for (const name of [
        'cleanup-test-processes.js',
        'cleanup-process-inspector.js',
        'cleanup-process-platform.js'
      ]) {
        copyFileSync(path.join(repo, 'scripts', name), path.join(root, 'scripts', name));
      }
      chmodSync(path.join(root, 'scripts', 'cleanup-test-processes.js'), 0o755);
      copyFileSync(path.join(repo, 'hooks', 'pre-push'), path.join(root, 'hooks', 'pre-push'));
      writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
      for (const name of ['npm', 'npx']) {
        const file = path.join(root, 'bin', name);
        writeFileSync(file, '#!/bin/sh\nexit 0\n');
        chmodSync(file, 0o755);
      }
      const result = spawnSync('/bin/bash', ['hooks/pre-push'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` }
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Process check complete/);
      expect(result.stdout).toMatch(/All pre-push checks passed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
