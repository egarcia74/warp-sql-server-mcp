import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { installWorkerProtocol } from '../../lib/cli/config-validation-worker.js';
const result = {
  version: 1,
  status: 'cancelled',
  category: 'cancelled',
  stage: 'initializing',
  elapsedMs: 0,
  attempts: 0,
  cleanup: 'complete'
};
function setup() {
  const host = new EventEmitter();
  host.connected = true;
  host.disconnect = vi.fn(() => {
    host.connected = false;
    host.emit('disconnect');
  });
  host.send = vi.fn((value, done) => {
    host.result = value;
    host.done = done;
  });
  let finish;
  const pending = new Promise(resolve => (finish = resolve));
  const probe = vi.fn(() => pending);
  installWorkerProtocol({ host, probe });
  return { host, probe, finish, pending };
}
it('runs exactly one start through the production protocol and disconnects after send completion', async () => {
  const { host, probe, finish, pending } = setup();
  host.emit('message', { type: 'start' });
  expect(probe).toHaveBeenCalledExactlyOnceWith({ signal: expect.any(globalThis.AbortSignal) });
  expect(host.send).not.toHaveBeenCalled();
  finish(result);
  await pending;
  expect(host.result).toEqual(result);
  expect(host.connected).toBe(true);
  host.done();
  expect(host.connected).toBe(false);
  expect(host.exitCode).toBeUndefined();
});
it.each(['SIGINT', 'SIGTERM', 'disconnect'])(
  'forwards %s cancellation while a probe is active',
  event => {
    const { host, probe } = setup();
    host.emit('message', { type: 'start' });
    const signal = probe.mock.calls[0][0].signal;
    host.emit(event);
    expect(signal.aborted).toBe(true);
  }
);
it('supports cancel before and after start without creating a second probe', () => {
  const { host, probe } = setup();
  host.emit('message', { type: 'cancel' });
  expect(probe).not.toHaveBeenCalled();
  host.emit('message', { type: 'start' });
  expect(probe.mock.calls[0][0].signal.aborted).toBe(true);
  host.emit('message', { type: 'cancel' });
  expect(probe).toHaveBeenCalledTimes(1);
  expect(host.exitCode).toBeUndefined();
});
it.each([
  null,
  {},
  'start',
  ['start'],
  { type: 1 },
  { type: 'other' },
  { type: 'start', extra: true },
  { type: 'cancel', extra: true }
])('refuses malformed requests without running a probe %#', message => {
  const { host, probe } = setup();
  host.emit('message', message);
  expect(probe).not.toHaveBeenCalled();
  expect(host.send).not.toHaveBeenCalled();
  expect(host.exitCode).toBe(1);
});
it('cancels duplicate starts without running a second query/probe', () => {
  const { host, probe } = setup();
  host.emit('message', { type: 'start' });
  host.emit('message', { type: 'start' });
  expect(probe).toHaveBeenCalledTimes(1);
  expect(probe.mock.calls[0][0].signal.aborted).toBe(true);
  expect(host.exitCode).toBe(1);
});
it('does not send a result after the parent has disconnected', async () => {
  const { host, finish, pending } = setup();
  host.emit('message', { type: 'start' });
  host.connected = false;
  host.emit('disconnect');
  finish(result);
  await pending;
  expect(host.send).not.toHaveBeenCalled();
  expect(host.disconnect).not.toHaveBeenCalled();
});
it('handles a disconnect race after result send without another disconnect attempt', async () => {
  const { host, finish, pending } = setup();
  host.emit('message', { type: 'start' });
  finish(result);
  await pending;
  host.connected = false;
  expect(() => host.done()).not.toThrow();
  expect(host.disconnect).not.toHaveBeenCalled();
});
it('keeps send callback failure explicit and never prints its raw error', async () => {
  const { host, finish, pending } = setup();
  host.emit('message', { type: 'start' });
  finish(result);
  await pending;
  expect(() => host.done(new Error('credential-protocol-1561'))).not.toThrow();
  expect(host.exitCode).toBe(1);
  expect(host.connected).toBe(false);
  expect(JSON.stringify(host.result)).not.toContain('credential-protocol-1561');
});
it('handles rejected probes without sending raw errors and releases the channel', async () => {
  const host = new EventEmitter();
  host.connected = true;
  host.disconnect = () => {
    host.connected = false;
  };
  host.send = vi.fn();
  const probe = vi.fn().mockRejectedValue(new Error('credential-protocol-1561'));
  installWorkerProtocol({ host, probe });
  host.emit('message', { type: 'start' });
  await vi.waitFor(() => expect(host.exitCode).toBe(1));
  expect(host.send).not.toHaveBeenCalled();
  expect(host.connected).toBe(false);
});
it('contains synchronous send and disconnect failures without raw output', async () => {
  const { host, finish, pending } = setup();
  host.send.mockImplementation(() => {
    throw new Error('credential-protocol-1561');
  });
  host.disconnect.mockImplementation(() => {
    throw new Error('credential-protocol-1561');
  });
  host.emit('message', { type: 'start' });
  finish(result);
  await pending;
  await vi.waitFor(() => expect(host.exitCode).toBe(1));
  expect(host.result).toBeUndefined();
});
