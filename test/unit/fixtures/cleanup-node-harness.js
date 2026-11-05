import { inspect } from '../../../scripts/cleanup-process-inspector.js';

export const row = (
  pid,
  ppid = 1,
  command = 'node /repo/node_modules/.bin/vitest run',
  startIdentity = `ticks_${pid}`,
  state = 'S'
) => ({ pid, ppid, command, startIdentity, state, elapsed: '05:00' });

export const run = async (args = [], options = {}) => {
  const events = [];
  const output = [];
  const table =
    options.table ??
    new Map([
      [10, row(10, 1, 'node inspector')],
      [4242, row(4242)]
    ]);
  const read =
    options.read ??
    (pid => (table.has(pid) ? { kind: 'present', process: table.get(pid) } : { kind: 'absent' }));
  const adapter = {
    read,
    list: options.list ?? (() => ({ kind: 'present', rows: [...table.values()] })),
    signal: (pid, signal) => {
      events.push([pid, signal]);
      return options.signal ? options.signal(pid, signal) : { kind: 'sent' };
    },
    probe: options.probe ?? (() => ({ kind: 'present', signalable: true }))
  };
  const status = await inspect({
    args,
    adapter,
    selfPid: 10,
    write: line => output.push(line),
    wait: options.wait ?? (async () => {}),
    status: options.status ?? (() => 'Processes: 1 total\nCPU usage: 0.0% user')
  });
  return { status, output: output.join('\n'), events };
};
