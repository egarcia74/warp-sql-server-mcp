import { stripVTControlCharacters } from 'node:util';
import { CONFIG_FIELDS, EXPOSED_FIELDS, securityState } from '../config/config-schema.js';
export const MASK = '********';
export const MESSAGES = Object.freeze({
  'invalid-value': 'Invalid field type or value; use the documented range and exact syntax.',
  'partial-credentials': 'Effective SQL username and password must both be present or both absent.',
  'pool-range': 'Pool minimum must not exceed pool maximum.',
  'legacy-auth':
    'Legacy NTLM branch: the default Tedious driver does not provide trusted current-Windows-login authentication; only a domain is passed.',
  unencrypted: 'Encryption is disabled.',
  'trust-certificate': 'Certificate verification is disabled by effective certificate trust.',
  'read-write': 'Read-only protection is disabled.',
  destructive: 'Data modification is enabled.',
  schema: 'Schema changes are enabled independently of data modification.',
  'dormant-destructive':
    'Data modification permission is dormant under read-only mode; leaving read-only mode activates it.',
  'dormant-schema':
    'Schema permission is dormant under read-only mode; leaving read-only mode activates it.',
  'missing-home': 'HOME or USERPROFILE is required.',
  'duplicate-file-key': 'Saved keys collide on this platform.',
  'duplicate-environment-key': 'Inherited environment keys collide on this platform.',
  'dotenv-unreadable': 'The selected dotenv source or encoding cannot be read.',
  'invalid-json': 'Configuration must contain a valid JSON object.',
  'unsafe-file': 'Unsafe configuration target or home directory. No file was changed.',
  'file-error': 'Cannot access or save the configuration file.',
  conflict: 'Configuration changed since opening. Reload or cancel.',
  'lock-busy':
    'Another save owns the configuration lock. If stale, confirm no editor is running before removing the sibling lock directory.',
  cancelled: 'Cancelled.',
  runtime: 'The operation failed.',
  'non-tty': 'Configuration editing requires interactive stdin and stdout terminals.',
  usage: 'Usage: config edit | config validate. No additional arguments are accepted.',
  'unsupported-environment': 'Validation requires a shell without these startup variables:',
  'directory-sync': 'Saved, but directory durability could not be confirmed.',
  'temporary-cleanup': 'Saved, but an owned temporary file could not be removed.',
  'lock-cleanup': 'Saved, but the owned lock could not be removed.',
  'lock-cleanup-uncertain':
    'Lock cleanup could not be confirmed. Confirm no editor is running before manually removing the sibling lock directory.'
});
// One projection keeps Review and individual field screens consistent with runtime defaults.
function fieldState(key, draft, resolved) {
  const saved = Object.keys(draft).find(
    k => k === key || (process.platform === 'win32' && k.toUpperCase() === key)
  );
  let effective = resolved.environment[key] ?? CONFIG_FIELDS[key].defaultValue;
  let source = resolved.sources[key] || 'default';
  let emptyDefault = false;
  if (key === 'SQL_SERVER_TRUST_CERT' && resolved.environment[key] === undefined) {
    effective = String(securityState(resolved).trust);
    source = 'contextual default';
  } else if (
    effective === '' &&
    CONFIG_FIELDS[key].defaultValue &&
    (CONFIG_FIELDS[key].type === 'integer' ||
      ['SQL_SERVER_HOST', 'SQL_SERVER_DATABASE'].includes(key))
  ) {
    effective = CONFIG_FIELDS[key].defaultValue;
    source += '; explicit empty uses runtime default';
    emptyDefault = true;
  }
  return { saved: saved === undefined ? undefined : draft[saved], effective, source, emptyDefault };
}
function fieldSource(key, state, resolved) {
  const origin = resolved.sources[key];
  let source;
  if (origin === 'inherited') source = 'inherited environment variable ' + key;
  else if (origin === 'file') source = 'file value (draft)';
  else if (origin === 'dotenv')
    source = `dotenv file ${resolved.dotenv.path} (override ${resolved.dotenv.override ? 'enabled' : 'disabled'})`;
  else if (state.effective === undefined) source = 'not set';
  else source = state.source === 'contextual default' ? state.source : 'built-in default';
  return source + (state.emptyDefault ? '; explicit empty uses runtime default' : '');
}
function fieldValue(key, value) {
  if (value === undefined) return '(not set)';
  if (value === '') return '(explicit empty)';
  return key === 'SQL_SERVER_PASSWORD' ? MASK : value;
}
export function createConfigOutput({
  stdout = process.stdout,
  stderr = process.stderr,
  secrets = []
} = {}) {
  const known = new Set(secrets.filter(s => typeof s === 'string' && s.length));
  const addSecrets = (values, candidates = []) => {
    for (const value of candidates) if (typeof value === 'string' && value) known.add(value);
    for (const [k, v] of Object.entries(values || {}))
      if (k.toUpperCase() === 'SQL_SERVER_PASSWORD' && typeof v === 'string' && v) known.add(v);
  };
  const stripControls = value =>
    [...stripVTControlCharacters(value)]
      .filter(c => {
        const n = c.codePointAt(0);
        return (
          n >= 32 &&
          !(n >= 127 && n <= 159) &&
          !(n >= 0x202a && n <= 0x202e) &&
          !(n >= 0x2066 && n <= 0x2069)
        );
      })
      .join('');
  const redact = (value, candidates) => {
    for (const secret of [...candidates].filter(Boolean).sort((a, b) => b.length - a.length))
      value = value.split(secret).join(MASK);
    return value;
  };
  const safe = value => {
    // Control removal can assemble a secret absent from the raw display string.
    // Register its printable form too, without normalizing stored/authentication bytes.
    const sanitized = new Set([...known].map(stripControls));
    return redact(stripControls(redact(String(value ?? ''), known)), sanitized).slice(0, 1000);
  };
  const line = s => stdout.write(safe(s) + '\n');
  const field = (key, value, source = 'file') =>
    line(
      `${key}: ${key.toUpperCase() === 'SQL_SERVER_PASSWORD' ? (value ? MASK : '(empty)') : value === '' ? '(explicit empty; runtime may use its default)' : (value ?? '(absent)')} [${source}]`
    );
  const error = e => {
    stderr.write(safe(MESSAGES[e?.code] || MESSAGES.runtime) + '\n');
    if (Array.isArray(e?.warningCodes) && e.warningCodes.includes('lock-cleanup-uncertain'))
      stderr.write(safe(MESSAGES['lock-cleanup-uncertain']) + '\n');
  };
  const checks = result => {
    for (const e of [...result.errors, ...result.warnings])
      line(
        `${e.field && Object.hasOwn(CONFIG_FIELDS, e.field) ? e.field + ': ' : ''}${MESSAGES[e.code] || MESSAGES.runtime}${e.source ? ' [' + e.source + ']' : ''}`
      );
  };
  const review = (draft, resolved) => {
    addSecrets(draft);
    addSecrets(resolved.environment, resolved.passwordCandidates);
    for (const key of EXPOSED_FIELDS) {
      const state = fieldState(key, draft, resolved);
      field(key, state.saved, 'draft');
      field(key, state.effective, state.source);
    }
    line(
      `${Object.keys(draft).filter(k => !EXPOSED_FIELDS.includes(process.platform === 'win32' ? k.toUpperCase() : k)).length} unexposed settings preserved.`
    );
  };
  const fieldReview = (key, draft, resolved) => {
    addSecrets(draft);
    addSecrets(resolved.environment, resolved.passwordCandidates);
    const state = fieldState(key, draft, resolved);
    line(key);
    line('File value (draft): ' + fieldValue(key, state.saved));
    line('Effective here: ' + fieldValue(key, state.effective));
    line('Source: ' + fieldSource(key, state, resolved));
    const origin = resolved.sources[key];
    const blocksFile =
      (origin === 'inherited' && resolved.environment[key] !== '') ||
      (origin === 'dotenv' && resolved.dotenv.override);
    if (blocksFile)
      line(
        'Changing the file value will not change the effective value here while this override is present.'
      );
    else if (origin === 'inherited' || origin === 'dotenv')
      line('Setting a file value can replace this fallback.');
  };
  return { line, field, fieldReview, error, checks, review, safe, addSecrets };
}
