import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  runConfigValidation,
  isProbeResult,
  unsupportedStartupVariables,
  validateConfigCommand,
  reportProbe
} from '../../lib/cli/config-validation.js';
import { createConfigOutput } from '../../lib/cli/config-output.js';
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

it('accepts reordered exact schema keys without locale-dependent behavior', () => {
  expect(
    isProbeResult({
      cleanup: 'complete',
      status: 'success',
      version: 1,
      elapsedMs: 1,
      attempts: 1,
      category: 'ok',
      stage: 'finished'
    })
  ).toBe(true);
});
it.each([
  null,
  [],
  { ...good, category: 'network' },
  { ...good, stage: 'closing' },
  { ...good, cleanup: 'failed' },
  { ...good, status: 'failure' },
  { ...good, status: 'unknown' },
  { ...good, cleanup: 'unknown' },
  { ...good, version: 2 },
  { ...good, attempts: 11 },
  {
    category: 'ok',
    status: 'success',
    stage: 'finished',
    elapsedMs: 1,
    attempts: 1,
    cleanup: 'complete',
    substituted: 1
  },
  {
    status: 'success',
    category: 'ok',
    stage: 'finished',
    elapsedMs: 1,
    attempts: 1,
    cleanup: 'complete'
  }
])('rejects invalid success/enum/exact-schema combinations %#', value =>
  expect(isProbeResult(value)).toBe(false)
);
it('contains throwing getters and serialization instead of exposing an error', () => {
  const getter = Object.defineProperty({}, 'status', {
    enumerable: true,
    get: () => {
      throw new Error('credential-validation-1561');
    }
  });
  expect(isProbeResult(getter)).toBe(false);
  expect(
    isProbeResult({
      toJSON: () => {
        throw new Error('credential-validation-1561');
      }
    })
  ).toBe(false);
});
it('reports a spawn exception before child creation as runtime with complete cleanup', async () => {
  expect(
    await runConfigValidation({
      resolved,
      spawnImpl: () => {
        throw new Error('credential-validation-1561');
      }
    })
  ).toMatchObject({ category: 'runtime', cleanup: 'complete' });
});
it('bounds a failed first IPC send after child creation and contains late errors', async () => {
  vi.useFakeTimers();
  const { child, spawnImpl } = setup();
  child.connected = true;
  child.send.mockImplementation(() => {
    throw new Error('credential-validation-1561');
  });
  const pending = runConfigValidation({ resolved, spawnImpl });
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toMatchObject({ category: 'runtime', cleanup: 'unconfirmed' });
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  expect(child.disconnect).toHaveBeenCalledTimes(1);
  expect(child.unref).toHaveBeenCalledTimes(1);
  expect(() => child.emit('error', new Error('credential-validation-1561'))).not.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});
it('reports unconfirmed cleanup explicitly with only fixed output', () => {
  let text = '';
  const output = createConfigOutput({ stdout: { write: s => (text += s) } });
  reportProbe(output, { category: 'runtime', cleanup: 'unconfirmed' });
  expect(text).toContain('could not be confirmed');
});
it.each([undefined, 'SIGINT', 'SIGTERM'])(
  'safe command failure preserves ordinary or signal status %#',
  async reason => {
    const controller = new globalThis.AbortController();
    if (reason) controller.abort(reason);
    let text = '';
    const output = createConfigOutput({
      stdout: { write: s => (text += s) },
      stderr: { write: s => (text += s) }
    });
    expect(await validateConfigCommand({ inherited: {}, signal: controller.signal, output })).toBe(
      reason === 'SIGTERM' ? 143 : reason ? 130 : 2
    );
    expect(text).toContain('HOME or USERPROFILE');
  }
);
it('standalone validation rejects startup variables before a worker or target display', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'config-validation-startup-'));
  let text = '';
  try {
    fs.writeFileSync(
      path.join(home, '.warp-sql-server-mcp.json'),
      '{"SQL_SERVER_USER":"u","SQL_SERVER_PASSWORD":"credential-validation-1561"}'
    );
    const output = createConfigOutput({
      stdout: { write: s => (text += s) },
      stderr: { write: s => (text += s) }
    });
    const field = vi.spyOn(output, 'field');
    expect(
      await validateConfigCommand({
        cwd: home,
        inherited: { HOME: home, NODE_OPTIONS: 'credential-startup-1561' },
        output
      })
    ).toBe(2);
    expect(field).not.toHaveBeenCalled();
    expect(text).toContain('NODE_OPTIONS');
    expect(text).not.toContain('credential-startup-1561');
    expect(text).not.toContain('credential-validation-1561');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
