import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/cleanup-test-processes.sh'
);

// The script reads process state through `ps`, so `ps` is where the tests take
// control. A stub on PATH answers from a fixture table, which makes every case
// below deterministic and, more importantly, lets the destructive path be
// exercised without a real process to kill: safety cases such as a malformed
// PID, a protected ancestor or a target that survives are precisely the ones
// that must not depend on whatever happens to be running on the machine.
//
// `sleep` is stubbed to return immediately (the script waits 2s between TERM
// and KILL) and `top` to print instantly, so the suite stays fast. Neither
// affects the behaviour under test.
let stubDir;

const writeStub = (name, body) => {
  const file = path.join(stubDir, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
};

beforeAll(() => {
  stubDir = mkdtempSync(path.join(tmpdir(), 'cleanup-stub-'));

  // Fixture format, one process per line: "<pid> <ppid> <command...>"
  writeStub(
    'ps',
    `#!/bin/bash
table="\${PS_TABLE:-/dev/null}"
args="$*"
target="\${args##*-p }"
case "$args" in
  *-eo*)
    cat "$table" 2>/dev/null
    ;;
  *"-o ppid="*)
    awk -v p="$target" '$1==p { print $2; f=1 } END { exit !f }' "$table"
    ;;
  *"-o command="*)
    awk -v p="$target" '$1==p { $1=""; $2=""; sub(/^ +/, ""); print; f=1 } END { exit !f }' "$table"
    ;;
  *"-o etime="*)
    awk -v p="$target" '$1==p { f=1 } END { exit !f }' "$table" && echo "05:00"
    ;;
  *)
    exit 1
    ;;
esac
`
  );
  writeStub('sleep', '#!/bin/bash\nexit 0\n');
  writeStub('top', '#!/bin/bash\necho "Processes: 1 total"\necho "CPU usage: 0.0% user"\n');
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

const text = stream => String(stream ?? '');

/** Write the fixture table the stub `ps` reads, and return its path. */
const writeTable = rows => {
  const table = path.join(stubDir, 'ps-table');
  writeFileSync(table, rows.length > 0 ? `${rows.join('\n')}\n` : '');
  return table;
};

/** Run the inspector with `ps` answering from the given fixture rows. */
const run = (args = [], processes = []) => {
  const table = writeTable(processes);
  const result = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PS_TABLE: table }
  });
  return Object.freeze({
    status: result.status,
    stdout: text(result.stdout),
    stderr: text(result.stderr)
  });
};

const VITEST = '4242 1 node /repo/node_modules/.bin/vitest run test/unit';

describe('cleanup-test-processes.sh - report mode', () => {
  it('lists a leftover Vitest process with its PID, parent and elapsed time', () => {
    const { status, stdout } = run([], [VITEST]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/PID\s+PPID\s+ELAPSED\s+COMMAND/);
    expect(stdout).toMatch(/^4242\s+1\s+05:00\s+node .*vitest/m);
  });

  it('terminates nothing, so the pre-push hook cannot kill a process', () => {
    const { status, stdout } = run([], [VITEST]);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/Sending TERM/);
    expect(stdout).not.toMatch(/sending KILL/);
  });

  it('exits 0 when there is nothing to report', () => {
    const { status, stdout } = run([], []);
    expect(status).toBe(0);
    expect(stdout).toMatch(/No Vitest processes found/);
  });

  it('ignores processes that are not Vitest', () => {
    const { stdout } = run([], ['4245 1 node /repo/index.js', '4246 1 /usr/bin/python3 app.py']);
    expect(stdout).toMatch(/No Vitest processes found/);
  });

  // Regression: a `grep -v grep` guard in the scan pipeline dropped every row
  // whose command contained "grep" anywhere, hiding real leftovers.
  it('lists a Vitest process whose command contains "grep"', () => {
    const { stdout } = run([], ['4243 1 node /w/grep-utils/node_modules/.bin/vitest greplike.js']);
    expect(stdout).toMatch(/^4243\s/m);
  });

  // Regression: excluding by this script's own name in the command hid Vitest
  // runs that legitimately carried the string, e.g. a worktree named after it.
  it('lists a Vitest process whose path is named after this script', () => {
    const { stdout } = run([], ['4244 1 node /w/fix-cleanup-test-processes/.bin/vitest']);
    expect(stdout).toMatch(/^4244\s/m);
  });
});

describe('cleanup-test-processes.sh - PID validation', () => {
  it.each([
    ['abc', 'a non-numeric argument'],
    ['-5', 'a negative number'],
    ['0', 'PID 0, since `kill 0` signals the whole process group'],
    ['00', 'a zero-padded PID 0'],
    ['12.5', 'a non-integer']
  ])('refuses to signal %s (%s)', pid => {
    const { status, stdout } = run(['--kill', pid], [VITEST]);
    expect(stdout).toMatch(new RegExp(`${pid.replace('.', '\\.')}: not a PID, skipped`));
    expect(stdout).toMatch(/Nothing to terminate/);
    expect(status).toBe(0);
  });

  it('refuses to signal PID 1', () => {
    const { status, stdout } = run(['--kill', '1'], ['1 0 node /repo/.bin/vitest run']);
    expect(stdout).toMatch(/1: is this script's own ancestor, skipped/);
    expect(stdout).toMatch(/Nothing to terminate/);
    expect(status).toBe(0);
  });

  // Regression: digit-only validation accepted "0001", which then failed to
  // match the " 1 " entry in the ancestry list, so the PID-1 guard was bypassed
  // even though `ps -p 0001` and `kill 0001` both address PID 1.
  it('refuses a zero-padded PID 1', () => {
    const { status, stdout } = run(['--kill', '0001'], ['1 0 node /repo/.bin/vitest run']);
    expect(stdout).toMatch(/is this script's own ancestor, skipped/);
    expect(stdout).not.toMatch(/Sending TERM/);
    expect(status).toBe(0);
  });

  it('skips a named PID that is not a Vitest process', () => {
    const { status, stdout } = run(['--kill', '4245'], ['4245 1 node /repo/index.js']);
    expect(stdout).toMatch(/4245: not a running Vitest process, skipped/);
    expect(status).toBe(0);
  });

  it('processes each PID in a multi-PID request independently', () => {
    const { stdout } = run(['--kill', '0', 'abc', '4245'], ['4245 1 node /repo/index.js']);
    expect(stdout).toMatch(/0: not a PID, skipped/);
    expect(stdout).toMatch(/abc: not a PID, skipped/);
    expect(stdout).toMatch(/4245: not a running Vitest process, skipped/);
  });
});

describe('cleanup-test-processes.sh - exit status', () => {
  // A PID that `ps` reports as a live Vitest process but that cannot actually
  // be signalled: the shape of another user's process. Kill mode must not
  // report success when the requested process is still running.
  it('exits non-zero when a requested target survives', () => {
    const { status, stdout } = run(['--kill', '999991'], ['999991 1 node /repo/.bin/vitest run']);
    expect(stdout).toMatch(/999991: (still running|could not be signalled)/);
    expect(status).toBe(1);
  });

  it('exits 2 on an unknown option', () => {
    const { status, stderr } = run(['--bogus']);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unknown option/);
  });

  it('exits 2 when --kill is given no PIDs', () => {
    const { status, stderr } = run(['--kill']);
    expect(status).toBe(2);
    expect(stderr).toMatch(/needs at least one PID/);
  });

  it('documents its exit status in --help and exits 0', () => {
    const { status, stdout } = run(['--help']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Exit status/);
    expect(stdout).toMatch(/--kill PID/);
  });

  it('survives a garbled ps result instead of aborting silently', () => {
    // `[[ "$pid" -gt 1 ]]` on a non-numeric value is fatal under `set -u`:
    // bash reads the word as a variable name and exits. Every ps result is
    // validated before any arithmetic, so a broken ps must not kill the run.
    const { status, stdout } = run([], ['not-a-number bogus node /repo/.bin/vitest']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/WARP Test Process Inspector/);
  });
});
