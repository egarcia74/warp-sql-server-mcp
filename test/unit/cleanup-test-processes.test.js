import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ABSENT_PID,
  KILL_MOCK,
  KILL_MOCK_DENIED,
  KILL_MOCK_NO_PROBE,
  VITEST,
  installStubs,
  invoke,
  removeStubs,
  run,
  runWithBrokenTool,
  runWithKillMocked,
  stubFile,
  writeTable
} from './fixtures/cleanup-inspector-harness.js';

// The harness installs stubbed `ps`, `sleep` and `top` on PATH. See
// fixtures/cleanup-inspector-harness.js for what each runner does, and
// fixtures/cleanup-inspector-stubs.js for the env knobs the stubs honour.
beforeAll(installStubs);
afterAll(removeStubs);

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
    // A refused request is an unfulfilled one, so automation must see non-zero.
    expect(status).toBe(1);
  });

  // Regression: digit-only validation accepted "0001", which then failed to
  // match the " 1 " entry in the ancestry list, so the PID-1 guard was bypassed
  // even though `ps -p 0001` and `kill 0001` both address PID 1.
  it('refuses a zero-padded PID 1', () => {
    const { status, stdout } = run(['--kill', '0001'], ['1 0 node /repo/.bin/vitest run']);
    expect(stdout).toMatch(/is this script's own ancestor, skipped/);
    expect(stdout).not.toMatch(/Sending TERM/);
    expect(status).toBe(1);
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

  it('refuses to send TERM when a different process took the PID after validation', () => {
    // PS_LSTART_DRIFT changes the start time from the second lookup onward, and
    // the second lookup is the TERM loop's own re-check -- so this exercises the
    // guard immediately before TERM, not the later escalation decision (that one
    // is covered separately, keyed on the "not escalated" message).
    const marker = stubFile('drifted');
    rmSync(marker, { force: true });
    const { stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      {
        ...KILL_MOCK,
        PS_LSTART_DRIFT: marker
      }
    );
    expect(stdout).toMatch(
      new RegExp(`${ABSENT_PID}: a different process now holds this PID, not signalled`)
    );
    // No signal at all, not merely no KILL: the target was never TERMed.
    expect(stdout).not.toMatch(/MOCK-KILL/);
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

  // The pre-KILL check is identity-only by design, and that claim has now gone
  // stale twice in places a docs edit missed. Pin the mechanism rather than the
  // prose: --help must describe the start-time check, not promise that the
  // command line is re-verified before every signal.
  it('describes the pre-KILL check as identity-based in --help', () => {
    const { stdout } = run(['--help']);
    expect(stdout).toMatch(/start time/);
    expect(stdout).not.toMatch(/re-verified as a Vitest process immediately before/);
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
    const { stdout } = invoke(['--kill', '*'], writeTable([VITEST]), KILL_MOCK, { cwd });
    rmSync(cwd, { recursive: true, force: true });
    expect(stdout).toMatch(/\*: not a PID, skipped/);
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(stdout).not.toMatch(/Sending TERM/);
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

describe('cleanup-test-processes.sh - when the process table cannot be read', () => {
  // Regression: `ps -eo` piped straight into the filter loop made a failed
  // scan indistinguishable from an empty one -- no rows, `scan` returning 0,
  // and the report announcing "No Vitest processes found" having inspected
  // nothing. The pre-push hook would read that as a clean system.
  it('says it inspected nothing rather than reporting a clean system', () => {
    const { status, stdout } = runWithBrokenTool('ps', [], [VITEST]);
    expect(stdout).toMatch(/process table could not be read/);
    expect(stdout).toMatch(/NOT a report that the system is clean/);
    expect(stdout).not.toMatch(/No Vitest processes found/);
    // Still safe for the hook to call.
    expect(status).toBe(0);
  });
});

describe('cleanup-test-processes.sh - identity at the moment of KILL', () => {
  // Regression: ESCALATE was built in one pass and signalled in another, and
  // the KILL loop re-checked only `is_vitest`. With several targets, an
  // earlier one could exit and have its number reissued in between, and the
  // replacement would take SIGKILL having never received TERM.
  it('does not escalate a PID whose identity changed during the grace period', () => {
    // PS_LSTART_AFTER=2 drifts from the third lookup: validation and the
    // pre-TERM re-check both match, so TERM goes out, and the drift lands
    // exactly on the escalation decision. Without that check the survivor
    // would be force-killed having never itself received TERM.
    const counter = stubFile('lstart-escalate-count');
    rmSync(counter, { force: true });
    const { stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_LSTART_AFTER: '2', PS_LSTART_COUNT: counter }
    );
    expect(stdout).toMatch(new RegExp(`MOCK-KILL ${ABSENT_PID}`));
    expect(stdout).toMatch(
      new RegExp(`${ABSENT_PID}: a different process now holds this PID, not escalated`)
    );
    expect(stdout).not.toMatch(/MOCK-KILL -9/);
  });

  it('does not KILL a PID whose identity changed after escalation was decided', () => {
    const counter = stubFile('lstart-count');
    rmSync(counter, { force: true });
    const { stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_LSTART_AFTER: '3', PS_LSTART_COUNT: counter }
    );
    // TERM went out and escalation was decided, then the identity changed.
    expect(stdout).toMatch(new RegExp(`MOCK-KILL ${ABSENT_PID}`));
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: no longer the process that was signalled`));
    expect(stdout).not.toMatch(/MOCK-KILL -9/);
  });
});

describe('cleanup-test-processes.sh - when a target renames itself', () => {
  // Regression: escalation and the outcome report both keyed off `is_vitest`,
  // so a SIGTERM handler that rewrites its own argv while refusing to exit was
  // dropped from escalation and reported "terminated" with exit 0. Reproduced
  // for real with a Node process whose SIGTERM handler set process.title: the
  // script printed "✅ terminated" while `kill -0` still succeeded.
  it('escalates and reports honestly when the command line changes', () => {
    const counter = stubFile('rename-count');
    rmSync(counter, { force: true });
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_RENAME_AFTER: '2', PS_RENAME_COUNT: counter }
    );
    // Identity is unchanged, so the rename must not be read as an exit.
    expect(stdout).toMatch(new RegExp(`MOCK-KILL -9 ${ABSENT_PID}`));
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: still running`));
    expect(stdout).not.toMatch(new RegExp(`${ABSENT_PID}: terminated`));
    expect(status).toBe(1);
  });
});

describe('cleanup-test-processes.sh - when no start time is available', () => {
  // Regression: with no identity to capture, the target was TERMed and then
  // reported "✅ terminated" with exit 0 because the post-TERM comparison could
  // never match -- while the same run said "1 Vitest process(es) remain".
  it('refuses to signal a target whose identity cannot be captured', () => {
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_NO_LSTART: '1' }
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: no start time available, skipped`));
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(stdout).not.toMatch(/terminated/);
    expect(status).toBe(1);
  });
});

describe('cleanup-test-processes.sh - when the start time comes back blank', () => {
  // Regression: `identity_of` printed the `lstart_` prefix unconditionally, so a
  // ps that exited 0 while printing nothing yielded the constant identity
  // `lstart_`. Non-empty, so the "no identity, no signal" refusal was bypassed
  // and the target was TERMed and force-killed; worse, the same constant
  // compares equal for EVERY PID whose lookup degrades that way, so a recycled
  // number would pass the pre-KILL identity check.
  it('refuses to signal when ps answers with a blank start time', () => {
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_LSTART_EMPTY: '1' }
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: no start time available, skipped`));
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(stdout).not.toMatch(/terminated/);
    expect(status).toBe(1);
  });
});

describe('cleanup-test-processes.sh - when a target cannot be classified', () => {
  // Regression: `is_vitest` returned the same status for "ps says this is not
  // Vitest" and "the ps lookup failed", so a live named PID whose `command=`
  // lookup was denied or failed transiently was reported "not a running Vitest
  // process, skipped" -- a positive claim about a process never classified --
  // and kill mode exited 0, telling automation the request had succeeded.
  it('reports an unclassifiable live target as unknown, not as not-Vitest', () => {
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_COMMAND_FAIL_FOR: ABSENT_PID }
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: could not be classified`));
    expect(stdout).not.toMatch(/not a running Vitest process/);
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(status).toBe(1);
  });

  // The re-check in the TERM loop has the same two-into-three problem.
  it('does not signal a target it can no longer re-classify', () => {
    const counter = stubFile('command-count');
    rmSync(counter, { force: true });
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_COMMAND_FAIL_AFTER: '1', PS_COMMAND_COUNT: counter }
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: could not be re-classified, not signalled`));
    // No TERM and no KILL. The `MOCK-KILL -0` that does appear is the outcome
    // loop's liveness probe, and the target staying in the report -- rather
    // than being dropped as it was at validation -- is the point: an
    // unsignalled PID is still accounted for, and still fails the run.
    expect(stdout).not.toMatch(new RegExp(`MOCK-KILL ${ABSENT_PID}`));
    expect(stdout).not.toMatch(/MOCK-KILL -9/);
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: still running`));
    expect(status).toBe(1);
  });
});

describe('cleanup-test-processes.sh - when the final existence probe fails', () => {
  // Regression: the outcome loop read a failed `kill -0` as "alive but not
  // ours" and reported "still running and cannot be signalled" with exit 1.
  // `kill -0` cannot tell ESRCH from EPERM -- the ambiguity every other
  // liveness check here was deliberately moved off `kill -0` to avoid -- so a
  // target that exited between the identity read and the probe was reported as
  // an unsignallable survivor. That window is likeliest at the end of the
  // post-KILL wait: the moment cleanup has just succeeded.
  it('reports a target ps cannot see as terminated, not as unsignallable', () => {
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK_NO_PROBE, PS_PID_ABSENT: ABSENT_PID }
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: terminated`));
    expect(stdout).not.toMatch(/cannot be signalled/);
    expect(status).toBe(0);
  });

  // The other half of the same branch: `ps` CAN see it, so the failed probe
  // really was EPERM and the target really did survive.
  it('still reports a live process it may not signal as unsignallable', () => {
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK_NO_PROBE }
    );
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: still running and cannot be signalled`));
    expect(status).toBe(1);
  });
});

describe('cleanup-test-processes.sh - unknown outcomes', () => {
  // Regression: an identity captured at validation whose re-read failed at
  // final verification was reported "✅ terminated" with exit 0, because
  // unreadable was equated with gone. The process was demonstrably still alive.
  it('reports an unknown outcome, not success, when the identity cannot be re-read', () => {
    const counter = stubFile('lstart-fail-count');
    rmSync(counter, { force: true });
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_LSTART_FAIL_AFTER: '4', PS_LSTART_COUNT: counter }
    );
    expect(stdout).toMatch(/identity could not be re-read/);
    expect(stdout).toMatch(/outcome unknown/);
    expect(stdout).not.toMatch(new RegExp(`✅ ${ABSENT_PID}: terminated`));
    expect(status).toBe(1);
  });

  // Regression: an inconclusive descendant check skipped safely but exited 0,
  // so a live target was left untouched while the run reported success.
  it('fails when the descendant check cannot conclude', () => {
    const { status, stdout } = invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      { ...KILL_MOCK, PS_PPID_FAIL_FOR: ABSENT_PID }
    );
    expect(stdout).toMatch(/could not verify it is not this script's own child/);
    expect(stdout).not.toMatch(/MOCK-KILL/);
    expect(status).toBe(1);
  });

  // Guard against the fix above over-reaching: a PID that simply no longer
  // exists fails the same `ps -o ppid=` lookup, and must stay a benign no-op
  // rather than an inconclusive failure.
  it('treats an already-gone PID as a benign no-op', () => {
    const { status, stdout } = runWithKillMocked(['--kill', ABSENT_PID], []);
    expect(stdout).toMatch(new RegExp(`${ABSENT_PID}: not a running Vitest process, skipped`));
    expect(stdout).not.toMatch(/could not verify/);
    expect(status).toBe(0);
  });
});

describe('cleanup-test-processes.sh - liveness without signal permission', () => {
  const lateIdentityFailure = extra => {
    const counter = stubFile(`lstart-eperm-${Math.random().toString(36).slice(2)}`);
    rmSync(counter, { force: true });
    return invoke(
      ['--kill', ABSENT_PID],
      writeTable([`${ABSENT_PID} 1 node /repo/.bin/vitest run`]),
      {
        ...KILL_MOCK_DENIED,
        PS_LSTART_FAIL_AFTER: '2',
        PS_LSTART_COUNT: counter,
        ...extra
      }
    );
  };

  // Regression: the `kill -0` fallback could not tell ESRCH from EPERM, so
  // another user's live process whose identity re-read failed was reported
  // "✅ terminated" with exit 0 - the same permission ambiguity the script
  // had already moved off `kill -0` to avoid.
  it('reports unknown, not terminated, when the process is alive but unsignallable', () => {
    const { status, stdout } = lateIdentityFailure({});
    expect(stdout).toMatch(/still alive, but its identity could not be re-read/);
    expect(stdout).not.toMatch(new RegExp(`✅ ${ABSENT_PID}: terminated`));
    expect(status).toBe(1);
  });

  // ps working and unable to see the PID positively establishes that it is
  // gone, without needing a signal permission we may not have.
  it('reports terminated when ps works and the PID is absent', () => {
    const { status, stdout } = lateIdentityFailure({ PS_PID_ABSENT: ABSENT_PID });
    expect(stdout).toMatch(new RegExp(`✅ ${ABSENT_PID}: terminated`));
    expect(stdout).not.toMatch(/outcome unknown/);
    expect(status).toBe(0);
  });

  it('reports unknown when ps cannot answer at all', () => {
    const { status, stdout } = lateIdentityFailure({ PS_NOT_ANSWERING: '1' });
    expect(stdout).toMatch(/liveness could not be established/);
    expect(stdout).not.toMatch(new RegExp(`✅ ${ABSENT_PID}: terminated`));
    expect(status).toBe(1);
  });
});

describe('cleanup-test-processes.sh - when a target becomes a zombie', () => {
  // Regression: a target that exits under a parent that does not reap it keeps
  // its PID, its start time and its process-table row, and `kill -0` still
  // succeeds - verified on a real zombie: state=Z, lstart unchanged,
  // `ps -o pid=` sees it. Every liveness signal said "alive", so a completed
  // termination was reported as still running and kill mode failed forever.
  it('reports a zombie as terminated, not still running', () => {
    const { status, stdout } = runWithKillMocked(
      ['--kill', ABSENT_PID],
      [`${ABSENT_PID} 1 node /repo/.bin/vitest run`],
      { PS_STATE: 'Z' }
    );
    expect(stdout).toMatch(/terminated \(exited; its parent has not reaped it yet\)/);
    expect(stdout).not.toMatch(/still running/);
    expect(stdout).not.toMatch(/sending KILL/);
    expect(status).toBe(0);
  });

  it('still reports a running target as running', () => {
    const { status, stdout } = runWithKillMocked(
      ['--kill', ABSENT_PID],
      [`${ABSENT_PID} 1 node /repo/.bin/vitest run`],
      { PS_STATE: 'S' }
    );
    expect(stdout).toMatch(/still running/);
    expect(status).toBe(1);
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
    const marker = stubFile('ppid-break');
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
    const marker = stubFile('ppid-break-report');
    rmSync(marker, { force: true });
    const { status, stdout } = invoke([], writeTable([VITEST]), { PS_PPID_BREAK: marker });
    expect(status).toBe(0);
    expect(stdout).toMatch(/^4242\s/m);
    expect(stdout).toMatch(/ancestry could not be walked completely/);
  });
});
