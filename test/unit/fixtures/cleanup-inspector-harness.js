// Test harness for the process-inspector suite: stub installation, the runners
// that drive the script, and the signal mocks. This is fixture code rather than
// tests, and it lives here so the suite file stays tests.
//
// Every runner returns a frozen { status, stdout, stderr }. `run` and
// `runWithKillMocked` write the fixture table for you; `invoke` takes a table
// path directly, for cases that need to write one themselves.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PS_STUB, SLEEP_STUB, TOP_STUB } from './cleanup-inspector-stubs.js';

export const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/cleanup-test-processes.sh'
);

export const VITEST = '4242 1 node /repo/node_modules/.bin/vitest run test/unit';

// `kill` is a shell builtin, so a PATH stub cannot intercept it — a test that
// names a PID would signal whatever real process happens to hold that number.
// Bash does import functions from the environment, and a function shadows the
// builtin, so this replaces signalling itself for the duration of the run. No
// real signal is sent, and the script needs no test-only seam to allow it.
export const KILL_MOCK = { 'BASH_FUNC_kill%%': '() { echo "MOCK-KILL $*"; return 0; }' };

// A mock kill that fails, standing in for EPERM on another user's process:
// both `kill` and `kill -0` are denied.
export const KILL_MOCK_DENIED = { 'BASH_FUNC_kill%%': '() { return 1; }' };

// Signals land, but the `kill -0` existence probe fails: ESRCH, the target has
// exited. The mirror image of KILL_MOCK_DENIED, where the same probe fails for
// EPERM on a process that is very much alive -- `kill -0` reports both
// identically, which is why nothing here may read it as proof of survival.
export const KILL_MOCK_NO_PROBE = {
  'BASH_FUNC_kill%%': '() { case "${1:-}" in -0) return 1 ;; esac; echo "MOCK-KILL $*"; return 0; }'
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

export const ABSENT_PID = findAbsentPid();

const text = stream => String(stream ?? '');

let stubDir;

const writeStub = (name, body) => {
  const file = path.join(stubDir, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
};

// The script reads process state through `ps`, so `ps` is where the tests take
// control. A stub on PATH answers from a fixture table, which makes every case
// deterministic and, more importantly, lets the destructive path be exercised
// without a real process to kill: safety cases such as a malformed PID, a
// protected ancestor or a target that survives are precisely the ones that must
// not depend on whatever happens to be running on the machine.
//
// `sleep` is stubbed to return immediately (the script waits 2s between TERM
// and KILL) and `top` to print instantly, so the suite stays fast. Neither
// affects the behaviour under test.
export const installStubs = () => {
  stubDir = mkdtempSync(path.join(tmpdir(), 'cleanup-stub-'));
  writeStub('ps', PS_STUB);
  writeStub('sleep', SLEEP_STUB);
  writeStub('top', TOP_STUB);
};

export const removeStubs = () => {
  rmSync(stubDir, { recursive: true, force: true });
};

/** A path inside the stub directory, for the marker and counter files the
 *  stubs use to sequence a failure across successive calls. */
export const stubFile = name => path.join(stubDir, name);

/** Write the fixture table the stub `ps` reads, and return its path. */
export const writeTable = rows => {
  const table = path.join(stubDir, 'ps-table');
  writeFileSync(table, rows.length > 0 ? `${rows.join('\n')}\n` : '');
  return table;
};

/** `opts` is passed through to spawnSync -- `cwd` matters for the glob case,
 *  which has to run somewhere holding a file named like a PID. */
export const invoke = (args, table, extraEnv, opts = {}) => {
  const result = spawnSync(SCRIPT, args, {
    ...opts,
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
export const run = (args = [], processes = []) => invoke(args, writeTable(processes), {});

/** Run with signalling mocked out: nothing on the host is ever signalled. */
export const runWithKillMocked = (args, processes, extra = {}) =>
  invoke(args, writeTable(processes), { ...KILL_MOCK, ...extra });

/** Run with one external tool replaced by a failing stub, to prove the
 *  guards do not silently depend on it. */
export const runWithBrokenTool = (tool, args, processes, extraEnv = {}) => {
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
