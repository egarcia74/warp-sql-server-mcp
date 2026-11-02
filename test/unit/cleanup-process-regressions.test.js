import { describe, expect, it } from 'vitest';
import { run, row } from './fixtures/cleanup-node-harness.js';

const present = processRow => ({ kind: 'present', process: processRow });
const base = pid => (pid === 10 ? present(row(10, 1, 'node inspector')) : present(row(pid)));

describe('ported report-mode regressions', () => {
  it('reports no Vitest processes when table has only other commands', async () => {
    const result = await run([], {
      table: new Map([
        [10, row(10, 1, 'node inspector')],
        [4242, row(4242, 1, 'node server')]
      ])
    });
    expect(result.output).toMatch(/No Vitest processes found/);
    expect(result.events).toEqual([]);
  });

  it('does not omit a Vitest command containing grep', async () => {
    const result = await run([], {
      table: new Map([
        [10, row(10, 1, 'node inspector')],
        [4242, row(4242, 1, 'node /grep-utils/vitest')]
      ])
    });
    expect(result.output).toMatch(/4242.*grep-utils/);
  });

  it('does not omit a Vitest command whose path mentions the inspector', async () => {
    const result = await run([], {
      table: new Map([
        [10, row(10, 1, 'node inspector')],
        [4242, row(4242, 1, 'node /fix-cleanup-test-processes/vitest')]
      ])
    });
    expect(result.output).toMatch(/4242.*fix-cleanup/);
  });

  it('excludes its own ancestor by PID', async () => {
    const table = new Map([
      [10, row(10, 4242, 'node inspector')],
      [4242, row(4242, 1)]
    ]);
    const result = await run([], { table });
    expect(result.output).not.toMatch(/4242 1/);
  });

  it('excludes its own descendant by parent walk', async () => {
    const table = new Map([
      [10, row(10, 1, 'node inspector')],
      [4242, row(4242, 10)]
    ]);
    const result = await run([], { table });
    expect(result.output).not.toMatch(/4242 10/);
  });

  it('lists a candidate and warns if caller ancestry is unknown', async () => {
    const result = await run([], {
      read: pid => (pid === 10 ? { kind: 'unknown' } : present(row(pid)))
    });
    expect(result.output).toMatch(/4242/);
    expect(result.output).toMatch(/ancestry could not be walked/);
    expect(result.status).toBe(0);
  });

  it('bounds a long optional status sample without a pipe', async () => {
    const result = await run([], {
      status: () => Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n')
    });
    expect(result.output).toMatch(/line-4/);
    expect(result.output).not.toMatch(/line-5/);
    expect(result.status).toBe(0);
  });

  it('ignores a failed optional status sample', async () => {
    const result = await run([], {
      status: () => {
        throw new Error('top failed');
      }
    });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/top unavailable/);
  });
});

describe('ported PID and classification regressions', () => {
  it.each(['-1', '+1', '1.0', '1e2', ' 4242', '4242 ', 'NaN', '', '*', '99999999'])(
    'does not signal malformed PID %j',
    async raw => {
      const result = await run(['--kill', raw]);
      expect(result.events).toEqual([]);
      expect(result.status).toBe(0);
    }
  );

  it('handles each PID in a multi-PID request independently', async () => {
    const result = await run(['--kill', 'abc', '4242']);
    expect(result.output).toMatch(/abc: not a PID/);
    expect(result.events).toEqual([
      [4242, 'SIGTERM'],
      [4242, 'SIGKILL']
    ]);
  });

  it('treats an absent named PID as a benign no-op', async () => {
    const result = await run(['--kill', '4243']);
    expect(result.status).toBe(0);
    expect(result.events).toEqual([]);
  });

  it('does not signal a non-Vitest command', async () => {
    const result = await run(['--kill', '4242'], {
      table: new Map([
        [10, row(10, 1, 'node inspector')],
        [4242, row(4242, 1, 'node server')]
      ])
    });
    expect(result.status).toBe(0);
    expect(result.events).toEqual([]);
  });

  it('refuses a blank command rather than claiming non-Vitest', async () => {
    const result = await run(['--kill', '4242'], {
      table: new Map([
        [10, row(10, 1, 'node inspector')],
        [4242, row(4242, 1, '')]
      ])
    });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([]);
  });

  it('refuses a blank start identity', async () => {
    const result = await run(['--kill', '4242'], {
      table: new Map([
        [10, row(10, 1, 'node inspector')],
        [4242, row(4242, 1, undefined, '')]
      ])
    });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([]);
  });

  it('refuses TERM when classification becomes unknown after validation', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => (pid === 10 ? base(pid) : ++reads >= 3 ? { kind: 'unknown' } : base(pid))
    });
    expect(result.events).toEqual([]);
    expect(result.status).toBe(1);
  });

  it('refuses TERM when command no longer looks like Vitest', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid =>
        pid === 10 ? base(pid) : present(row(pid, 1, ++reads >= 3 ? 'renamed' : undefined))
    });
    expect(result.events).toEqual([]);
  });
});

describe('ported ancestry and outcome regressions', () => {
  it('refuses a cyclic caller ancestry', async () => {
    const result = await run(['--kill', '4242'], {
      read: pid => present(row(pid, pid === 10 ? 11 : pid === 11 ? 10 : 1))
    });
    expect(result.status).toBe(3);
    expect(result.events).toEqual([]);
  });

  it('refuses an unknown descendant walk', async () => {
    const result = await run(['--kill', '4242'], {
      read: pid =>
        pid === 10 ? base(pid) : pid === 4242 ? present(row(pid, 77)) : { kind: 'unknown' }
    });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([]);
  });

  it('treats an ESRCH final probe and confirmed absence as terminated', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => (pid === 10 ? base(pid) : ++reads >= 6 ? { kind: 'absent' } : base(pid)),
      probe: () => ({ kind: 'absent' })
    });
    expect(result.status).toBe(0);
  });

  it('reports a target that vanished before TERM without claiming it was terminated', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => (pid === 10 ? base(pid) : ++reads >= 3 ? { kind: 'absent' } : base(pid))
    });
    expect(result.events).toEqual([]);
    expect(result.output).toMatch(/not signalled/);
    expect(result.output).not.toMatch(/4242: terminated/);
  });

  it('reports ESRCH at TERM without claiming the target exited', async () => {
    const result = await run(['--kill', '4242'], {
      signal: () => ({ kind: 'absent' }),
      read: pid => (pid === 10 ? base(pid) : base(pid))
    });
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
    expect(result.output).toMatch(/TERM found no such process/);
    expect(result.output).not.toMatch(/exited before TERM/);
    expect(result.output).not.toMatch(/could not be signalled/);
  });

  it('does not claim termination when TERM was denied before final confirmed absence', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      signal: () => ({ kind: 'denied' }),
      read: pid => (pid === 10 ? base(pid) : ++reads >= 5 ? { kind: 'absent' } : base(pid)),
      probe: () => ({ kind: 'absent' })
    });
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
    expect(result.output).toMatch(/not signalled/);
    expect(result.output).not.toMatch(/4242: terminated/);
  });

  it('names an unknown pre-TERM identity read as unknown', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => (pid === 10 ? base(pid) : ++reads >= 3 ? { kind: 'unknown' } : base(pid))
    });
    expect(result.events).toEqual([]);
    expect(result.output).toMatch(/identity could not be re-read, not signalled/);
  });

  it('does not call EPERM a terminated target', async () => {
    const result = await run(['--kill', '4242'], {
      probe: () => ({ kind: 'present', signalable: false })
    });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/cannot be signalled/);
  });

  it('does not call an unknown final probe a terminated target', async () => {
    const result = await run(['--kill', '4242'], { probe: () => ({ kind: 'unknown' }) });
    expect(result.status).toBe(1);
  });

  it('does not escalate a process that is gone during the grace period', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => (pid === 10 ? base(pid) : ++reads >= 4 ? { kind: 'absent' } : base(pid))
    });
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
    expect(result.status).toBe(0);
  });

  it('never force-kills if the identity becomes unknown before KILL', async () => {
    let reads = 0;
    const result = await run(['--kill', '4242'], {
      read: pid => (pid === 10 ? base(pid) : ++reads >= 5 ? { kind: 'unknown' } : base(pid))
    });
    expect(result.events).toEqual([[4242, 'SIGTERM']]);
    expect(result.status).toBe(1);
  });

  it('refuses a target that is its own ancestor even if it resembles Vitest', async () => {
    const table = new Map([
      [10, row(10, 4242, 'node inspector')],
      [4242, row(4242, 1)]
    ]);
    const result = await run(['--kill', '4242'], { table });
    expect(result.status).toBe(1);
    expect(result.events).toEqual([]);
  });
});
