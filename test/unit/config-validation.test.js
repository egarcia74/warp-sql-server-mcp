import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import {
  runConfigValidation,
  isProbeResult,
  unsupportedStartupVariables
} from '../../lib/cli/config-validation.js';
const env = { SQL_SERVER_USER: 'synthetic', SQL_SERVER_PASSWORD: 'test-secret-1559' };
const good = {
  version: 1,
  status: 'success',
  category: 'ok',
  stage: 'finished',
  elapsedMs: 1,
  attempts: 1,
  cleanup: 'complete'
};
const resolved = { environment: env, sources: {} };
function setup() {
  const child = new EventEmitter();
  child.send = vi.fn();
  child.kill = vi.fn();
  child.unref = vi.fn();
  child.disconnect = vi.fn();
  const spawnImpl = vi.fn(() => child);
  return { child, spawnImpl };
}
afterEach(() => vi.useRealTimers());
it('requires clean exit after result, uses fixed private process boundary and does not mutate env', async () => {
  const { child, spawnImpl } = setup();
  let done = false;
  const p = runConfigValidation({ resolved, spawnImpl }).then(r => {
    done = true;
    return r;
  });
  const [exe, args, options] = spawnImpl.mock.calls[0];
  expect(exe).toBe(process.execPath);
  expect(args).toHaveLength(1);
  expect(args[0]).toMatch(/config-validation-worker\.js$/);
  expect(JSON.stringify(args)).not.toContain(env.SQL_SERVER_PASSWORD);
  expect(options.stdio).toEqual(['ignore', 'ignore', 'ignore', 'ipc']);
  expect(options.shell).toBe(false);
  expect(options.env.SQL_SERVER_PASSWORD).toBe(env.SQL_SERVER_PASSWORD);
  child.emit('message', good);
  await Promise.resolve();
  expect(done).toBe(false);
  child.emit('exit', 0, null);
  expect(await p).toEqual(good);
  expect(env).toEqual({ SQL_SERVER_USER: 'synthetic', SQL_SERVER_PASSWORD: 'test-secret-1559' });
});
it('rejects invalid local config and startup injection without spawning', async () => {
  for (const environment of [
    { SQL_SERVER_PORT: 'wrong' },
    { ...env, NODE_OPTIONS: 'test-secret-1559' },
    { ...env, NODE_V8_COVERAGE: 'path' }
  ]) {
    const { spawnImpl } = setup();
    const r = await runConfigValidation({ resolved: { environment, sources: {} }, spawnImpl });
    expect(r.category).toBe('configuration');
    expect(spawnImpl).not.toHaveBeenCalled();
  }
  expect(unsupportedStartupVariables({ node_options: 'x' }, { platform: 'win32' })).toEqual([
    'NODE_OPTIONS'
  ]);
});
it.each([
  { ...good, secret: 'test-secret-1559' },
  { ...good, attempts: Infinity },
  { ...good, stage: 'arbitrary' },
  { ...good, elapsedMs: -1 },
  'x'.repeat(5000)
])('rejects malformed/oversized envelope %#', async envelope => {
  expect(isProbeResult(envelope)).toBe(false);
  const { child, spawnImpl } = setup();
  const p = runConfigValidation({ resolved, spawnImpl });
  child.emit('message', envelope);
  child.emit('exit', 0, null);
  expect((await p).category).toBe('runtime');
});
it.each(['error', 'disconnect', 'exit'])(
  'reports %s without a result as runtime failure',
  async event => {
    const { child, spawnImpl } = setup();
    const p = runConfigValidation({ resolved, spawnImpl });
    child.emit(event, event === 'exit' ? 0 : new Error('test-secret-1559'));
    if (event !== 'exit') child.emit('exit', 1, null);
    expect((await p).category).toBe('runtime');
  }
);
it('times out at 60000, kills at 62000 and confirms failure at 63000', async () => {
  vi.useFakeTimers();
  const { child, spawnImpl } = setup();
  const p = runConfigValidation({ resolved, spawnImpl, now: () => Date.now() });
  await vi.advanceTimersByTimeAsync(59999);
  expect(child.send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(child.send.mock.calls.at(-1)[0]).toEqual({ type: 'cancel' });
  await vi.advanceTimersByTimeAsync(1999);
  expect(child.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  await vi.advanceTimersByTimeAsync(1000);
  const r = await p;
  expect(r.status).toBe('failure');
  expect(r.cleanup).toBe('unconfirmed');
  expect(r.category).toBe('total-timeout');
});
it('never accepts success after cancel, second cancel kills immediately', async () => {
  vi.useFakeTimers();
  const { child, spawnImpl } = setup();
  const controller = new globalThis.AbortController();
  const p = runConfigValidation({ resolved, spawnImpl, signal: controller.signal });
  controller.abort();
  controller.signal.dispatchEvent(new globalThis.Event('abort'));
  expect(child.kill).toHaveBeenCalledTimes(1);
  child.emit('message', good);
  child.emit('exit', 0, null);
  expect((await p).category).toBe('cancelled');
  await vi.advanceTimersByTimeAsync(65000);
  expect(child.kill).toHaveBeenCalledTimes(1);
});
it('clean probe result with crash exit is never successful', async () => {
  const { child, spawnImpl } = setup();
  const p = runConfigValidation({ resolved, spawnImpl });
  child.emit('message', good);
  child.emit('exit', 1, null);
  expect((await p).status).toBe('failure');
});
it('reports a retained cleanup failure even when cancellation is the primary outcome', async () => {
  const { reportProbe } = await import('../../lib/cli/config-validation.js');
  const lines = [];
  reportProbe(
    { line: s => lines.push(s) },
    {
      version: 1,
      status: 'cancelled',
      category: 'cancelled',
      stage: 'closing',
      elapsedMs: 1,
      attempts: 1,
      cleanup: 'failed'
    }
  );
  expect(lines.some(line => line.includes('cleanup failed'))).toBe(true);
});
