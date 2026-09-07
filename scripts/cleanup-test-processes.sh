#!/bin/bash

# WARP SQL Server MCP - Test Process Inspector
#
# Lists leftover Vitest processes. Terminates only the PIDs you name.
#
# This script does NOT decide what is an orphan. Four attempts did, and each
# had real defects, because the question is not answerable from process state:
#
#   1. Kill everything matching `node.*vitest` - killed healthy suites, in any
#      checkout, including the caller's own.
#   2. Kill only PPID 1 - a silent no-op under `systemd --user`, which sets
#      PR_SET_CHILD_SUBREAPER so orphans reparent to the user manager.
#   3. Also match a parent whose command contains systemd/launchd/init - kills
#      a Vitest run launched *as* a user systemd service, whose live parent is
#      that manager.
#   4. Back to PPID 1 only - still wrong: a system-wide systemd unit that execs
#      `node .../vitest` has PPID 1 *from birth*, so it is not an orphan and
#      would be killed.
#
# PPID 1 means "reparented" or "born there" and nothing distinguishes the two.
# So the heuristic is gone. This reports what exists, with the evidence needed
# to judge (parent, elapsed time, full command), and kills only what you ask
# for by PID. It never reports or signals itself: its ancestors are excluded by
# PID, its descendants by walking each candidate's parents back to this script.

set -uo pipefail

usage() {
  cat <<'USAGE'
Usage: cleanup-test-processes.sh [--kill PID...]

  (no args)      List Vitest processes with parent, elapsed time and command.
                 Exits 0. Safe to call from a hook.
  --kill PID...  Terminate exactly these PIDs (TERM, then KILL if needed).
                 Each is re-verified as a Vitest process immediately before
                 each signal. The check and the signal are still two separate
                 operations, so a PID recycled inside that window could be hit;
                 the window is microscopic, but it is not zero.

Nothing is selected for you: PPID 1 can mean an adopted orphan or a process a
service manager started deliberately, and process state cannot tell them apart.

Exit status: 0 when a listing completes, or when every named PID is gone.
             1 when kill mode left a requested process running or unsignallable.
             2 on a usage error.
             3 when the caller's own ancestry could not be established, in
               which case nothing is signalled.
USAGE
  return 0
}

KILL_PIDS=""
MODE="report"
EXIT_STATUS=0
# Depth bound for both ancestry walks; see self_ancestry.
MAX_WALK=64
if [[ "$#" -gt 0 ]]; then
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --kill)
      MODE="kill"; shift
      KILL_PIDS="$*"
      if [[ -z "$KILL_PIDS" ]]; then
        echo "error: --kill needs at least one PID (see --help)" >&2
        exit 2
      fi
      ;;
    *) echo "error: unknown option '$1' (see --help)" >&2; exit 2 ;;
  esac
fi

# Every `ps` result is validated as a PID before any arithmetic touches it.
# Under `set -u`, `[[ "abc" -gt 1 ]]` is not merely false: bash evaluates the
# word as a variable name in arithmetic context, hits an unbound variable, and
# *exits* -- silently, since the guards redirect stderr. Validating explicitly
# also makes a garbled walk a visible stop rather than a reliance on `[`
# returning 2.
is_pid() {
  case "${1:-}" in
    '' | *[!0-9]*) return 1 ;;
    *) ;;
  esac
  return 0
}

self_ancestry() {
  # PID 1 is seeded, not discovered by the walk. Walking to it is not the same
  # as guaranteeing it: after `docker exec` into a container whose PID 1 *is*
  # the Vitest process, the exec'd shell's parent lives outside the PID
  # namespace, `ps -o ppid=` reports 0, and the walk ends without ever seeing 1
  # -- exactly the case where `--kill 1` would tear down the container. PID 1 is
  # an ancestor of everything in the namespace and is never a legitimate target
  # here, so it is excluded unconditionally.
  #
  # Returns non-zero if the walk could not be completed. A `ps` lookup that
  # fails or returns nonsense halfway up leaves the remaining ancestors
  # unknown, and silently returning a short list would hand back a guard that
  # looks intact: PID 1 is seeded, so the "does ANCESTRY contain 1" sanity
  # check passes even when every real ancestor above the break is missing.
  printf ' 1 '
  local pid=$$ raw hops=0
  # The walk is bounded. `ps` reporting a parent chain that never reaches a
  # root -- a cycle, or a stub that always answers -- would otherwise spin
  # forever, hanging a script the pre-push hook calls. No real process tree is
  # anywhere near this deep, so hitting the bound means the data is wrong, and
  # that is reported as an incomplete walk rather than trusted.
  while is_pid "$pid" && [[ "$pid" -gt 1 ]]; do
    hops=$((hops + 1))
    if [[ "$hops" -gt "$MAX_WALK" ]]; then
      return 1
    fi
    printf '%s ' "$pid"
    if ! raw=$(ps -o ppid= -p "$pid" 2>/dev/null); then
      return 1
    fi
    pid="${raw//[[:space:]]/}"
    # An empty or malformed parent is a broken lookup, not a root. A genuine
    # root reports 0 (outside the PID namespace) or 1, both of which are
    # numeric and end the loop through the condition above.
    if ! is_pid "$pid"; then
      return 1
    fi
  done
  return 0
}

# Ancestors are excluded by PID, but this script also forks subshells -- the
# `while read` pipeline stage and the `< <(scan)` process substitution -- which
# are descendants, not ancestors. An invocation path that happens to match
# `node.*vitest` (a worktree named `node-vitest-fix`, say) would otherwise list
# them. Walk each candidate's parents back to this script rather than matching
# this script's own name in the command, which used to hide unrelated Vitest
# runs that legitimately carried the string.
#
# Exit status: 0 is a descendant, 1 is not, 2 means the walk broke and the
# answer is unknown. Callers treat 2 differently: the report lists the process
# anyway (showing too much is harmless), while kill mode refuses to signal it.
is_self_descendant() {
  local pid="${1:-}" raw hops=0
  while is_pid "$pid" && [[ "$pid" -gt 1 ]]; do
    hops=$((hops + 1))
    if [[ "$hops" -gt "$MAX_WALK" ]]; then
      return 2
    fi
    [[ "$pid" -eq $$ ]] && return 0
    if ! raw=$(ps -o ppid= -p "$pid" 2>/dev/null); then
      return 2
    fi
    pid="${raw//[[:space:]]/}"
    if ! is_pid "$pid"; then
      return 2
    fi
  done
  return 1
}
# Built with builtins only. Piping this through `tr` made the "unconditional"
# PID-1 guard conditional on `tr` being present: in a stripped environment
# where `ps` works but `tr` does not, the substitution came back empty, every
# `case "$ANCESTRY"` test missed, and `--kill 1` sailed through both guards
# because `set -e` is deliberately off here.
if ANCESTRY="$(self_ancestry)"; then
  ANCESTRY_COMPLETE=1
else
  ANCESTRY_COMPLETE=0
fi

# Liveness via ps, not `kill -0`: kill -0 fails with EPERM for a process owned
# by another user, which is indistinguishable from "gone" and silently drops it
# from failure reporting. ps sees it regardless of signal permission.
# Leading zeroes are stripped textually, never with `$((10#$raw))`. Bash
# arithmetic silently wraps past 2^63, so `$((10#18446744073709555859))` is
# 4243 -- an all-digit argument the user never named would validate and then be
# signalled. The length bound is deliberately generous: no platform has a PID
# wider than seven digits (Linux caps `pid_max` at 4194304).
canonical_pid() {
  local raw="${1:-}" stripped
  stripped="${raw#"${raw%%[!0]*}"}"
  [[ -z "$stripped" ]] && stripped=0
  [[ ${#stripped} -gt 7 ]] && return 1
  printf '%s' "$stripped"
  return 0
}

# A PID is not an identity: it can be released and reissued during the wait
# between TERM and KILL. `lstart` is an absolute start time, so unlike `etime`
# it does not drift while we wait, and it distinguishes the process we
# signalled from a different one that later holds the same number.
identity_of() {
  local pid="${1:-}" line rest raw
  local -a fields
  # Linux: field 22 of /proc/<pid>/stat is the start time in clock ticks since
  # boot - roughly 10ms at the usual USER_HZ of 100, which is far finer than
  # any PID reuse this script could race. Field 2 (`comm`) may itself contain
  # spaces and parentheses, so everything up to the last ") " is discarded
  # rather than split on.
  if [[ -r "/proc/$pid/stat" ]] && read -r line < "/proc/$pid/stat"; then
    rest="${line##*') '}"
    read -r -a fields <<< "$rest"
    if [[ -n "${fields[19]:-}" ]]; then
      printf 'ticks_%s' "${fields[19]}"
      return 0
    fi
  fi
  # Elsewhere - darwin has no procfs - `ps -o lstart=` is the finest start time
  # the shell can see, and it is whole seconds. Two processes that start in the
  # same second are therefore indistinguishable here. That residual is stated
  # in the docs rather than papered over: failing closed instead would disable
  # kill mode entirely on macOS, which is where this script is mostly used.
  raw=$(ps -o lstart= -p "$pid" 2>/dev/null) || return 0
  printf 'lstart_%s' "${raw//[[:space:]]/_}"
  return 0
}

is_vitest() {
  local pid="${1:-}" cmd
  cmd=$(ps -o command= -p "$pid" 2>/dev/null) || return 1
  case "$cmd" in
    *node*vitest*) ;;
    *) return 1 ;;
  esac
  return 0
}

scan() {
  # Matching happens in the shell, with no `grep` in the pipeline. `grep -E
  # "node.*vitest"` matches its own argument text where it appears in `ps`
  # output, which is why a `grep -v grep` guard was there -- but that guard
  # dropped every genuine Vitest process whose command contained "grep"
  # anywhere: a test file named greplike.test.js, a path segment such as
  # grep-utils/. That is the same silent-omission bug as the self-name filter
  # removed in 375f1e8. No grep, nothing to filter, nothing hidden.
  # pgrep cannot report PPID and command together.
  # shellcheck disable=SC2009
  ps -eo pid=,ppid=,command= 2>/dev/null \
  | while read -r pid ppid command; do
      case "$command" in *node*vitest*) ;; *) continue ;; esac
      case "$ANCESTRY" in *" $pid "*) continue ;; *) ;; esac
      # Status 2 (walk broke, answer unknown) is falsy here on purpose: the
      # report errs towards showing a process it cannot classify.
      is_self_descendant "$pid" && continue
      echo "$pid $ppid $command"
    done
  return 0
}

echo "🧹 WARP Test Process Inspector"
echo "=================================="

if [[ "$MODE" == "report" ]]; then
  found=0
  while read -r pid ppid command; do
    [[ -z "${pid:-}" ]] && continue
    if [[ "$found" -eq 0 ]]; then
      printf '%-8s %-8s %-10s %s\n' PID PPID ELAPSED COMMAND
      found=1
    fi
    etime=$(ps -o etime= -p "$pid" 2>/dev/null)
    etime="${etime//[[:space:]]/}"
    printf '%-8s %-8s %-10s %s\n' "$pid" "$ppid" "${etime:-?}" "$command"
  done < <(scan)

  if [[ "$found" -eq 0 ]]; then
    echo "✅ No Vitest processes found"
  else
    echo ""
    if [[ "$ANCESTRY_COMPLETE" != "1" ]]; then
      echo "   ⚠️  This script's own ancestry could not be walked completely, so one"
      echo "      of the processes above may be an ancestor of this run. Kill mode"
      echo "      refuses to signal while that is true."
      echo ""
    fi
    echo "   PPID 1 usually means the parent exited - but a service manager may"
    echo "   also have started the process there. Check ELAPSED and COMMAND, then:"
    echo "     npm run cleanup -- --kill <pid> [<pid>...]"
  fi
else
  # Fail closed. Everything below trusts ANCESTRY to hold at least PID 1; if
  # collecting it went wrong, refuse to signal rather than proceed with guards
  # that cannot fire.
  case "$ANCESTRY" in
    *" 1 "*) ;;
    *)
      echo "error: could not establish this process's ancestry, refusing to signal" >&2
      exit 3
      ;;
  esac
  # The check above cannot catch a truncated walk, because PID 1 is seeded: the
  # list looks valid while every ancestor above a failed `ps` lookup is absent.
  # A Vitest process that launched this script could then be named and
  # signalled. Completeness is tracked separately for exactly that reason.
  if [[ "$ANCESTRY_COMPLETE" != "1" ]]; then
    echo "error: the caller's ancestry could not be walked completely, so a" >&2
    echo "       process that launched this one might not be protected." >&2
    echo "       Refusing to signal anything; re-run to retry." >&2
    exit 3
  fi

  # Terminate exactly what was named, reporting each PID's own outcome.
  # PIDs and their start-time identities are held in parallel indexed arrays
  # (not an associative array - /bin/bash is 3.2 on macOS) and always walked by
  # index, which also keeps `set -u` happy when nothing validated.
  TARGET_PIDS=()
  TARGET_IDS=()
  TARGETS=""
  for raw in $KILL_PIDS; do
    case "$raw" in
      '' | *[!0-9]*) echo "  ⏭️  $raw: not a PID, skipped"; continue ;;
      *) ;;
    esac
    # Canonicalise before anything compares it. `ps -p 0001` and `kill 0001`
    # both address PID 1, but "0001" does not match the " 1 " entry in
    # ANCESTRY, so a zero-padded argument would walk straight past the PID-1
    # and ancestry protections.
    if ! pid=$(canonical_pid "$raw"); then
      echo "  ⏭️  $raw: not a PID, skipped"
      continue
    fi
    # 0 is rejected after canonicalisation, which catches "00" and "000" as
    # well as "0": `kill 0` signals the entire process group, which under the
    # pre-push hook means `git push` and the caller's own shell job.
    if [[ "$pid" == "0" ]]; then
      echo "  ⏭️  $raw: not a PID, skipped"
      continue
    fi
    case "$ANCESTRY" in
      *" $pid "*) echo "  ⏭️  $pid: is this script's own ancestor, skipped"; continue ;;
      *) ;;
    esac
    is_self_descendant "$pid"
    case "$?" in
      0)
        echo "  ⏭️  $pid: is this script's own child, skipped"
        continue
        ;;
      2)
        echo "  ⏭️  $pid: could not verify it is not this script's own child, skipped"
        continue
        ;;
      *) ;;
    esac
    if ! is_vitest "$pid"; then
      echo "  ⏭️  $pid: not a running Vitest process, skipped"
      continue
    fi
    TARGET_PIDS+=("$pid")
    TARGET_IDS+=("$(identity_of "$pid")")
    TARGETS="$TARGETS $pid"
  done
  TARGETS="${TARGETS# }"

  if [[ -z "$TARGETS" ]]; then
    echo "Nothing to terminate."
  else
    echo "🔄 Sending TERM to: $TARGETS"
    # Re-verify here, not just when TARGETS was built: a named process can exit
    # and have its PID reused between validation and this loop, especially with
    # several PIDs supplied. The usage text promises a check immediately before
    # each signal, so make that true of TERM as well as KILL.
    #
    # Record what TERM actually reached. Escalating from TARGETS instead would
    # mean a PID skipped here -- or one whose `kill` failed -- could still be
    # KILLed: if it exited and its number were reused by a new Vitest process
    # during the sleep, that replacement would receive KILL having never
    # received TERM, breaking the graceful-before-forceful guarantee.
    TERMED_IDX=()
    i=0
    while [[ $i -lt ${#TARGET_PIDS[@]} ]]; do
      pid="${TARGET_PIDS[$i]}"
      if ! is_vitest "$pid"; then
        echo "  ⏭️  $pid: no longer a Vitest process, not signalled"
      elif [[ "$(identity_of "$pid")" != "${TARGET_IDS[$i]}" ]]; then
        echo "  ⏭️  $pid: a different process now holds this PID, not signalled"
      elif kill "$pid" 2>/dev/null; then
        TERMED_IDX+=("$i")
      else
        echo "  ⏭️  $pid: could not be signalled (owned by another user?)"
      fi
      i=$((i + 1))
    done
    sleep 2

    # Only PIDs that were actually sent TERM may be escalated. A process that
    # appeared during the wait has not had a chance to shut down gracefully.
    ESCALATE=""
    for i in ${TERMED_IDX[@]+"${TERMED_IDX[@]}"}; do
      pid="${TARGET_PIDS[$i]}"
      if ! is_vitest "$pid"; then continue; fi
      # The number surviving is not enough. If our target exited and a new
      # Vitest process took its PID during the wait, KILLing it here would
      # force-kill a process that never received TERM.
      if [[ "$(identity_of "$pid")" == "${TARGET_IDS[$i]}" ]]; then
        ESCALATE="$ESCALATE $pid"
      else
        echo "  ⏭️  $pid: a different process now holds this PID, not escalated"
      fi
    done
    ESCALATE="${ESCALATE# }"

    if [[ -n "$ESCALATE" ]]; then
      echo "💥 Still running, sending KILL to: $ESCALATE"
      for pid in $ESCALATE; do
        is_vitest "$pid" && kill -9 "$pid" 2>/dev/null || true
      done
      sleep 1
    fi

    # A surviving target sets a non-zero exit. Automation calling kill mode
    # could not otherwise distinguish a completed termination from a run that
    # left every requested process alive.
    #
    # Identity is compared here too: if the number is live but now belongs to a
    # different process, the process we were asked to terminate is gone, and
    # reporting it as "still running" would be wrong in both directions.
    i=0
    while [[ $i -lt ${#TARGET_PIDS[@]} ]]; do
      pid="${TARGET_PIDS[$i]}"
      if is_vitest "$pid" && [[ "$(identity_of "$pid")" == "${TARGET_IDS[$i]}" ]]; then
        if kill -0 "$pid" 2>/dev/null; then
          echo "  ⚠️  $pid: still running"
        else
          echo "  ⚠️  $pid: still running and cannot be signalled (owned by another user?)"
        fi
        EXIT_STATUS=1
      else
        echo "  ✅ $pid: terminated"
      fi
      i=$((i + 1))
    done

    # Killing a coordinator reparents its workers. Report them rather than
    # killing anything that was not named.
    LEFT=0
    while read -r _line; do
      [[ -n "$_line" ]] && LEFT=$((LEFT + 1))
    done < <(scan)
    if [[ "$LEFT" != "0" ]]; then
      echo ""
      echo "ℹ️  $LEFT Vitest process(es) remain (workers reparented by the kill, or"
      echo "   unrelated runs). Re-run with no arguments to list them."
    fi
  fi
fi

# Never let an optional display affect the exit status: hooks call this under
# `set -e`, and an aborted push over a failed `top` would be absurd.
echo ""
echo "📈 Current System Status:"
# Capture before truncating: `head` closes the pipe, `top` dies of SIGPIPE, and
# `pipefail` reports 141 for a run that in fact succeeded -- which sent both
# fallbacks down the `||` chain and printed "(top unavailable)" beneath real
# output. Truncating a captured string still yields 141 from the same pipefail
# rule, so the `|| true` below remains load-bearing: do not remove it as dead.
# Each probe is judged on its exit status as well as its output, so a `top` that
# writes a usage error to stdout cannot pass for a successful sample.
{
  if command -v top >/dev/null 2>&1; then
    snapshot=""
    if probe=$(top -l 1 2>/dev/null) && [[ -n "$probe" ]]; then
      snapshot=$probe
    elif probe=$(top -b -n 1 2>/dev/null) && [[ -n "$probe" ]]; then
      snapshot=$probe
    fi
    if [[ -n "$snapshot" ]]; then
      printf '%s\n' "$snapshot" | head -5
    else
      echo "   (top unavailable)"
    fi
  else
    echo "   (top not installed)"
  fi
} || true

# Report mode always succeeds: the pre-push hook calls it, and a push must not
# fail over a process listing. Kill mode propagates the outcome instead.
exit "$EXIT_STATUS"
