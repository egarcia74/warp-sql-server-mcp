import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFileEnvironment,
  getConfigPath,
  resolveEffectiveConfig
} from '../../lib/config/environment.js';
vi.unmock('dotenv');
const dirs = [];
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));
function cwd(text) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'config-env-'));
  dirs.push(d);
  fs.writeFileSync(path.join(d, '.env'), text);
  return d;
}
describe('isolated configuration resolution', () => {
  it.each([
    [{ K: '' }, { K: 'saved' }, 'saved', 'file'],
    [{ K: '' }, {}, '', 'inherited'],
    [{}, {}, 'dotenv', 'dotenv'],
    [{ K: 'inherited' }, { K: 'saved' }, 'inherited', 'inherited'],
    [{}, { K: false }, 'false', 'file'],
    [{}, { K: 3 }, '3', 'file']
  ])('resolves precedence %#', (inherited, fileValues, want, source) => {
    const prior = { ...inherited };
    const result = resolveEffectiveConfig({ inherited, fileValues, cwd: cwd('K=dotenv\n') });
    expect(result.environment.K).toBe(want);
    expect(result.sources.K).toBe(source);
    expect(inherited).toEqual(prior);
    expect(Object.getPrototypeOf(result.environment)).toBe(null);
  });
  it('reveals dotenv after removal without persisting inherited credentials', () => {
    const draft = { SQL_SERVER_USER: 'saved' };
    const r = resolveEffectiveConfig({
      inherited: { SQL_SERVER_USER: 'external' },
      fileValues: draft,
      cwd: cwd('SQL_SERVER_PASSWORD=synthetic\n')
    });
    expect(r.sources.SQL_SERVER_PASSWORD).toBe('dotenv');
    expect(draft).toEqual({ SQL_SERVER_USER: 'saved' });
  });
  it('preserves ordered permissive overlay conversions including prototype names', () => {
    const values = JSON.parse('{"__proto__":"safe","K":null,"V":{"x":1}}');
    const e = applyFileEnvironment({}, values);
    expect(e.__proto__).toBe('safe');
    expect(e.K).toBe('null');
    expect(e.V).toBe('[object Object]');
  });
  it('uses Windows lookup and one uppercase environment key', () => {
    const r = resolveEffectiveConfig({
      inherited: { home: 'C:/test', sql_server_host: 'outside', Sql_Server_Password: 'outside' },
      fileValues: { SQL_SERVER_HOST: 'saved' },
      cwd: cwd('sql_server_host=dotenv\nOTHER=first\nother=last\n'),
      platform: 'win32'
    });
    expect(r.environment.SQL_SERVER_HOST).toBe('outside');
    expect(r.environment.SQL_SERVER_PASSWORD).toBe('outside');
    expect(r.environment.OTHER).toBe('first');
    expect(Object.keys(r.environment).filter(k => k.toUpperCase() === 'SQL_SERVER_HOST')).toEqual([
      'SQL_SERVER_HOST'
    ]);
    expect(r.sources.SQL_SERVER_PASSWORD).toBe('inherited');
    expect(getConfigPath({ home: 'C:/test' }, { platform: 'win32' })).toBe(
      path.join('C:/test', '.warp-sql-server-mcp.json')
    );
  });
  it('rejects duplicate case entries only in strict Windows resolution', () => {
    expect(() =>
      resolveEffectiveConfig({
        inherited: { K: 'a', k: 'b' },
        fileValues: {},
        cwd: cwd(''),
        platform: 'win32'
      })
    ).toThrowError(/duplicate-environment-key/);
    expect(() =>
      resolveEffectiveConfig({
        inherited: {},
        fileValues: { K: 'a', k: 'b' },
        cwd: cwd(''),
        platform: 'win32'
      })
    ).toThrowError(/duplicate-file-key/);
    expect(applyFileEnvironment({}, { K: '', k: 'second' }, { platform: 'win32' }).K).toBe(
      'second'
    );
    expect(
      applyFileEnvironment({ K: 'upper' }, { k: 'lower' }, { platform: 'darwin' })
    ).toMatchObject({ K: 'upper', k: 'lower' });
  });
  it('never falls back to cwd for missing home', () =>
    expect(() => getConfigPath({})).toThrowError(/missing-home/));
});
