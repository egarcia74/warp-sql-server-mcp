import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'node:path';

import { resolveTestFile } from '../../scripts/ci/run-one-test.mjs';

// The point of scripts/ci/run-one-test.mjs is that the Claude review Action can
// be granted `Bash(npm run test:one:*)` without that being arbitrary code
// execution. vitest executes whatever --config, --setupFiles and --globalSetup
// name, so these tests pin the refusals, not just the happy path.
describe('resolveTestFile (guard for npm run test:one, #1213)', () => {
  const root = resolve(process.cwd(), 'test');
  const opts = { root, exists: () => true, isFile: () => true };

  it('accepts an existing test file inside test/', () => {
    const result = resolveTestFile(['test/unit/example.test.js'], opts);
    expect(result.ok).toBe(true);
    expect(result.file).toBe(resolve(root, 'unit/example.test.js'));
  });

  it.each([
    ['--globalSetup=/tmp/evil.mjs'],
    ['--setupFiles=/tmp/evil.mjs'],
    ['--config=/tmp/evil.config.js'],
    ['--reporter=/tmp/evil.mjs'],
    ['-c']
  ])('refuses the option-shaped argument %s', argument => {
    const result = resolveTestFile([argument], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/option-shaped/);
  });

  it('refuses a flag even when a legitimate file is also given', () => {
    const result = resolveTestFile(
      ['test/unit/example.test.js', '--globalSetup=/tmp/evil.mjs'],
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exactly one test file/);
  });

  it('refuses zero arguments', () => {
    expect(resolveTestFile([], opts)).toMatchObject({ ok: false });
  });

  it.each([
    ['test/../../../etc/passwd.test.js'],
    ['../outside/thing.test.js'],
    ['/etc/passwd.test.js']
  ])('refuses %s, which resolves outside test/', argument => {
    const result = resolveTestFile([argument], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/outside/);
  });

  it('refuses a file that is not a .test.js', () => {
    const result = resolveTestFile(['test/unit/helper.js'], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not a test file/);
  });

  it('refuses a null byte', () => {
    const result = resolveTestFile(['test/unit/a\0b.test.js'], opts);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/null byte/);
  });

  it('refuses a path that passes every shape check but does not exist', () => {
    const result = resolveTestFile(['test/unit/missing.test.js'], { ...opts, exists: () => false });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no such test file/);
  });

  it('refuses a directory that is named like a test file', () => {
    const result = resolveTestFile(['test/unit/dir.test.js'], { ...opts, isFile: () => false });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no such test file/);
  });

  it('containment is checked on the resolved path, not the raw string', () => {
    const sneaky = `unit${sep}..${sep}..${sep}package.json.test.js`;
    const result = resolveTestFile([`test/${sneaky}`], opts);
    expect(result.ok).toBe(false);
  });
});
