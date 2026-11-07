import { afterEach, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { runWorkerProbe } from '../../lib/cli/config-validation-worker.js';
let saved;
function configure() {
  saved = { ...process.env };
  process.env.SQL_SERVER_USER = 'u';
  process.env.SQL_SERVER_PASSWORD = 'test-secret-1559';
  process.env.SQL_SERVER_MAX_RETRIES = '1';
}
afterEach(() => {
  if (saved) {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  vi.clearAllMocks();
});
it('uses real manager and fixed query with strict cleanup before success', async () => {
  configure();
  const query = vi.fn().mockResolvedValue({ recordset: [{ mcp_ok: 1 }] });
  const close = vi.fn().mockResolvedValue();
  sql.connect.mockResolvedValue({ connected: true, request: () => ({ query }), close });
  const result = await runWorkerProbe();
  expect(query).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS mcp_ok');
  expect(close).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    status: 'success',
    category: 'ok',
    cleanup: 'complete',
    attempts: 1
  });
  expect(JSON.stringify(result)).not.toContain('test-secret-1559');
});
it.each(['close', 'query', 'result'])('does not claim success on %s failure', async failure => {
  configure();
  const close = vi.fn(
    failure === 'close'
      ? () => Promise.reject(new Error('test-secret-1559'))
      : () => Promise.resolve()
  );
  const query = vi.fn(
    failure === 'query'
      ? () => Promise.reject(new Error('test-secret-1559'))
      : () => Promise.resolve({ recordset: [{ mcp_ok: failure === 'result' ? 0 : 1 }] })
  );
  sql.connect.mockResolvedValue({ connected: true, request: () => ({ query }), close });
  const result = await runWorkerProbe();
  expect(result.status).toBe('failure');
  expect(result.category).toBe(failure === 'close' ? 'cleanup' : 'query');
  expect(close).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain('test-secret-1559');
});
it('cancels a pending request and never reports success', async () => {
  configure();
  const controller = new globalThis.AbortController();
  let finish;
  const cancel = vi.fn(() => finish({ recordset: [{ mcp_ok: 1 }] }));
  const query = vi.fn(
    () =>
      new Promise(r => {
        finish = r;
      })
  );
  sql.connect.mockResolvedValue({
    connected: true,
    request: () => ({ query, cancel }),
    close: () => Promise.resolve()
  });
  const p = runWorkerProbe({ signal: controller.signal });
  await vi.waitFor(() => expect(query).toHaveBeenCalled());
  controller.abort();
  expect((await p).category).toBe('cancelled');
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('cancellation during successful strict close cannot become success', async () => {
  configure();
  const controller = new globalThis.AbortController();
  let finishClose;
  const close = vi.fn(() => new Promise(resolve => (finishClose = resolve)));
  const query = vi.fn().mockResolvedValue({ recordset: [{ mcp_ok: 1 }] });
  sql.connect.mockResolvedValue({ connected: true, request: () => ({ query }), close });
  const probe = runWorkerProbe({ signal: controller.signal });
  await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  controller.abort();
  finishClose();
  expect(await probe).toMatchObject({
    status: 'cancelled',
    category: 'cancelled',
    cleanup: 'complete'
  });
  expect(query).toHaveBeenCalledExactlyOnceWith('SELECT 1 AS mcp_ok');
});
