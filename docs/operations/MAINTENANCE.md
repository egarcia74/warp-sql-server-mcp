# 🛠️ System Maintenance Guide

> **Audience**: Operators inspecting leftover test processes and terminating them by PID

This guide covers essential maintenance tasks for the WARP SQL Server MCP project to keep your development environment running optimally.

## 🧹 Process Cleanup

### Problem: Memory-Heavy Test Processes

During intensive testing sessions (like our comprehensive 1,132-test unit suite), Node.js/Vitest processes can sometimes become orphaned and consume significant system resources:

- **Symptoms**: High CPU usage (100%+), excessive memory consumption (500MB+ per process), system slowdown
- **Root Cause**: Test worker processes not terminating cleanly after test completion
- **Impact**: System performance degradation, memory exhaustion

### Solution: Inspect First, Then Terminate by PID

Nothing below reclaims resources on its own. The inspector **lists** processes and terminates
only the PIDs you name, because process state cannot tell an adopted orphan from a process a
service manager started deliberately (see [Why there is no automatic orphan
mode](#script-features)).

#### 🚀 **Inspect (Recommended First Step)**

```bash
# List leftover test processes with PID, PPID, elapsed time and command.
# Terminates nothing; exits 0.
npm run cleanup

# Alternative command (same functionality)
npm run cleanup:processes

# Terminate the ones you judged stale, by PID
npm run cleanup -- --kill 12345 12346
```

#### 🔧 **Manual Inspection**

```bash
# 1. Identify problem processes
ps aux | grep -E "(node|vitest)" | grep -v grep

# 2. Run the inspector directly (lists only)
./scripts/cleanup-test-processes.sh

# 3. Terminate a specific process (if needed) - prefer the inspector, which
#    re-verifies the PID and sends TERM before escalating to KILL
npm run cleanup -- --kill <process_id>
```

#### ⚙️ **Automated Prevention**

The **inspection** is integrated into:

1. **Pre-Push Git Hook**: lists leftover processes before running tests, and terminates none of
   them - a push can never kill a process
2. **NPM Scripts**: easy access via `npm run cleanup`
3. **Development Workflow**: part of quality gate enforcement

Terminating is never automatic; it always takes an explicit `--kill PID`.

### Script Features

The `cleanup-test-processes.sh` script:

- ✅ **Lists, never selects**: With no arguments it prints every Vitest process with its **PID,
  PPID, elapsed time and full command**, then exits 0. It terminates nothing. The pre-push hook
  calls it this way, so pushing cannot kill a process.
- ✅ **Kills only what you name**: `npm run cleanup -- --kill <pid> [<pid>...]`. There is no
  "kill all orphans" mode, because there is no sound way to identify one — see below.
- ✅ **Re-verifies before every signal**, but not with the same check each time. Before `TERM` a
  PID must still be a Vitest process **and** still be the process whose start time was recorded.
  Before `KILL` only the start time is re-checked, deliberately: a target can rewrite its own
  command line, so requiring it to still look like Vitest would let a `SIGTERM` handler rename
  itself out of being force-killed. The check and the signal are separate operations either way, so
  this narrows the recycled-PID window rather than closing it; the residual race is microscopic but
  real.
- ✅ **Checks identity, not just the number**: a PID can be released and reissued during the wait
  between `TERM` and `KILL`, so each target's start time is recorded before signalling and compared
  before signalling, before escalating and before reporting its outcome. On Linux that start time
  comes from `/proc/<pid>/stat` in clock ticks since boot (~10ms). On macOS there is no procfs and
  `ps -o lstart=` is whole seconds, so a PID reissued **within the same second** to another Vitest
  process that also started in that second would still match. That window is far narrower than the
  two-second wait it guards, and the alternative — refusing to terminate anything when a
  finer-grained identity is unavailable — would disable `--kill` on macOS altogether.
- ✅ **Graceful before forceful**: only PIDs that `TERM` actually reached, and whose identity still
  matches, can be escalated to `KILL`. A process that appears during the wait is never force-killed
  without a chance to exit.
- ✅ **Honest per-PID outcomes**: liveness is checked with `ps`, not `kill -0`. `kill -0` fails with
  `EPERM` for a process owned by another user, which is indistinguishable from "gone" — so that
  case used to be silently dropped and reported as success. Each PID now reports terminated, still
  running, or still running and unsignallable. That applies to the final probe as well, which is
  the one place the rule had not been carried through: a failed `kill -0` there was read as "alive
  but not ours", so a target exiting between the identity read and the probe — likeliest right at
  the end of the post-`KILL` wait, the moment cleanup has just succeeded — was reported as an
  unsignallable survivor. Failure of that probe is now resolved with `ps`: visible means `EPERM` on
  a live process, invisible with `ps` answering means gone, and `ps` not answering means unknown.
  Classification is three-valued for the same reason: a target whose command line cannot be read is
  reported as unclassifiable and fails the run, rather than being asserted to be "not a running
  Vitest process" — which would be a claim about a process nothing had managed to inspect. A PID
  that has simply exited stays a benign no-op, since `ps` answering and not seeing it is real
  evidence. Once a target has been signalled, whether it is
  still alive is decided by its **start time**, never by its command line: a process can rewrite
  its own `argv` (Node exposes this as `process.title`), so a `SIGTERM` handler that renames itself
  while refusing to exit would otherwise be reported as terminated while still running. A target
  whose start time cannot be read is **not signalled**: without it nothing downstream could
  tell "exited" from "still there", so the run refuses and says so rather than sending a signal it
  cannot account for. That covers a `ps` which fails outright and one which exits 0 while printing
  nothing — a blank answer is treated as no identity, not as an identity that happens to be blank,
  because the latter would compare equal for every PID whose lookup degraded the same way.
- ✅ **Cannot abort a push**: the closing system-status display can never affect the exit status.
- ✅ **Non-zero when a request was not carried out**: kill mode exits 1 if a named PID was left
  running, could not be signalled, had an outcome that could not be determined, or was refused as
  this script's own ancestor or child. Report mode always exits 0, so the pre-push hook cannot fail
  over a process listing. An outcome that cannot be determined is reported as unknown rather than
  as success — an identity that was captured at validation but cannot be re-read afterwards means
  the process may still be running, and "unreadable" is not the same as "gone". Liveness in that
  case is established with `ps`, not `kill -0`: `kill -0` cannot distinguish "no such process" from
  "not permitted", so another user's running process would look identical to one that exited. If
  `ps` answers and cannot see the PID, it is gone; if `ps` cannot answer at all, the outcome is
  reported as unknown.

> **Why there is no automatic orphan mode.** `PPID == 1` means either "the parent exited and this
> was reparented" or "a service manager started it here", and nothing in process state separates
> them. Four heuristics were tried and each was wrong in a way that mattered:
>
> 1. Kill everything matching `node.*vitest` — killed healthy suites, including the caller's own.
> 2. Kill only `PPID == 1` — a silent no-op under `systemd --user`, which sets
>    `PR_SET_CHILD_SUBREAPER`, so orphans reparent to the user manager instead of PID 1.
> 3. Also match a parent whose command contains `systemd`/`launchd`/`init` — killed a Vitest run
>    launched _as_ a user systemd service, whose live parent is that manager.
> 4. Back to `PPID == 1` only — still wrong: a system-wide systemd unit that execs
>    `node .../vitest` has `PPID 1` **from birth** and is not an orphan.
>
> So the judgement is yours. `ELAPSED` and `COMMAND` are usually enough to tell a stale run from a
> live one.

## 🔄 Regular Maintenance Tasks

### Daily Development

```bash
# Start development session
npm run cleanup          # List any leftover Vitest processes
npm run dev              # Development mode

# End development session
npm run cleanup          # List what is still running
```

`npm run cleanup` **only lists**. If it shows something you want gone, name it:

```bash
npm run cleanup -- --kill 12345 12346
```

### Before Major Operations

```bash
# Before running comprehensive tests
npm run cleanup          # List leftovers, kill by PID if needed
npm run test             # Run test suite

# Before pushing to repository
npm run cleanup          # The pre-push hook runs this too - it reports only
git push
```

### Performance Monitoring

```bash
# Check system load (macOS; on Linux use: top -b -n 1 | head -10)
top -l 1 | head -10

# Monitor Node processes
ps aux | grep node

# Check memory usage
ps aux | sort -nr -k 4 | head -10
```

## 🎯 Best Practices

### Process Management

1. **Regular Inspection**: Run `npm run cleanup` at the start/end of development sessions, then
   `--kill` anything stale it lists
2. **Monitor Resources**: Keep an eye on system performance during intensive testing
3. **Investigate Unusual Load**: If system feels slow, check for leftover processes

### Quality Gate Integration

The inspection is integrated into quality gates:

- **Pre-Push Hook**: lists leftovers before running the full test suite; it terminates nothing, so
  anything it reports is still running afterwards
- **CI/CD Pipeline**: ensures clean testing environments
- **Development Workflow**: part of no-compromise quality standards

### Memory Management

- **Vitest Workers**: Most common source of memory leaks
- **VS Code Extensions**: Language servers can accumulate
- **Docker Processes**: Clean up test containers regularly

## 🚨 Troubleshooting

### High CPU Usage

```bash
# 1. Identify top CPU consumers
top -o cpu

# 2. Check for Vitest processes
ps aux | grep vitest

# 3. List them, then terminate the stale ones by PID
npm run cleanup
npm run cleanup -- --kill <pid> [<pid>...]
```

### Memory Issues

```bash
# 1. Sort processes by memory usage
ps aux | sort -nr -k 4 | head -10

# 2. Look for Node.js processes with high memory
ps aux | grep node | sort -nr -k 4

# 3. List test processes, then terminate the stale ones by PID
npm run cleanup
npm run cleanup -- --kill <pid> [<pid>...]
```

### System Unresponsive

```bash
# List every Vitest process, then terminate the ones you judged stale
npm run cleanup
npm run cleanup -- --kill <pid> [<pid>...]

# Do NOT reach for `sudo pkill -f vitest`. That is failed attempt #1 from the
# list above: it kills healthy suites in every checkout on the machine - other
# users' included, under sudo - and cannot tell a stale run from a live one.

# Clean Docker containers if using
docker system prune -f

# Restart development environment (the first command only lists)
npm run cleanup
npm run dev
```

## 💡 Prevention Strategies

### Automated Solutions

1. **Git Hook Integration**: the pre-push hook lists leftovers before quality gates (report-only)
2. **NPM Script Aliases**: easy access to the inspector and to `--kill`
3. **Development Workflow**: built into standard operations

### Manual Monitoring

1. **Resource Awareness**: Monitor system performance during development
2. **Process Inspection**: Regularly check for orphaned processes
3. **Clean Development**: Start each session with a clean environment

## 📊 Real-World Example

A point-in-time record from one session, kept for the scale of the problem. The recovery came
from terminating three named PIDs; `npm run cleanup` on its own would have listed them and
changed nothing.

**Before terminating the three PIDs (system under stress):**

```text
CPU: 138% usage (severely overloaded)
Memory: 3 Vitest processes consuming ~1.8GB
Load Average: 12.94+ (critical)
```

**After terminating them (system recovered):**

```text
CPU: 54% usage (46% idle - healthy)
Memory: ~1.8GB freed up
Load Average: 11.43 (trending down)
```

**Impact**: System performance improved by ~97%, making development environment responsive again.

## 🎯 Integration with Quality Standards

This maintenance approach aligns with our **no-compromise quality** mission:

1. ✅ **Visible**: surfaces the problem with the evidence needed to judge it
2. ✅ **Deliberate**: terminating is an explicit `--kill`, never a side effect of a hook
3. ✅ **Integrated**: part of existing workflows
4. ✅ **Measurable**: clear before/after metrics
5. ✅ **Reliable**: tested under extreme load (138% CPU)

The inspector reports accurately under load; deciding what to terminate stays with the operator,
because process state cannot make that call correctly.
