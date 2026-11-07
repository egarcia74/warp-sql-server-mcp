import { environmentKey, copyEnvironment } from './environment.js';
const string = (defaultValue, nonempty = false) => ({ type: 'string', defaultValue, nonempty });
const integer = (min, max, defaultValue) => ({ type: 'integer', min, max, defaultValue });
const boolean = defaultValue => ({ type: 'boolean', defaultValue });
export const CONFIG_FIELDS = Object.freeze({
  SQL_SERVER_HOST: string('localhost', true),
  SQL_SERVER_PORT: integer(1, 65535, '1433'),
  SQL_SERVER_DATABASE: string('master', true),
  SQL_SERVER_USER: string(undefined),
  SQL_SERVER_PASSWORD: string(undefined),
  SQL_SERVER_DOMAIN: string(''),
  SQL_SERVER_ENCRYPT: boolean('true'),
  SQL_SERVER_TRUST_CERT: boolean(undefined),
  SQL_SERVER_READ_ONLY: boolean('true'),
  SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: boolean('false'),
  SQL_SERVER_ALLOW_SCHEMA_CHANGES: boolean('false'),
  SQL_SERVER_DEBUG: boolean('false'),
  SQL_SERVER_CONNECT_TIMEOUT_MS: integer(1000, 60000, '10000'),
  SQL_SERVER_REQUEST_TIMEOUT_MS: integer(5000, 300000, '30000'),
  SQL_SERVER_MAX_RETRIES: integer(1, 10, '3'),
  SQL_SERVER_RETRY_DELAY_MS: integer(100, 10000, '1000'),
  SQL_SERVER_POOL_MAX: integer(1, 100, '10'),
  SQL_SERVER_POOL_MIN: integer(0, 50, '0'),
  SQL_SERVER_POOL_IDLE_TIMEOUT_MS: integer(1000, 300000, '30000'),
  ENABLE_PERFORMANCE_MONITORING: boolean('true'),
  MAX_METRICS_HISTORY: integer(100, 10000, '1000'),
  SLOW_QUERY_THRESHOLD: integer(100, 60000, '5000'),
  TRACK_POOL_METRICS: boolean('true'),
  PERFORMANCE_SAMPLING_RATE: { type: 'decimal', min: 0, max: 1, defaultValue: '1.0' },
  ENABLE_STREAMING: boolean('true'),
  STREAMING_BATCH_SIZE: integer(100, 50000, '1000'),
  ENABLE_SECURITY_AUDIT: boolean('false'),
  SQL_SERVER_LOG_LEVEL: string('info')
});
export const EXPOSED_FIELDS = Object.keys(CONFIG_FIELDS)
  .slice(0, 19)
  .filter(k => k !== 'SQL_SERVER_DEBUG');
export function isValidValue(field, value) {
  const rule = CONFIG_FIELDS[field];
  if (!rule) return true;
  if (rule.type === 'string')
    return typeof value === 'string' && (!rule.nonempty || value.length > 0);
  if (rule.type === 'boolean')
    return typeof value === 'boolean' || value === 'true' || value === 'false';
  const numeric =
    typeof value === 'number'
      ? Number.isFinite(value)
      : typeof value === 'string' &&
        (rule.type === 'integer' ? /^\d+$/.test(value) : /^\d+(?:\.\d+)?$/.test(value));
  return (
    !!numeric &&
    (rule.type !== 'integer' || Number.isInteger(Number(value))) &&
    Number(value) >= rule.min &&
    Number(value) <= rule.max
  );
}
const entry = (code, field, source) => ({
  code,
  ...(field ? { field } : {}),
  ...(source ? { source } : {}),
  messageId: code
});
function checkValues(values, source, platform) {
  const errors = [];
  const canonical = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    const field = environmentKey(key, platform);
    if (Object.hasOwn(canonical, field)) errors.push(entry('duplicate-file-key'));
    canonical[field] = value;
    if (Object.hasOwn(CONFIG_FIELDS, field) && !isValidValue(field, value))
      errors.push(
        entry('invalid-value', field, typeof source === 'string' ? source : source[field])
      );
  }
  return { errors, canonical };
}
export function checkStoredConfig(values, { platform = process.platform } = {}) {
  const { errors, canonical } = checkValues(values, 'file', platform);
  if (
    Object.hasOwn(canonical, 'SQL_SERVER_POOL_MIN') &&
    Object.hasOwn(canonical, 'SQL_SERVER_POOL_MAX') &&
    Number(canonical.SQL_SERVER_POOL_MIN) > Number(canonical.SQL_SERVER_POOL_MAX)
  )
    errors.push(entry('pool-range', 'SQL_SERVER_POOL_MIN', 'file'));
  return { errors, warnings: [] };
}
export function securityState(resolved) {
  const e = resolved.environment;
  const host = e.SQL_SERVER_HOST || 'localhost';
  const dev =
    e.NODE_ENV === 'development' ||
    e.NODE_ENV === 'test' ||
    host === 'localhost' ||
    host === '127.0.0.1';
  return {
    encrypt: e.SQL_SERVER_ENCRYPT !== 'false',
    trust: e.SQL_SERVER_TRUST_CERT === 'true' || (e.SQL_SERVER_TRUST_CERT !== 'false' && dev),
    readOnly: e.SQL_SERVER_READ_ONLY !== 'false',
    destructive: e.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS === 'true',
    schema: e.SQL_SERVER_ALLOW_SCHEMA_CHANGES === 'true'
  };
}
export function checkEffectiveConfig(resolved, { platform = process.platform } = {}) {
  const environment = copyEnvironment(resolved.environment, { platform });
  const { errors } = checkValues(environment, resolved.sources, platform);
  const warnings = [];
  if (!!environment.SQL_SERVER_USER !== !!environment.SQL_SERVER_PASSWORD)
    errors.push(entry('partial-credentials'));
  if (!environment.SQL_SERVER_USER && !environment.SQL_SERVER_PASSWORD)
    warnings.push(entry('legacy-auth'));
  if (Number(environment.SQL_SERVER_POOL_MIN || 0) > Number(environment.SQL_SERVER_POOL_MAX || 10))
    errors.push(
      entry('pool-range', 'SQL_SERVER_POOL_MIN', resolved.sources.SQL_SERVER_POOL_MIN || 'default')
    );
  const s = securityState({ environment });
  if (!s.encrypt) warnings.push(entry('unencrypted'));
  if (s.trust) warnings.push(entry('trust-certificate'));
  if (!s.readOnly) warnings.push(entry('read-write'));
  if (s.destructive) warnings.push(entry(s.readOnly ? 'dormant-destructive' : 'destructive'));
  if (s.schema) warnings.push(entry(s.readOnly ? 'dormant-schema' : 'schema'));
  return { errors, warnings };
}
export function assessSecurityChanges(before, after) {
  const a = securityState(before),
    b = securityState(after),
    warnings = [];
  if (a.encrypt && !b.encrypt) warnings.push('unencrypted');
  if (!a.trust && b.trust) warnings.push('trust-certificate');
  if (a.readOnly && !b.readOnly) warnings.push('read-write');
  for (const flag of ['destructive', 'schema']) {
    if ((!a[flag] && b[flag]) || (a.readOnly && !b.readOnly && b[flag]))
      warnings.push(b.readOnly ? `dormant-${flag}` : flag);
  }
  return warnings;
}
