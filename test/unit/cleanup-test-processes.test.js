import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
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

  // Fixture format, one process per line: "<pid> <ppid> <command...>".
  // PIDs absent from the fixture are delegated to the real `ps`, so the
  // script's own ancestry walk still resolves and only the simulated
  // processes are synthetic.
  writeStub(
    'ps',
    `#!/bin/bash
table="\${PS_TABLE:-/dev/null}"
args="$*"
target="\${args##*-p }"
known() { awk -v p="$target" '$1==p { f=1 } END { exit !f }' "$table"; }
case "$args" in
  *-eo*)
    cat "$table" 2>/dev/null
    ;;
  *"-o ppid="*)
    # With PS_PPID_BREAK set, the first lookup answers and every later one
    # fails: an ancestry walk that stops partway up.
    if [ -n "\${PS_PPID_BREAK:-}" ]; then
      if [ -f "$PS_PPID_BREAK" ]; then exit 1; fi
      : > "$PS_PPID_BREAK"
      echo "55555"
      exit 0
    fi
    known || exec /bin/ps "$@"
    awk -v p="$target" '$1==p { print $2 }' "$table"
    ;;
  *"-o command="*)
    known || exec /bin/ps "$@"
    awk -v p="$target" '$1==p { $1=""; $2=""; sub(/^ +/, ""); print }' "$table"
    ;;
  *"-o etime="*)
    known || exec /bin/ps "$@"
    echo "05:00"
    ;;
  *"-o lstart="*)
    known || exec /bin/ps "$@"
    if [ -n "\${PS_LSTART_DRIFT:-}" ]; then
      if [ -f "$PS_LSTART_DRIFT" ]; then echo "Mon Sep  7 11:11:11 2026"; exit 0; fi
      : > "$PS_LSTART_DRIFT"
    fi
    echo "Mon Sep  7 09:00:00 2026"
    ;;
  *)
    exec /bin/ps "$@"
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

const invoke = (args, table, extraEnv) => {
  const result = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, PS_TABLE: table, ...extraEnv }
  });
  return Object.freeze({
    status: result.status,
    stdout: text(result.stdout),
    stderr: text(result.stderr)
  });
};

/** Run the inspector with `ps` answering from the given fixture rows. */
const run = (args = [], processes = []) => invoke(args, writeTable(processes), {});

// `kill` is a shell builtin, so a PATH stub cannot intercept it — a test that
// names a PID would signal whatever real process happens to hold that number.
// Bash does import functions from the environment, and a function shadows the
// builtin, so this replaces signalling itself for the duration of the run. No
// real signal is sent, and the script needs no test-only seam to allow it.
const KILL_MOCK = { 'BASH_FUNC_kill%%': '() { echo "MOCK-KILL $*"; return 0; }' };

/** Run with signalling mocked out: nothing on the host is ever signalled. */
const runWithKillMocked = (args, processes) => invoke(args, writeTable(processes), KILL_MOCK);

/** Run with one external tool replaced by a failing stub, to prove the
 *  guards do not silently depend on it. */
const runWithBrokenTool = (tool, args, processes, extraEnv = {}) => {
  const brokenDir = mkdtempSync(path.join(tmpdir(), `cleanup-no-${tool}-`));
  const broken = path.join(brokenDir, tool);
  writeFileSync(broken, '#!/bin/bash\nexit 1\n');
  chmodSync(broken, 0o755);
  try {
    const result = spawnSync(SCRIPT, args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${brokenDir}:${stubDir}:${process.env.PATH}`,
        PS_TABLE: writeTable(processes),
        ...extraEnv
      }
    });
    return Object.freeze({
      status: result.status,
      stdout: text(result.stdout),
      stderr: text(result.stderr)
    });
  } finally {
    rmSync(brokenDir, { recursive: true, force: true });
  }
};

// `identity_of` reads /proc/<pid>/stat when it can, so a fixture PID that
// happens to exist on a Linux runner resolves through the real procfs and the
// stubbed `ps` is bypassed entirely -- which would make the identity tests
// depend on unrelated host process allocation. These tests therefore use a PID
// verified absent from this host, so /proc cannot answer for it and the stub
// is the only source.
const findAbsentPid = () => {
  for (let pid = 4194303; pid > 4193000; pid -= 1) {
    if (existsSync(`/proc/${pid}`)) continue;
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') return String(pid);
    }
  }
  throw new Error('could not find a PID absent from this host');
};

const ABSENT_PID = findAbsentPid();

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

  it('survives a garbled ps result instead of aborting silently', () => {
    // `[[ "$pid" -gt 1 ]]` on a non-numeric value is fatal under `set -u`:
    // bash reads the word as a variable name and exits. Every ps result is
    // validated before any arithmetic, so a broken ps must not kill the run.
    const { status, stdout } = run([], ['not-a-number bogus node /repo/.bin/vitest']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/WARP Test Process Inspector/);
  });

  it('processes each PID in a multi-PID request independently', () => {
    const { stdout } = run(['--kill', '0', 'abc', '4245'], ['4245 1 node /repo/index.js']);
    expect(stdout).toMatch(/0: not a PID, skipped/);
    expect(stdout).toMatch(/abc: not a PID, skipped/);
    expect(stdout).toMatch(/4245: not a running Vitest process, skipped/);
  });
});

describe('cleanup-test-processes.sh - exit status', () => {
  // `ps` keeps reporting the target as a live Vitest process and signalling is
  // mocked, so the script sees a process that refuses to die: the shape of
  // another user's process. Kill mode must not report success then.
  it('exits non-zero when a requested target survives', () => {
    const { status, stdout } = runWithKillMocked(
      ['--kill', ABSENT_PID],
      [`${ABSENT_PID} 1 node /repo/.bin/vitest run`]
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: still running`));
    expect(status).toBe(1);
  });

  it('escalates TERM to KILL for a target that does not exit', () => {
    const { stdout } = runWithKillMocked(
      ['--kill', ABSENT_PID],
      [`${ABSENT_PID} 1 node /repo/.bin/vitest run`]
    );
    expect(stdout).toMatch(new RegExp(`Sending TERM to: ${ABSENT_PID}`));
    expect(stdout).toMatch(new RegExp(`sending KILL to: ${ABSENT_PID}`));
    // Proof no host process was signalled: every signal went to the mock.
    expect(stdout).toMatch(new RegExp(`MOCK-KILL ${ABSENT_PID}`));
    expect(stdout).toMatch(new RegExp(`MOCK-KILL -9 ${ABSENT_PID}`));
  });

  it('rejects an all-digit PID that overflows Bash arithmetic', () => {
    // $((10#18446744073709555859)) wraps to 4243, so this argument would
    // otherwise validate and signal an unrelated process.
    const { status, stdout } = runWithKillMocked(
      ['--kill', '18446744073709555859'],
      ['4243 1 node /repo/.bin/vitest run']
    );
    expect(stdout).toMatch(/18446744073709555859: not a PID, skipped/);
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(status).toBe(0);
  });

  it('does not escalate when a different process has taken the PID', () => {
    // The start time the script recorded before TERM no longer matches, so the
    // number surviving must not be read as "our target survived".
    const marker = path.join(stubDir, 'drifted');
    rmSync(marker, { force: true });
    const { stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      {
        ...KILL_MOCK,
        PS_LSTART_DRIFT: marker
      }
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: a different process now holds this PID`));
    expect(stdout).not.toMatch(/MOCK-KILL -9/);
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
});

describe('cleanup-test-processes.sh - argument handling', () => {
  // Regression: PID arguments were held in a string and iterated unquoted, so
  // the shell applied pathname expansion to them. `--kill '*'` run in a
  // directory holding a file named 4242 turned that filename into an
  // explicitly named PID -- exactly what this script promises never to do.
  it('does not expand a glob argument against the working directory', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'cleanup-glob-'));
    writeFileSync(path.join(cwd, '4242'), '');
    const result = spawnSync(SCRIPT, ['--kill', '*'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        PS_TABLE: writeTable([VITEST]),
        ...KILL_MOCK
      }
    });
    rmSync(cwd, { recursive: true, force: true });
    expect(text(result.stdout)).toMatch(/\*: not a PID, skipped/);
    expect(text(result.stdout)).not.toMatch(/MOCK-KILL/);
    expect(text(result.stdout)).not.toMatch(/Sending TERM/);
  });
});

describe('cleanup-test-processes.sh - when `sleep` fails', () => {
  // Regression: the grace period between TERM and KILL is the `sleep`. With
  // `set -e` off, a failed `sleep` let execution continue straight into
  // escalation, collapsing TERM-then-KILL into an immediate KILL.
  it('sends TERM but refuses to escalate to KILL', () => {
    const { stdout } = runWithBrokenTool(
      'sleep',
      ['--kill', ABSENT_PID],
      [`${ABSENT_PID} 1 node /repo/.bin/vitest run`],
      KILL_MOCK
    );
    expect(stdout).toMatch(new RegExp(`MOCK-KILL ${ABSENT_PID}`));
    expect(stdout).toMatch(/grace period could not be waited out/);
    expect(stdout).not.toMatch(/MOCK-KILL -9/);
    expect(stdout).not.toMatch(/sending KILL/);
  });
});

describe('cleanup-test-processes.sh - when `tr` fails', () => {
  // Regression: the ancestry list was assembled with `ps ... | tr`, so the
  // "unconditional" PID-1 guard was conditional on `tr` working. With `tr`
  // failing, ANCESTRY came back empty, every `case "$ANCESTRY"` test missed,
  // and in a container whose PID 1 is Vitest the previous revision printed
  // "Sending TERM to: 1" and signalled it.
  it('still protects PID 1 when `tr` fails', () => {
    const { stdout } = runWithBrokenTool(
      'tr',
      ['--kill', '1'],
      ['1 0 node /app/node_modules/.bin/vitest run'],
      KILL_MOCK
    );
    expect(stdout).toMatch(/1: is this script's own ancestor, skipped/);
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(stdout).not.toMatch(/Sending TERM/);
  });

  it('still reports processes when `tr` fails', () => {
    const { status, stdout } = runWithBrokenTool('tr', [], [VITEST]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^4242\s/m);
  });
});

describe('cleanup-test-processes.sh - when the ancestry walk breaks', () => {
  // Regression: `self_ancestry` returned success even when a `ps` lookup
  // failed partway up, so every ancestor above the break was missing from
  // ANCESTRY while the "does it contain PID 1" sanity check still passed --
  // PID 1 is seeded. The previous revision then accepted `--kill` on the
  // Vitest process that had launched it, printing "Sending TERM to: 77777".
  it('refuses to signal when the ancestry walk cannot be completed', () => {
    const marker = path.join(stubDir, 'ppid-break');
    rmSync(marker, { force: true });
    const { status, stderr, stdout } = invoke(
      ['--kill', '77777'],
      writeTable(['77777 55555 node /w/node_modules/.bin/vitest run']),
      { ...KILL_MOCK, PS_PPID_BREAK: marker }
    );
    expect(stderr).toMatch(/ancestry could not be walked completely/);
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(stdout).not.toMatch(/Sending TERM/);
    expect(status).toBe(3);
  });

  it('still lists processes, with a warning, when the walk is incomplete', () => {
    const marker = path.join(stubDir, 'ppid-break-report');
    rmSync(marker, { force: true });
    const { status, stdout } = invoke([], writeTable([VITEST]), { PS_PPID_BREAK: marker });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^4242\s/m);
    expect(stdout).toMatch(/ancestry could not be walked completely/);
  });
});
