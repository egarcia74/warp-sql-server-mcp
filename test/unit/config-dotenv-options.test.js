import fs from 'node:fs';
import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  applyFileEnvironment,
  loadDotenvQuiet,
  resolveEffectiveConfig
} from '../../lib/config/environment.js';
vi.unmock('dotenv');
let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'config-options-'));
  fs.writeFileSync(
    path.join(cwd, '.env'),
    'SQL_SERVER_HOST=default-host\nSQL_SERVER_PASSWORD=default-password\n'
  );
  fs.writeFileSync(
    path.join(cwd, 'alternate.env'),
    'SQL_SERVER_HOST=alternate-host\nSQL_SERVER_PASSWORD=alternate-password\n'
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(cwd, { recursive: true, force: true });
});
function legacy(inherited, fileValues) {
  const r = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../fixtures/config-dotenv-legacy.js', import.meta.url))],
    { env: inherited, cwd, input: JSON.stringify(fileValues), encoding: 'utf8', timeout: 3000 }
  );
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}
it.each([
  [{ DOTENV_PATH: 'alternate.env' }, {}, 'alternate-host'],
  [{ DOTENV_CONFIG_PATH: 'alternate.env' }, {}, 'alternate-host'],
  [{}, { DOTENV_PATH: 'alternate.env' }, 'alternate-host'],
  [{ DOTENV_CONFIG_PATH: 'alternate.env' }, { DOTENV_PATH: '.env' }, 'default-host'],
  [{ DOTENV_PATH: 'alternate.env' }, { DOTENV_PATH: '.env' }, 'alternate-host'],
  [{ DOTENV_PATH: '', DOTENV_CONFIG_PATH: 'alternate.env' }, {}, 'default-host'],
  [{}, { DOTENV_PATH: '~/alternate.env' }, 'alternate-host'],
  [{ SQL_SERVER_HOST: 'outside', DOTENV_OVERRIDE: 'true' }, {}, 'default-host'],
  [{}, { SQL_SERVER_HOST: 'saved', DOTENV_CONFIG_OVERRIDE: 'yes' }, 'default-host'],
  [{ DOTENV_CONFIG_OVERRIDE: 'yes', DOTENV_OVERRIDE: '' }, { SQL_SERVER_HOST: 'saved' }, 'saved']
])('matches legacy supported options and alias precedence %#', (env, fileValues, host) => {
  const inherited = { HOME: cwd, ...env };
  const old = legacy(inherited, fileValues);
  expect(old.environment.SQL_SERVER_HOST).toBe(host);
  const resolved = resolveEffectiveConfig({ inherited, fileValues, cwd });
  expect(resolved.environment.SQL_SERVER_HOST).toBe(host);
  expect(resolved.environment).toEqual(old.environment);
  const runtime = loadDotenvQuiet({
    environment: applyFileEnvironment(inherited, fileValues),
    cwd
  });
  expect(runtime.environment).toEqual(resolved.environment);
});
it('uses absolute selected paths and candidate latin1 encoding with fast parser', () => {
  fs.writeFileSync(
    path.join(cwd, 'latin.env'),
    Buffer.from('SQL_SERVER_HOST=caf\xe9-host\n', 'latin1')
  );
  const inherited = {
    DOTENV_PATH: path.join(cwd, 'latin.env'),
    DOTENV_CONFIG_ENCODING: 'latin1',
    DOTENV_CONFIG_FAST: 'true'
  };
  expect(legacy(inherited, {}).environment.SQL_SERVER_HOST).toBe('café-host');
  expect(
    resolveEffectiveConfig({ inherited, fileValues: {}, cwd }).environment.SQL_SERVER_HOST
  ).toBe('café-host');
});
it.each(['false', 'FALSE', '0', 'no', 'off', ''])('preserves false override token %j', token => {
  const inherited = {
    SQL_SERVER_HOST: 'outside',
    DOTENV_OVERRIDE: token,
    DOTENV_CONFIG_OVERRIDE: 'true'
  };
  expect(legacy(inherited, {}).environment.SQL_SERVER_HOST).toBe('outside');
  expect(
    resolveEffectiveConfig({ inherited, fileValues: {}, cwd }).environment.SQL_SERVER_HOST
  ).toBe('outside');
});
it('marks all dotenv writes as dotenv, including overriding identical bytes', () => {
  for (const initial of ['outside', 'default-host']) {
    const r = resolveEffectiveConfig({
      inherited: { SQL_SERVER_HOST: initial },
      fileValues: { DOTENV_OVERRIDE: 'true' },
      cwd
    });
    expect(r.environment.SQL_SERVER_HOST).toBe('default-host');
    expect(r.sources.SQL_SERVER_HOST).toBe('dotenv');
  }
});
it('isolates candidate options from conflicting ambient process.env', () => {
  vi.stubEnv('DOTENV_PATH', path.join(cwd, 'alternate.env'));
  vi.stubEnv('DOTENV_OVERRIDE', 'true');
  vi.stubEnv('DOTENV_ENCODING', 'does-not-exist');
  vi.stubEnv('DOTENV_FAST', 'true');
  const before = { ...process.env };
  const r = resolveEffectiveConfig({
    inherited: { SQL_SERVER_HOST: 'outside' },
    fileValues: {},
    cwd
  });
  expect(r.environment.SQL_SERVER_HOST).toBe('outside');
  expect(r.sources.SQL_SERVER_HOST).toBe('inherited');
  expect(process.env).toEqual(before);
});
it('does not recursively apply dotenv-loaded options or interpret comma paths or vault controls', () => {
  fs.writeFileSync(
    path.join(cwd, '.env'),
    'SQL_SERVER_HOST=first-host\nDOTENV_PATH=alternate.env\nDOTENV_OVERRIDE=true\n'
  );
  fs.writeFileSync(path.join(cwd, '.env.vault'), 'SQL_SERVER_HOST=vault-host\n');
  fs.writeFileSync(path.join(cwd, 'one.env,two.env'), 'SQL_SERVER_HOST=comma-filename-host\n');
  for (const [inherited, host] of [
    [{ DOTENV_KEY: 'ignored' }, 'first-host'],
    [{ DOTENV_PATH: 'one.env,two.env' }, 'comma-filename-host']
  ]) {
    expect(legacy(inherited, {}).environment.SQL_SERVER_HOST).toBe(host);
    expect(
      resolveEffectiveConfig({ inherited, fileValues: {}, cwd }).environment.SQL_SERVER_HOST
    ).toBe(host);
  }
});
it('allows selected missing files but rejects unreadable sources and invalid encodings safely', () => {
  expect(
    resolveEffectiveConfig({ inherited: { DOTENV_PATH: 'missing.env' }, fileValues: {}, cwd })
      .environment.SQL_SERVER_HOST
  ).toBeUndefined();
  expect(() =>
    resolveEffectiveConfig({
      inherited: { DOTENV_ENCODING: 'not-a-valid-encoding' },
      fileValues: {},
      cwd
    })
  ).toThrow('dotenv-unreadable');
  expect(() =>
    resolveEffectiveConfig({ inherited: { DOTENV_PATH: cwd }, fileValues: {}, cwd })
  ).toThrow('dotenv-unreadable');
});
it('uses Windows folded option aliases and records all unused parsed password aliases', () => {
  fs.writeFileSync(
    path.join(cwd, 'alternate.env'),
    'SQL_SERVER_HOST=alternate-host\nSQL_SERVER_PASSWORD=first-password\nsql_server_password=second-password\n'
  );
  const r = resolveEffectiveConfig({
    inherited: { dotenv_path: 'alternate.env', sql_server_password: 'outside' },
    fileValues: { dotenv_config_override: 'true' },
    cwd,
    platform: 'win32'
  });
  expect(r.environment.SQL_SERVER_HOST).toBe('alternate-host');
  expect(r.environment.SQL_SERVER_PASSWORD).toBe('second-password');
  expect(r.sources.SQL_SERVER_PASSWORD).toBe('dotenv');
  expect(r.passwordCandidates).toEqual(['first-password', 'second-password']);
});
it('preserves a present-empty home during tilde expansion without ambient-home leakage', () => {
  vi.stubEnv('HOME', path.join(cwd, 'ambient-home'));
  const inherited = { HOME: '', DOTENV_PATH: '~alternate.env' };
  expect(legacy(inherited, {}).environment.SQL_SERVER_HOST).toBe('alternate-host');
  expect(
    resolveEffectiveConfig({ inherited, fileValues: {}, cwd }).environment.SQL_SERVER_HOST
  ).toBe('alternate-host');
});
it('keeps dotenv quiet even when inherited and saved verbosity aliases request output', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const r = resolveEffectiveConfig({
      inherited: { DOTENV_DEBUG: 'true', DOTENV_QUIET: 'false' },
      fileValues: { DOTENV_CONFIG_DEBUG: 'true', DOTENV_CONFIG_QUIET: 'false' },
      cwd
    });
    expect(r.environment.SQL_SERVER_HOST).toBe('default-host');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
});

it.each(['DOTENV_FAST', 'DOTENV_CONFIG_FAST'])(
  'forwards candidate %s to the actual parser without ambient fallback',
  key => {
    const parse = vi.spyOn(dotenv, 'parse');
    try {
      resolveEffectiveConfig({ inherited: { [key]: 'yes' }, fileValues: {}, cwd });
      expect(parse).toHaveBeenCalled();
      expect(parse.mock.calls.at(-1)[1].fast).toBe(true);
    } finally {
      parse.mockRestore();
    }
  }
);
