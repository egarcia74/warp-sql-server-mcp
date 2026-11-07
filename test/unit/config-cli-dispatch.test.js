/** Instrument the shipped top-level dispatch; keep actual subprocess smoke tests separately. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const commands = vi.hoisted(() => ({ edit: vi.fn(), validate: vi.fn() }));
vi.mock('../../lib/cli/config-editor.js', () => ({ editConfigCommand: commands.edit }));
vi.mock('../../lib/cli/config-validation.js', () => ({ validateConfigCommand: commands.validate }));
let home, argv, exitCode, log, error;
beforeEach(() => {
  vi.resetModules();
  commands.edit.mockReset().mockResolvedValue(0);
  commands.validate.mockReset().mockResolvedValue(0);
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'config-dispatch-'));
  argv = process.argv;
  exitCode = process.exitCode;
  process.exitCode = undefined;
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
function command(args) {
  process.argv = [process.execPath, path.resolve('cli.js'), ...args];
  return import('../../cli.js');
}
it.each([
  { args: ['unknown'] },
  { args: ['edit', 'extra'] },
  { args: ['validate', 'extra'] },
  { args: ['edit', 'extra', 'again'] }
])('rejects malformed config arguments without running commands %#', async ({ args }) => {
  await command(['config', ...args]);
  expect(process.exitCode).toBe(2);
  expect(error.mock.calls.flat().join(' ')).toContain('Usage:');
  expect(commands.edit).not.toHaveBeenCalled();
  expect(commands.validate).not.toHaveBeenCalled();
});
it.each([
  ['edit', 0],
  ['edit', 130],
  ['validate', 0],
  ['validate', 1],
  ['validate', 2],
  ['validate', 143]
])('dispatches %s and propagates status %s', async (name, status) => {
  commands[name].mockResolvedValue(status);
  const before = ['SIGINT', 'SIGTERM'].map(event => process.listeners(event));
  await command(['config', name]);
  expect(process.exitCode).toBe(status);
  expect(commands[name]).toHaveBeenCalledExactlyOnceWith({
    signal: expect.any(globalThis.AbortSignal)
  });
  expect(commands[name === 'edit' ? 'validate' : 'edit']).not.toHaveBeenCalled();
  for (const [i, event] of ['SIGINT', 'SIGTERM'].entries())
    expect(process.listeners(event)).toEqual(before[i]);
});
it.each(['edit', 'validate'])(
  'cleans signal listeners and hides rejected %s error bytes',
  async name => {
    const before = ['SIGINT', 'SIGTERM'].map(event => process.listeners(event));
    commands[name].mockRejectedValue(new Error('credential-dispatch-1561'));
    await command(['config', name]);
    expect(process.exitCode).toBe(2);
    expect(error.mock.calls.flat().join(' ')).toBe('Configuration command failed.');
    expect(error.mock.calls.flat().join(' ')).not.toContain('credential-dispatch-1561');
    for (const [i, event] of ['SIGINT', 'SIGTERM'].entries())
      expect(process.listeners(event)).toEqual(before[i]);
  }
);
it.each(['SIGINT', 'SIGTERM'])(
  'forwards %s and repeated interruption to the active command',
  async event => {
    const before = process.listeners(event);
    let signal, finish;
    commands.edit.mockImplementation(options => {
      signal = options.signal;
      return new Promise(resolve => (finish = resolve));
    });
    const running = command(['config', 'edit']);
    try {
      await vi.waitFor(() => expect(signal).toBeDefined());
      const listener = process.listeners(event).find(fn => !before.includes(fn));
      let aborted = 0;
      signal.addEventListener('abort', () => aborted++);
      listener();
      expect(signal.reason).toBe(event);
      if (event === 'SIGINT') {
        listener();
        expect(aborted).toBe(2);
      } else expect(aborted).toBe(1);
      finish(event === 'SIGTERM' ? 143 : 130);
      await running;
      expect(process.exitCode).toBe(event === 'SIGTERM' ? 143 : 130);
      expect(process.listeners(event)).toEqual(before);
    } finally {
      finish?.(2);
      await running;
    }
  }
);
it('handles missing HOME/USERPROFILE safely without resolving an unintended config path', async () => {
  vi.stubEnv('HOME', '');
  vi.stubEnv('USERPROFILE', '');
  await command(['help']);
  expect(log.mock.calls.flat().join(' ')).toContain('config edit');
  expect(commands.edit).not.toHaveBeenCalled();
  expect(commands.validate).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});
it('uses the real safe saved-only projection at the bare-config output sink', async () => {
  const file = path.join(home, '.warp-sql-server-mcp.json');
  const bytes = JSON.stringify({
    sql_server_password: 12345678,
    nested: [12345678],
    ordinary: 'saved-only'
  });
  fs.writeFileSync(file, bytes);
  await command(['config']);
  const json = log.mock.calls.at(-1)[0];
  expect(JSON.parse(json)).toEqual({
    sql_server_password: '***MASKED***',
    nested: ['***MASKED***'],
    ordinary: 'saved-only'
  });
  expect(json).not.toContain('12345678');
  expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
  expect(commands.edit).not.toHaveBeenCalled();
  expect(commands.validate).not.toHaveBeenCalled();
});
