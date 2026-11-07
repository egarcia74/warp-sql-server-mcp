import { describe, expect, it } from 'vitest';
import {
  CONFIG_FIELDS,
  checkStoredConfig,
  checkEffectiveConfig,
  assessSecurityChanges
} from '../../lib/config/config-schema.js';
const resolved = e => ({
  environment: e,
  sources: Object.fromEntries(Object.keys(e).map(k => [k, 'inherited']))
});
describe('strict local configuration checks', () => {
  for (const [field, min, max] of [
    ['SQL_SERVER_PORT', 1, 65535],
    ['SQL_SERVER_CONNECT_TIMEOUT_MS', 1000, 60000],
    ['SQL_SERVER_REQUEST_TIMEOUT_MS', 5000, 300000],
    ['SQL_SERVER_MAX_RETRIES', 1, 10],
    ['SQL_SERVER_RETRY_DELAY_MS', 100, 10000],
    ['SQL_SERVER_POOL_MAX', 1, 100],
    ['SQL_SERVER_POOL_MIN', 0, 50],
    ['SQL_SERVER_POOL_IDLE_TIMEOUT_MS', 1000, 300000],
    ['MAX_METRICS_HISTORY', 100, 10000],
    ['SLOW_QUERY_THRESHOLD', 100, 60000],
    ['STREAMING_BATCH_SIZE', 100, 50000]
  ]) {
    it(`validates all boundaries/types for ${field}`, () => {
      for (const value of [min, max, String(min), String(max)])
        expect(checkStoredConfig({ [field]: value }).errors).toEqual([]);
      for (const value of [
        min - 1,
        max + 1,
        '2x',
        '0x10',
        '1e3',
        '+1',
        ' 1',
        '1 ',
        1.5,
        {},
        null,
        true
      ])
        expect(checkStoredConfig({ [field]: value }).errors.length).toBeGreaterThan(0);
    });
  }
  it('checks hidden settings and types even when effective overrides are valid', () => {
    for (const field of Object.keys(CONFIG_FIELDS).filter(
      k => CONFIG_FIELDS[k].type === 'boolean'
    )) {
      for (const value of ['true', 'false', true, false])
        expect(checkStoredConfig({ [field]: value }).errors).toEqual([]);
      for (const value of ['TRUE', '', 1, null])
        expect(checkStoredConfig({ [field]: value }).errors.length).toBe(1);
    }
    for (const v of ['0', '1.0', 0.5])
      expect(checkStoredConfig({ PERFORMANCE_SAMPLING_RATE: v }).errors).toEqual([]);
    for (const v of ['.5x', '1e0', ' 0.2', -0.1, 1.1])
      expect(checkStoredConfig({ PERFORMANCE_SAMPLING_RATE: v }).errors.length).toBe(1);
    expect(checkStoredConfig({ SQL_SERVER_HOST: '' }).errors.length).toBe(1);
    expect(checkStoredConfig({ SQL_SERVER_USER: '' }).errors).toEqual([]);
    expect(checkStoredConfig({ SQL_SERVER_PORT: 'bad' }).errors.length).toBe(1);
    expect(checkEffectiveConfig(resolved({ SQL_SERVER_PORT: '1433' })).errors).toEqual([]);
  });
  it('allows stored partial credentials but rejects an effective partial pair', () => {
    expect(checkStoredConfig({ SQL_SERVER_USER: 'u' }).errors).toEqual([]);
    expect(checkEffectiveConfig(resolved({ SQL_SERVER_USER: 'u' })).errors[0].code).toBe(
      'partial-credentials'
    );
    expect(
      checkEffectiveConfig(resolved({ SQL_SERVER_USER: 'u', SQL_SERVER_PASSWORD: 'p' })).errors
    ).toEqual([]);
  });
  it('checks pool relationships and Windows duplicate fields', () => {
    expect(
      checkStoredConfig({ SQL_SERVER_POOL_MIN: '20', SQL_SERVER_POOL_MAX: '10' }).errors.length
    ).toBe(1);
    expect(checkEffectiveConfig(resolved({ SQL_SERVER_POOL_MIN: '20' })).errors.length).toBe(1);
    expect(
      checkStoredConfig({ SQL_SERVER_HOST: 'a', sql_server_host: 'b' }, { platform: 'win32' })
        .errors[0].code
    ).toBe('duplicate-file-key');
  });
  it.each(Array.from({ length: 8 }, (_, i) => [!!(i & 4), !!(i & 2), !!(i & 1)]))(
    'represents safety RO=%s DML=%s DDL=%s',
    (ro, dml, ddl) => {
      const r = checkEffectiveConfig(
        resolved({
          SQL_SERVER_READ_ONLY: String(ro),
          SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: String(dml),
          SQL_SERVER_ALLOW_SCHEMA_CHANGES: String(ddl)
        })
      );
      expect(r.errors).toEqual([]);
      const codes = r.warnings.map(w => w.code);
      expect(codes.includes(ro ? 'dormant-destructive' : 'destructive')).toBe(dml);
      expect(codes.includes(ro ? 'dormant-schema' : 'schema')).toBe(ddl);
    }
  );
  it('detects host-only contextual TLS reduction and activation of dormant flags', () => {
    const before = resolved({ SQL_SERVER_HOST: 'production', NODE_ENV: 'production' });
    expect(
      assessSecurityChanges(
        before,
        resolved({ SQL_SERVER_HOST: 'localhost', NODE_ENV: 'production' })
      )
    ).toContain('trust-certificate');
    expect(
      assessSecurityChanges(
        resolved({ SQL_SERVER_READ_ONLY: 'true', SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true' }),
        resolved({ SQL_SERVER_READ_ONLY: 'false', SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true' })
      )
    ).toContain('schema');
  });
});
