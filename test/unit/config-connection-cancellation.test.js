import { afterEach, expect, it, vi } from 'vitest';
import sql from 'mssql';
import { ConnectionManager } from '../../lib/database/connection-manager.js';
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('does not connect when already cancelled', async () => {
  const c = new globalThis.AbortController();
  c.abort();
  const manager = new ConnectionManager();
  await expect(manager.connect({ signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(sql.connect).not.toHaveBeenCalled();
});
it('aborts backoff and never starts another attempt', async () => {
  vi.useFakeTimers();
  sql.connect.mockRejectedValue(new Error('fail'));
  const manager = new ConnectionManager({ retryDelay: 1000, maxRetries: 3 });
  const c = new globalThis.AbortController();
  const p = manager.connect({ signal: c.signal });
  const result = expect(p).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(1);
  c.abort();
  await result;
  await vi.advanceTimersByTimeAsync(10000);
  expect(sql.connect).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  'disposes a late success after cancellation, closeFailure=%s',
  async fail => {
    let finish;
    const pool = {
      connected: true,
      close: vi.fn(
        fail ? () => Promise.reject(new Error('test-secret-1559')) : () => Promise.resolve()
      )
    };
    sql.connect.mockImplementation(
      () =>
        new Promise(r => {
          finish = r;
        })
    );
    const manager = new ConnectionManager();
    const c = new globalThis.AbortController();
    const p = manager.connect({ signal: c.signal });
    c.abort();
    finish(pool);
    const e = await p.catch(e => e);
    expect(e.name).toBe('AbortError');
    expect(e.cleanupFailed).toBe(fail);
    expect(pool.close).toHaveBeenCalledTimes(1);
    expect(manager.getPool()).toBe(null);
    expect(manager.isConnected).toBe(false);
    expect(JSON.stringify(e)).not.toContain('test-secret-1559');
    expect(sql.connect).toHaveBeenCalledTimes(1);
  }
);
it('retains private cause and preserves the old final message', async () => {
  const cause = Object.assign(new Error('driver failure'), { code: 'ELOGIN' });
  sql.connect.mockRejectedValue(cause);
  const manager = new ConnectionManager({ maxRetries: 1 });
  const e = await manager.connect().catch(e => e);
  expect(e.message).toContain('Failed to connect to SQL Server after 1 attempts: driver failure');
  expect(e.cause).toBe(cause);
  expect(Object.keys(e)).not.toContain('cause');
});
it('strict close surfaces failure after clearing state while default swallowing is unchanged', async () => {
  const manager = new ConnectionManager();
  manager.pool = { close: () => Promise.reject(new Error('private')) };
  manager.isConnected = true;
  await expect(manager.close({ throwOnError: true })).rejects.toThrow('private');
  expect(manager.pool).toBe(null);
  expect(manager.isConnected).toBe(false);
  manager.pool = { close: () => Promise.reject(new Error('private')) };
  await expect(manager.close()).resolves.toBeUndefined();
  expect(manager.pool).toBe(null);
});
it('finishes retry backoff, removes the abort listener and makes the next ordered attempt', async () => {
  const pool = { connected: true, close: vi.fn().mockResolvedValue() };
  sql.connect.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(pool);
  const controller = new globalThis.AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const manager = new ConnectionManager({ maxRetries: 2, retryDelay: 1 });
  expect(await manager.connect({ signal: controller.signal })).toBe(pool);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(sql.connect).toHaveBeenCalledTimes(2);
  await manager.close({ throwOnError: true });
});
