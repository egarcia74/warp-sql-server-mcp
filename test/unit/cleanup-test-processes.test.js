import { describe, expect, it } from 'vitest';
import { run, row } from './fixtures/cleanup-node-harness.js';

describe('cleanup inspector decisions', () => {
  it('reports by default without signalling', async () => {
    const result = await run();
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/4242\s+1\s+05:00/);
    expect(result.events).toEqual([]);
  });

  it.each(['0', '00', '*', '18446744073709555859', 'abc', '-5'])(
    'rejects invalid PID %s without signalling',
    async value => {
      const result = await run(['--kill', value]);
      expect(result.status).toBe(0);
      expect(result.events).toEqual([]);
    }
  );

  it('refuses zero padded PID 1', async () => {
    const result = await run(['--kill', '0001']);
    expect(result.status).toBe(1);
    expect(result.events).toEqual([]);
  });

  it('refuses all signalling if self ancestry is incomplete', async () => {
    const result = await run(['--kill', '4242'], {
      read: pid => (pid === 10 ? { kind: 'unknown' } : { kind: 'present', process: row(pid) })
    });
    expect(result.status).toBe(3);
    expect(result.events).toEqual([]);
  });

  it('refuses to signal its own descendant', async () => {
    const result = await run(['--kill', '4242'], {
      table: new Map([
        [10, row(10, 1, 'node inspector')],
        [4242, row(4242, 10)]
      ])
    });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([]);
  });

  it('treats unclassifiable live target as unknown', async () => {
    const result = await run(['--kill', '4242'], {
      read: pid =>
        pid === 10
          ? { kind: 'present', process: row(10, 1, 'node inspector') }
          : { kind: 'unknown' }
    });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([]);
  });

  it('checks identity before TERM and sends no signal after reuse', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => {
        if (pid === 10) return { kind: 'present', process: row(10, 1, 'node inspector') };
        return {
          kind: 'present',
          process: row(pid, 1, undefined, reads++ >= 2 ? 'ticks_reused' : 'ticks_original')
        };
      }
    });
    expect(result.events).toEqual([]);
  });

  it('checks identity before KILL and never signals a replacement', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => {
        if (pid === 10) return { kind: 'present', process: row(10, 1, 'node inspector') };
        return {
          kind: 'present',
          process: row(pid, 1, undefined, reads++ >= 3 ? 'ticks_reused' : 'ticks_original')
        };
      }
    });
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
  });

  it('escalates a renamed target using identity only', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => {
        if (pid === 10) return { kind: 'present', process: row(10, 1, 'node inspector') };
        return { kind: 'present', process: row(pid, 1, reads++ >= 3 ? 'renamed' : undefined) };
      }
    });
    expect(result.events).toEqual([
      [4242, 'SIGTERM'],
      [4242, 'SIGKILL']
    ]);
    expect(result.status).toBe(1);
  });

  it('does not escalate when TERM was denied', async () => {
    const result = await run(['--kill', '4242'], { signal: () => ({ kind: 'denied' }) });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
  });

  it('does not escalate when grace wait fails', async () => {
    const result = await run(['--kill', '4242'], {
      wait: async () => {
        throw new Error('wait failed');
      }
    });
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
    expect(result.status).toBe(1);
  });

  it('treats a zombie as terminated', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => {
        if (pid === 10) return { kind: 'present', process: row(10, 1, 'node inspector') };
        return {
          kind: 'present',
          process: row(pid, 1, undefined, undefined, reads++ >= 3 ? 'Z' : 'S')
        };
      }
    });
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
    expect(result.status).toBe(0);
  });

  it('keeps report mode nonblocking when the table is unknown', async () => {
    const result = await run([], { list: () => ({ kind: 'unknown' }) });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/could not be read/);
  });

  it('returns usage code 2 for missing kill PIDs', async () => {
    expect((await run(['--kill'])).status).toBe(2);
  });
});
