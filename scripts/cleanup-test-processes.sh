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
# for by PID. Its own process ancestry is always excluded.

set -uo pipefail

usage() {
  cat <<'USAGE'
Usage: cleanup-test-processes.sh [--kill PID...]

  (no args)      List Vitest processes with parent, elapsed time and command.
                 Exits 0. Safe to call from a hook.
  --kill PID...  Terminate exactly these PIDs (TERM, then KILL if needed).
                 Each is re-verified as a Vitest process immediately before
                 each signal, so a recycled PID is never signalled.

Nothing is selected for you: PPID 1 can mean an adopted orphan or a process a
service manager started deliberately, and process state cannot tell them apart.
USAGE
}

KILL_PIDS=""
MODE="report"
if [ "$#" -gt 0 ]; then
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --kill)
      MODE="kill"; shift
      KILL_PIDS="$*"
      if [ -z "$KILL_PIDS" ]; then
        echo "error: --kill needs at least one PID (see --help)" >&2
        exit 2
      fi
      ;;
    *) echo "error: unknown option '$1' (see --help)" >&2; exit 2 ;;
  esac
fi

self_ancestry() {
  local pid=$$
  while [ "$pid" -gt 1 ] 2>/dev/null; do
    echo "$pid"
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$pid" ] && break
  done
}
ANCESTRY=" $(self_ancestry | tr '\n' ' ') "

# Liveness via ps, not `kill -0`: kill -0 fails with EPERM for a process owned
# by another user, which is indistinguishable from "gone" and silently drops it
# from failure reporting. ps sees it regardless of signal permission.
is_vitest() {
  ps -o command= -p "$1" 2>/dev/null | grep -qE "node.*vitest"
}

scan() {
  # pgrep cannot report PPID and command together.
  # shellcheck disable=SC2009
  ps -eo pid=,ppid=,command= 2>/dev/null | grep -E "node.*vitest" | grep -v grep \
  | while read -r pid ppid command; do
      case "$command" in *cleanup-test-processes*) continue ;; esac
      case "$ANCESTRY" in *" $pid "*) continue ;; esac
      echo "$pid $ppid $command"
    done
}

echo "🧹 WARP Test Process Inspector"
echo "=================================="

if [ "$MODE" = "report" ]; then
  found=0
  while read -r pid ppid command; do
    [ -z "${pid:-}" ] && continue
    if [ "$found" -eq 0 ]; then
      printf '%-8s %-8s %-10s %s\n' PID PPID ELAPSED COMMAND
      found=1
    fi
    etime=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
    printf '%-8s %-8s %-10s %s\n' "$pid" "$ppid" "${etime:-?}" "$command"
  done < <(scan)

  if [ "$found" -eq 0 ]; then
    echo "✅ No Vitest processes found"
  else
    echo ""
    echo "   PPID 1 usually means the parent exited - but a service manager may"
    echo "   also have started the process there. Check ELAPSED and COMMAND, then:"
    echo "     npm run cleanup -- --kill <pid> [<pid>...]"
  fi
else
  # Terminate exactly what was named, reporting each PID's own outcome.
  TARGETS=""
  for pid in $KILL_PIDS; do
    case "$pid" in
      ''|*[!0-9]*) echo "  ⏭️  $pid: not a PID, skipped"; continue ;;
    esac
    case "$ANCESTRY" in
      *" $pid "*) echo "  ⏭️  $pid: is this script's own ancestor, skipped"; continue ;;
    esac
    if ! is_vitest "$pid"; then
      echo "  ⏭️  $pid: not a running Vitest process, skipped"
      continue
    fi
    TARGETS="$TARGETS $pid"
  done
  TARGETS="$(echo "$TARGETS" | xargs || true)"

  if [ -z "$TARGETS" ]; then
    echo "Nothing to terminate."
  else
    echo "🔄 Sending TERM to: $TARGETS"
    for pid in $TARGETS; do kill "$pid" 2>/dev/null || true; done
    sleep 2

    # Only PIDs that were actually sent TERM may be escalated. A process that
    # appeared during the wait has not had a chance to shut down gracefully.
    ESCALATE=""
    for pid in $TARGETS; do
      if is_vitest "$pid"; then ESCALATE="$ESCALATE $pid"; fi
    done
    ESCALATE="$(echo "$ESCALATE" | xargs || true)"

    if [ -n "$ESCALATE" ]; then
      echo "💥 Still running, sending KILL to: $ESCALATE"
      for pid in $ESCALATE; do
        is_vitest "$pid" && kill -9 "$pid" 2>/dev/null || true
      done
      sleep 1
    fi

    for pid in $TARGETS; do
      if is_vitest "$pid"; then
        if kill -0 "$pid" 2>/dev/null; then
          echo "  ⚠️  $pid: still running"
        else
          echo "  ⚠️  $pid: still running and cannot be signalled (owned by another user?)"
        fi
      else
        echo "  ✅ $pid: terminated"
      fi
    done

    # Killing a coordinator reparents its workers. Report them rather than
    # killing anything that was not named.
    LEFT=$(scan | wc -l | tr -d ' ')
    if [ "$LEFT" != "0" ]; then
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
{
  if command -v top >/dev/null 2>&1; then
    top -l 1 2>/dev/null | head -5 || top -b -n 1 2>/dev/null | head -5 || echo "   (top unavailable)"
  else
    echo "   (top not installed)"
  fi
} || true

exit 0
