import { describe, expect, it, vi } from 'vitest';
import {
  createPlatformAdapter,
  parseLinuxStat,
  parseDarwinTable,
  readSystemStatus
} from '../../scripts/cleanup-process-platform.js';

const stat = (pid, ppid = 1, ticks = 123, state = 'S', flags = 0) => {
  const fields = Array(17).fill('0');
  fields[4] = String(flags);
  return `${pid} (node (worker)) ${state} ${ppid} ${fields.join(' ')} ${ticks} 0`;
};

describe('process inspection adapters', () => {
  it('parses Linux stat with spaces and parentheses in comm', () => {
    expect(parseLinuxStat(stat(4242))).toMatchObject({
      pid: 4242,
      ppid: 1,
      state: 'S',
      startIdentity: 'ticks_123'
    });
  });

  it('returns unknown when the PID changes between Linux stat and cmdline reads', () => {
    let statReads = 0;
    const readFile = vi.fn(path => {
      if (path === '/proc/self/stat') return stat(10);
      if (path.endsWith('/stat'))
        return statReads++ === 0 ? stat(4242, 1, 123) : stat(4242, 1, 124);
      return 'node\0/repo/vitest\0';
    });
    const adapter = createPlatformAdapter({ platform: 'linux', readFile, selfPid: 10 });
    expect(adapter.read(4242)).toMatchObject({ kind: 'unknown' });
  });

  it('returns unknown if procfs is unavailable rather than calling ENOENT absence', () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const adapter = createPlatformAdapter({
      platform: 'linux',
      readFile: () => {
        throw error;
      },
      selfPid: 10
    });
    expect(adapter.read(4242)).toMatchObject({ kind: 'unknown' });
  });

  it('treats target ENOENT as absent only with ESRCH and a healthy procfs canary', () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const adapter = createPlatformAdapter({
      platform: 'linux',
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        throw error;
      },
      selfPid: 10,
      kill: () => {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      }
    });
    expect(adapter.read(4242)).toEqual({ kind: 'absent' });
  });

  it('treats a hidden live Linux PID as unknown despite target ENOENT', () => {
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        throw Object.assign(new Error('hidden'), { code: 'ENOENT' });
      },
      kill: () => {
        throw Object.assign(new Error('denied'), { code: 'EPERM' });
      }
    });
    expect(adapter.read(4242)).toMatchObject({ kind: 'unknown' });
  });

  it('does not combine a changed parent with the old command', () => {
    let reads = 0;
    const adapter = createPlatformAdapter({
      platform: 'linux',
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        if (path.endsWith('/stat')) return stat(4242, reads++ ? 2 : 1);
        return 'node\0vitest\0';
      },
      selfPid: 10
    });
    expect(adapter.read(4242)).toMatchObject({ kind: 'unknown' });
  });

  it('keeps a stable Linux identity when scheduler state changes during lookup', () => {
    let reads = 0;
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        if (path.endsWith('/stat')) return stat(4242, 1, 123, reads++ ? 'R' : 'S');
        return 'node\0vitest\0';
      }
    });
    expect(adapter.read(4242)).toMatchObject({
      kind: 'present',
      process: { state: 'R', startIdentity: 'ticks_123', command: 'node vitest' }
    });
  });

  it('does not combine a changed kernel flag with the old command', () => {
    let reads = 0;
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        if (path.endsWith('/stat')) return stat(4242, 1, 123, 'S', reads++ ? 0x200000 : 0);
        return 'node\0vitest\0';
      }
    });
    expect(adapter.read(4242)).toMatchObject({ kind: 'unknown' });
  });

  it('uses command and identity from the same macOS row', () => {
    const sample =
      '  10    1 Mon Nov  2 09:00:00 2026 S 01:00 node inspector\n4242    1 Mon Nov  2 10:00:00 2026 S 05:00 node /repo/vitest run\n';
    expect(parseDarwinTable(sample, 10).get(4242)).toMatchObject({
      command: 'node /repo/vitest run',
      startIdentity: 'lstart_Mon_Nov_2_10:00:00_2026',
      elapsed: '05:00'
    });
  });

  it('computes elapsed time from Linux uptime and start ticks', () => {
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readDir: () => ['10', '4242'],
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        if (path === '/proc/uptime') return '423.00 10.00';
        if (path.endsWith('/stat')) return stat(Number(path.split('/')[2]), 1, 12300);
        return 'node\0/repo/vitest\0';
      },
      spawn: () => ({ status: 0, stdout: '100\n' })
    });
    const result = adapter.list();
    expect(result.kind).toBe('present');
    expect(result.rows.find(value => value.pid === 4242).elapsed).toBe('05:00');
  });

  it('does not mark a blank-command kernel thread as an uncertain process', () => {
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readDir: () => ['10', '4242'],
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        if (path === '/proc/10/stat') return stat(10);
        if (path === '/proc/4242/stat') return stat(4242, 1, 123, 'S', 0x200000);
        if (path.endsWith('/cmdline')) return path.includes('/4242/') ? '' : 'node\0inspector\0';
        throw new Error('unavailable');
      },
      spawn: () => ({ status: 1 })
    });
    const result = adapter.list();
    expect(result.uncertain).toBe(false);
    expect(result.rows.find(value => value.pid === 4242).command).toBe('[kernel thread]');
  });

  it('preserves a blank-command user process identity for post-TERM checks', () => {
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readFile: path =>
        path.endsWith('/cmdline') ? '' : stat(path === '/proc/self/stat' ? 10 : 4242)
    });
    expect(adapter.read(4242)).toMatchObject({
      kind: 'present',
      process: { command: '', startIdentity: 'ticks_123', state: 'S' }
    });
  });

  it('marks a blank-command live user process uncertain in listings', () => {
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readDir: () => ['10', '4242'],
      readFile: path => {
        if (path === '/proc/uptime') return '423.00 10.00';
        if (path.endsWith('/stat')) return stat(path === '/proc/4242/stat' ? 4242 : 10);
        return path === '/proc/4242/cmdline' ? '' : 'node\0inspector\0';
      },
      spawn: () => ({ status: 0, stdout: '100\n' })
    });
    const listed = adapter.list();
    expect(listed.uncertain).toBe(true);
    expect(listed.rows.find(value => value.pid === 4242)).toMatchObject({
      command: '',
      startIdentity: 'ticks_123'
    });
  });

  it('bounds getconf and uses an unknown elapsed value if it times out', () => {
    let timeout;
    const adapter = createPlatformAdapter({
      platform: 'linux',
      selfPid: 10,
      readDir: () => ['10', '4242'],
      readFile: path => {
        if (path === '/proc/self/stat') return stat(10);
        if (path === '/proc/uptime') return '423.00 10.00';
        if (path.endsWith('/stat')) return stat(Number(path.split('/')[2]), 1, 12300);
        return 'node\0/repo/vitest\0';
      },
      spawn: (_file, _args, options) => {
        timeout = options.timeout;
        return { status: null, error: new Error('timed out') };
      }
    });
    const result = adapter.list();
    expect(result.rows.find(value => value.pid === 4242).elapsed).toBe('?');
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(5000);
  });

  it('treats a macOS target missing from ps but probe-EPERM as unknown', () => {
    const adapter = createPlatformAdapter({
      platform: 'darwin',
      selfPid: 10,
      spawn: () => ({
        status: 0,
        stdout: '10 1 Mon Nov  2 09:00:00 2026 S 01:00 node inspector\n'
      }),
      kill: () => {
        throw Object.assign(new Error('denied'), { code: 'EPERM' });
      }
    });
    expect(adapter.read(4242)).toMatchObject({ kind: 'unknown' });
  });

  it('treats an empty successful macOS snapshot as unknown', () => {
    const adapter = createPlatformAdapter({
      platform: 'darwin',
      spawn: () => ({ status: 0, stdout: '' }),
      selfPid: 10
    });
    expect(adapter.read(4242)).toMatchObject({ kind: 'unknown' });
  });

  it('bounds the macOS ps snapshot time so a hook cannot wait indefinitely', () => {
    let timeout;
    const adapter = createPlatformAdapter({
      platform: 'darwin',
      selfPid: 10,
      spawn: (_file, _args, options) => {
        timeout = options.timeout;
        return {
          status: null,
          error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
        };
      }
    });
    expect(adapter.list()).toMatchObject({ kind: 'unknown' });
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(5000);
  });

  it('rejects malformed or locale-variant macOS start time', () => {
    expect(() => parseDarwinTable('10 1 Lun Nov 2 09:00:00 2026 S node inspector', 10)).toThrow();
  });

  it('keeps a long macOS command on its own row', () => {
    const command = `node /repo/vitest ${'x'.repeat(100_000)}`;
    const sample =
      '10 1 Mon Nov 2 09:00:00 2026 S 01:00 node inspector\n' +
      `4242 1 Mon Nov 2 10:00:00 2026 R 05:00 ${command}\n`;
    expect(parseDarwinTable(sample, 10).get(4242).command).toBe(command);
  });

  it('rejects a long malformed macOS row without inventing a process', () => {
    const sample =
      '10 1 Mon Nov 2 09:00:00 2026 S 01:00 node inspector\n' +
      `4242 1 Mon Nov 2 10:00:00 2026 ${' '.repeat(100_000)}missing fields\n`;
    expect(() => parseDarwinTable(sample, 10)).toThrow('malformed ps row');
  });

  it('rejects duplicate macOS PIDs even when both rows look valid', () => {
    const sample =
      '10 1 Mon Nov 2 09:00:00 2026 S 01:00 node inspector\n' +
      '10 1 Mon Nov 2 10:00:00 2026 S 00:01 node inspector\n';
    expect(() => parseDarwinTable(sample, 10)).toThrow('invalid ps PID');
  });

  it('maps EPERM and ESRCH separately for liveness probes', () => {
    const adapter = createPlatformAdapter({
      platform: 'linux',
      readFile: () => stat(10),
      selfPid: 10,
      kill: () => {
        throw Object.assign(new Error('denied'), { code: 'EPERM' });
      }
    });
    expect(adapter.probe(4242)).toEqual({ kind: 'present', signalable: false });
  });

  it('bounds a hung top sample and returns unavailable', () => {
    let timeout;
    const output = readSystemStatus({
      platform: 'darwin',
      spawn: (_file, _args, options) => {
        timeout = options.timeout;
        return { status: null, error: new Error('timed out') };
      }
    });
    expect(output).toBe('');
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(5000);
  });
});
