import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const markdownlint = path.join(repository, 'scripts', 'markdownlint.mjs');
const runMarkdownlint = (arguments_, options) =>
  spawnSync(process.execPath, [markdownlint, ...arguments_], options);

describe('Markdown lint tooling', () => {
  it('lints hidden Markdown while preserving nested documentation exclusions', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'wssm-markdownlint-'));

    try {
      cpSync(path.join(repository, '.markdownlint.json'), path.join(fixture, '.markdownlint.json'));
      cpSync(
        path.join(repository, '.markdownlintignore'),
        path.join(fixture, '.markdownlintignore')
      );
      mkdirSync(path.join(fixture, '.github', 'instructions'), { recursive: true });
      mkdirSync(path.join(fixture, 'docs', 'superpowers'), { recursive: true });
      mkdirSync(path.join(fixture, 'nested', '.github', 'instructions'), { recursive: true });
      mkdirSync(path.join(fixture, 'nested', 'docs', 'superpowers'), { recursive: true });
      writeFileSync(path.join(fixture, 'good.md'), '# Good\n');
      writeFileSync(path.join(fixture, '.hidden.md'), '# Bad\n### Skipped heading\n');
      writeFileSync(
        path.join(fixture, '.github', 'instructions', 'ignored.md'),
        '# Bad\n### Skipped heading\n'
      );
      writeFileSync(
        path.join(fixture, 'docs', 'superpowers', 'ignored.md'),
        '# Bad\n### Skipped heading\n'
      );
      writeFileSync(
        path.join(fixture, 'nested', '.github', 'instructions', 'ignored.md'),
        '# Bad\n### Skipped heading\n'
      );
      writeFileSync(
        path.join(fixture, 'nested', 'docs', 'superpowers', 'ignored.md'),
        '# Bad\n### Skipped heading\n'
      );

      const failing = runMarkdownlint([], {
        cwd: fixture,
        encoding: 'utf8'
      });
      const output = `${failing.stdout ?? ''}${failing.stderr ?? ''}`;

      expect(failing.status).toBe(1);
      expect(output).toContain('.hidden.md');
      expect(output).not.toContain('ignored.md');
      rmSync(path.join(fixture, '.hidden.md'));
      const passing = runMarkdownlint([], {
        cwd: fixture,
        encoding: 'utf8'
      });
      expect(passing.status).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fixes only an explicitly supplied staged file', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'wssm-markdownlint-staged-'));

    try {
      cpSync(path.join(repository, '.markdownlint.json'), path.join(fixture, '.markdownlint.json'));
      const staged = path.join(fixture, 'staged.md');
      const unstaged = path.join(fixture, 'unstaged.md');
      writeFileSync(staged, '# Heading\nBody\n');
      writeFileSync(unstaged, '# Heading\nBody\n');

      const result = runMarkdownlint(['--fix', 'staged.md'], {
        cwd: fixture,
        encoding: 'utf8'
      });

      expect(result.status).toBe(0);
      expect(readFileSync(staged, 'utf8')).toBe('# Heading\n\nBody\n');
      expect(readFileSync(unstaged, 'utf8')).toBe('# Heading\nBody\n');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('does not allow ambient configuration to disable a repository rule', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'wssm-markdownlint-config-'));

    try {
      cpSync(path.join(repository, '.markdownlint.json'), path.join(fixture, '.markdownlint.json'));
      writeFileSync(path.join(fixture, 'bad.md'), '# Heading\n\n### Skipped\n');
      writeFileSync(path.join(fixture, 'ambient.json'), '{"MD001":false}\n');

      const result = runMarkdownlint([], {
        cwd: fixture,
        encoding: 'utf8',
        env: { ...process.env, markdownlint_config: path.join(fixture, 'ambient.json') }
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain('MD001');

      const fixResult = runMarkdownlint(['--fix', 'bad.md'], {
        cwd: fixture,
        encoding: 'utf8',
        env: { ...process.env, markdownlint_config: path.join(fixture, 'ambient.json') }
      });
      expect(fixResult.status).toBe(1);
      expect(`${fixResult.stdout ?? ''}${fixResult.stderr ?? ''}`).toContain('MD001');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('applies repository-approved fixes despite a local Markdown config', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'wssm-markdownlint-local-config-'));

    try {
      cpSync(path.join(repository, '.markdownlint.json'), path.join(fixture, '.markdownlint.json'));
      writeFileSync(path.join(fixture, '.markdownlintrc'), '{"MD022":false}\n');
      writeFileSync(path.join(fixture, 'bad.md'), '# Heading\nBody\n');

      const result = runMarkdownlint(['--fix', 'bad.md'], {
        cwd: fixture,
        encoding: 'utf8'
      });

      expect(result.status).toBe(0);
      expect(readFileSync(path.join(fixture, 'bad.md'), 'utf8')).toBe('# Heading\n\nBody\n');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails closed when a temporary-directory ancestor has a Markdown config', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'wssm-markdownlint-temp-config-'));
    const work = path.join(fixture, 'work');
    const temporary = path.join(fixture, 'temporary');

    try {
      mkdirSync(work);
      mkdirSync(temporary);
      cpSync(path.join(repository, '.markdownlint.json'), path.join(work, '.markdownlint.json'));
      writeFileSync(path.join(temporary, '.markdownlintrc'), '{"MD022":false}\n');
      writeFileSync(path.join(work, 'bad.md'), '# Heading\nBody\n');

      const result = runMarkdownlint(['--fix', 'bad.md'], {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: temporary }
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Cannot isolate markdownlint');
      expect(readFileSync(path.join(work, 'bad.md'), 'utf8')).toBe('# Heading\nBody\n');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
