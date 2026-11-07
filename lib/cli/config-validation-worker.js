/** Packaged, fixed-query worker. Never import index/Logger or reload source configuration. */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { classifyValidationError } from './config-validation-errors.js';

export async function runWorkerProbe({ signal, now = () => performance.now() } = {}) {
  const started = now();
  let manager,
    request,
    stage = 'initializing',
    category = 'ok',
    status = 'success',
    cleanup = 'complete';
  const cancel = () => {
    try {
      request?.cancel();
    } catch {
      /* final cleanup still required */
    }
  };
  const check = () => {
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' });
  };
  signal?.addEventListener('abort', cancel);
  try {
    check();
    const [{ ServerConfig }, { ConnectionManager }] = await Promise.all([
      import('../config/server-config.js'),
      import('../database/connection-manager.js')
    ]);
    check();
    const config = new ServerConfig();
    manager = new ConnectionManager({ serverConfig: config });
    stage = 'connecting';
    const pool = await manager.connect({ signal });
    check();
    stage = 'querying';
    request = pool.request();
    check();
    const result = await request.query('SELECT 1 AS mcp_ok');
    check();
    if (result?.recordset?.length !== 1 || result.recordset[0]?.mcp_ok !== 1)
      throw new Error('probe-result');
  } catch (e) {
    category = classifyValidationError(e, { stage });
    status = category === 'cancelled' ? 'cancelled' : 'failure';
    if (e?.cleanupFailed) cleanup = 'failed';
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (manager) {
      const prior = stage;
      stage = 'closing';
      try {
        await manager.close({ throwOnError: true });
      } catch {
        category = 'cleanup';
        status = 'failure';
        cleanup = 'failed';
      }
      if (status !== 'success') stage = prior;
    }
  }
  if (signal?.aborted && status === 'success') {
    category = 'cancelled';
    status = 'cancelled';
  }
  if (status === 'success') stage = 'finished';
  return {
    version: 1,
    status,
    category,
    stage,
    elapsedMs: Math.min(1_000_000, Math.max(0, Math.floor(now() - started))),
    attempts: Math.min(10, manager?.connectionAttempts || 0),
    cleanup
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.send) {
  const controller = new globalThis.AbortController();
  let started = false;
  const cancel = () => controller.abort();
  process.on('disconnect', cancel);
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  process.on('message', message => {
    if (message && Object.keys(message).length === 1 && message.type === 'cancel') {
      cancel();
      return;
    }
    if (started || !message || message.type !== 'start' || Object.keys(message).length !== 1) {
      cancel();
      process.exitCode = 1;
      return;
    }
    started = true;
    void runWorkerProbe({ signal: controller.signal })
      .then(result => {
        if (!process.connected) return;
        process.send(result, () => {
          process.disconnect();
        });
      })
      .catch(() => {
        process.exitCode = 1;
        if (process.connected) process.disconnect();
      });
  });
}
