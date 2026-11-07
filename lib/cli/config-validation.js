import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { getConfigPath, copyEnvironment, resolveEffectiveConfig } from '../config/environment.js';
import { CONFIG_FIELDS, checkStoredConfig, checkEffectiveConfig } from '../config/config-schema.js';
import { readConfigSnapshot } from '../config/config-store.js';
import { createConfigOutput } from './config-output.js';
export const VALIDATION_DEADLINE_MS = 60000,
  VALIDATION_GRACE_MS = 2000,
  VALIDATION_KILL_MS = 1000;
const WORKER = fileURLToPath(new URL('./config-validation-worker.js', import.meta.url));
const STARTUP = [
  'NODE_OPTIONS',
  'NODE_V8_COVERAGE',
  'LD_PRELOAD',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'LD_DEBUG_OUTPUT'
];
const CATEGORIES = [
  'ok',
  'configuration',
  'network',
  'tls',
  'authentication',
  'database-access',
  'query',
  'total-timeout',
  'cancelled',
  'cleanup',
  'runtime'
];
const STAGES = ['initializing', 'connecting', 'querying', 'closing', 'finished'];
const STATUSES = ['success', 'failure', 'cancelled'];
const CLEANUP = ['complete', 'failed', 'unconfirmed'];
export function unsupportedStartupVariables(environment, { platform = process.platform } = {}) {
  const e = copyEnvironment(environment, { platform });
  return STARTUP.filter(k => e[k]);
}
export function isProbeResult(r) {
  try {
    if (
      !r ||
      typeof r !== 'object' ||
      Array.isArray(r) ||
      Buffer.byteLength(JSON.stringify(r)) > 4096
    )
      return false;
    if (
      Object.keys(r).sort().join(',') !== 'attempts,category,cleanup,elapsedMs,stage,status,version'
    )
      return false;
    if (
      r.version !== 1 ||
      !STATUSES.includes(r.status) ||
      !CATEGORIES.includes(r.category) ||
      !STAGES.includes(r.stage) ||
      !CLEANUP.includes(r.cleanup)
    )
      return false;
    if (
      !Number.isInteger(r.elapsedMs) ||
      r.elapsedMs < 0 ||
      r.elapsedMs > 1_000_000 ||
      !Number.isInteger(r.attempts) ||
      r.attempts < 0 ||
      r.attempts > 10
    )
      return false;
    if (
      r.status === 'success' &&
      (r.category !== 'ok' || r.stage !== 'finished' || r.cleanup !== 'complete')
    )
      return false;
    if (r.status !== 'success' && r.category === 'ok') return false;
    return true;
  } catch {
    return false;
  }
}
const result = (
  category,
  elapsedMs = 0,
  cleanup = 'unconfirmed',
  stage = 'initializing',
  attempts = 0
) => ({
  version: 1,
  status: category === 'cancelled' ? 'cancelled' : 'failure',
  category,
  stage,
  elapsedMs: Math.min(1_000_000, Math.max(0, Math.floor(elapsedMs))),
  attempts,
  cleanup
});
export function runConfigValidation({
  resolved,
  signal,
  onProgress,
  spawnImpl = spawn,
  now = () => performance.now(),
  timers = { setTimeout, clearTimeout }
}) {
  const started = now();
  if (
    checkEffectiveConfig(resolved).errors.length ||
    unsupportedStartupVariables(resolved.environment).length
  )
    return Promise.resolve(result('configuration', 0, 'complete'));
  if (signal?.aborted) return Promise.resolve(result('cancelled', 0, 'complete'));
  return new Promise(resolve => {
    let child,
      provisional,
      reason,
      grace,
      hardStop,
      finished = false,
      killed = false,
      exited = false;
    const remove = () => {
      for (const t of [deadline, grace, hardStop]) if (t !== undefined) timers.clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      if (child) {
        child.removeListener('message', onMessage);
        child.removeListener('exit', onExit);
        child.removeListener(
          'disconnect',
          onDisconnect
        ); /* retain safe error listener for a late OS error */
      }
    };
    const finish = r => {
      if (finished) return;
      finished = true;
      remove();
      if (child && !exited && r.cleanup === 'unconfirmed') {
        // A failed kill is not confirmed cleanup. Release only this parent's references
        // so the advertised deadline also bounds the CLI host, not merely this promise.
        child.channel?.unref();
        try {
          if (child.connected) child.disconnect();
        } catch {
          /* retain the error listener for late disconnect/OS errors */
        }
        child.unref();
      }
      resolve(r);
    };
    const failed = (category, cleanup = 'unconfirmed') =>
      result(
        category,
        now() - started,
        cleanup,
        provisional?.stage || 'initializing',
        provisional?.attempts || 0
      );
    const kill = () => {
      if (killed || finished || exited) return;
      killed = true;
      if (grace !== undefined) timers.clearTimeout(grace);
      try {
        child?.kill('SIGKILL');
      } catch {
        /* exit still must be confirmed */
      }
      hardStop = timers.setTimeout(() => finish(failed(reason || 'runtime')), VALIDATION_KILL_MS);
    };
    const stop = category => {
      if (finished) return;
      if (category === 'total-timeout') reason = category;
      else if (!reason) reason = category;
      if (grace !== undefined || killed) {
        if (category === 'cancelled') kill();
        return;
      }
      try {
        if (child?.connected !== false) child?.send({ type: 'cancel' }, () => {});
      } catch {
        /* confirmation still required */
      }
      grace = timers.setTimeout(kill, VALIDATION_GRACE_MS);
    };
    function onAbort() {
      stop('cancelled');
    }
    function onMessage(message) {
      if (provisional || !isProbeResult(message)) {
        stop('runtime');
        return;
      }
      provisional = message;
    }
    function onExit(code, exitSignal) {
      exited = true;
      if (now() - started >= VALIDATION_DEADLINE_MS) reason = 'total-timeout';
      if (reason) {
        finish(
          failed(
            reason,
            provisional?.cleanup === 'failed'
              ? 'failed'
              : provisional?.cleanup === 'complete'
                ? 'complete'
                : 'unconfirmed'
          )
        );
        return;
      }
      if (code === 0 && !exitSignal && provisional) {
        finish(provisional);
        return;
      }
      finish(failed('runtime'));
    }
    function onDisconnect() {
      if (!provisional) stop('runtime');
    }
    const deadline = timers.setTimeout(() => stop('total-timeout'), VALIDATION_DEADLINE_MS);
    signal?.addEventListener('abort', onAbort);
    try {
      onProgress?.('initializing');
      child = spawnImpl(process.execPath, [WORKER], {
        env: copyEnvironment(resolved.environment),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        shell: false,
        windowsHide: true
      });
      child.on('message', onMessage);
      child.on('exit', onExit);
      child.on('disconnect', onDisconnect);
      child.on('error', () => stop('runtime'));
      child.send({ type: 'start' }, error => {
        if (error) stop('runtime');
      });
      if (signal?.aborted) stop('cancelled');
    } catch {
      if (!child) finish(failed('runtime', 'complete'));
      else stop('runtime');
    }
  });
}
export function reportProbe(output, probe) {
  const labels = {
    ok: 'Connection probe succeeded (SELECT 1 only).',
    configuration: 'Local configuration failed.',
    network: 'DNS, network or connection timeout failure.',
    tls: 'TLS certificate validation failed. TLS settings were not changed.',
    authentication: 'SQL authentication failed.',
    'database-access': 'The configured database is unavailable or inaccessible.',
    query: 'The fixed query failed.',
    'total-timeout': 'Validation exceeded its 60-second deadline.',
    cancelled: 'Validation cancelled.',
    cleanup: 'Connection cleanup failed.',
    runtime: 'Validation worker failed.'
  };
  output.line(labels[probe.category]);
  if (probe.cleanup === 'failed' && probe.category !== 'cleanup')
    output.line('Connection cleanup failed.');
  if (probe.cleanup === 'unconfirmed')
    output.line('Worker termination or cleanup could not be confirmed.');
}
export async function validateConfigCommand({
  cwd = process.cwd(),
  inherited = { ...process.env },
  output = createConfigOutput(),
  signal
} = {}) {
  try {
    output.addSecrets(inherited);
    const snapshot = await readConfigSnapshot(getConfigPath(inherited));
    output.addSecrets(snapshot.values);
    const stored = checkStoredConfig(snapshot.values);
    output.checks(stored);
    if (stored.errors.length) return 2;
    const resolved = resolveEffectiveConfig({ inherited, fileValues: snapshot.values, cwd });
    output.addSecrets(resolved.environment, resolved.passwordCandidates);
    const effective = checkEffectiveConfig(resolved);
    output.checks(effective);
    if (effective.errors.length) return 2;
    const unsupported = unsupportedStartupVariables(resolved.environment);
    if (unsupported.length) {
      output.line(
        'Validation requires a shell without these startup variables: ' + unsupported.join(', ')
      );
      return 2;
    }
    for (const field of ['SQL_SERVER_HOST', 'SQL_SERVER_DATABASE', 'SQL_SERVER_USER'])
      output.field(
        field,
        resolved.environment[field] || CONFIG_FIELDS[field].defaultValue,
        resolved.sources[field] || 'default'
      );
    const probe = await runConfigValidation({ resolved, signal });
    reportProbe(output, probe);
    if (signal?.aborted) return signal.reason === 'SIGTERM' ? 143 : 130;
    return probe.status === 'success'
      ? 0
      : probe.category === 'configuration'
        ? 2
        : probe.category === 'cancelled'
          ? 130
          : 1;
  } catch (e) {
    output.error(e);
    return signal?.aborted ? (signal.reason === 'SIGTERM' ? 143 : 130) : 2;
  }
}
