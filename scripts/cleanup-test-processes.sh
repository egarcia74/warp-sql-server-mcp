#!/bin/bash

# WARP SQL Server MCP - Test Process Cleanup
#
# Reports leftover Vitest processes. Terminates them only with --kill.
#
# History, because the naive versions of this are actively harmful:
#
#   1. The original selected every process matching `node.*vitest` and killed
#      it. Running it - or the pre-push hook that calls it - could tear down a
#      healthy suite in any checkout, including the caller's own.
#   2. Restricting that to PPID 1 fixed the false positives but is a silent
#      no-op under `systemd --user`, which sets PR_SET_CHILD_SUBREAPER so
#      orphans reparent to the user manager rather than to PID 1.
#   3. Also matching a parent whose command contains `systemd` fixed the
#      no-op and reintroduced the original harm from the other direction: a
#      Vitest run launched *as* a user systemd service has the user manager as
#      its live parent, and would be killed as an "orphan".
#
# There is no reliable way to tell an adopted orphan from a process the
# session manager spawned deliberately. So this script does not guess:
#
#   * It reports by default and exits 0. Safe to call from a hook.
#   * `--kill` terminates, and only processes whose parent is PID 1 - the
#     conservative subset. Under a systemd user session some orphans will not
#     be detected; that is a missed cleanup, which is the failure worth having.
#   * Its own process ancestry is always excluded, so it can never kill its
#     caller.

set -uo pipefail

KILL=0
for arg in "$@"; do
  case "$arg" in
    --kill) KILL=1 ;;
    -h|--help)
      echo "Usage: $0 [--kill]"
      echo "  (no args)  report leftover Vitest processes and exit 0"
      echo "  --kill     terminate processes whose parent is PID 1"
      exit 0
      ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

echo "🧹 WARP Test Process Cleanup"
echo "=================================="

self_ancestry() {
  local pid=$$
  while [ "$pid" -gt 1 ] 2>/dev/null; do
    echo "$pid"
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$pid" ] && break
  done
}
ANCESTRY=" $(self_ancestry | tr '\n' ' ') "

# Emits "pid ppid command" for every Vitest process that is not us.
scan() {
  # pgrep cannot report PPID and command together, and the parent is what the
  # orphan test needs.
  # shellcheck disable=SC2009
  ps -eo pid=,ppid=,command= 2>/dev/null | grep -E "node.*vitest" | grep -v grep \
  | while read -r pid ppid command; do
      case "$command" in *cleanup-test-processes*) continue ;; esac
      case "$ANCESTRY" in *" $pid "*) continue ;; esac
      echo "$pid $ppid $command"
    done
}

# True only if the command still looks like the Vitest process we selected.
# Guards against PID reuse between TERM and KILL: the PID can be recycled
# during the wait, and `kill -0` only proves *something* holds that number.
still_vitest() {
  local pid="$1"
  ps -o command= -p "$pid" 2>/dev/null | grep -qE "node.*vitest"
}

ORPHANS=""
LIVE=0
while read -r pid ppid command; do
  [ -z "${pid:-}" ] && continue
  if [ "$ppid" = "1" ]; then
    ORPHANS="$ORPHANS $pid"
  else
    LIVE=$((LIVE + 1))
  fi
done < <(scan)
ORPHANS="$(echo "$ORPHANS" | xargs || true)"

if [ "$LIVE" -gt 0 ]; then
  echo "ℹ️  $LIVE Vitest process(es) have a live parent - not touched."
  echo "   These are running suites, or orphans adopted by a subreaper that"
  echo "   this script deliberately does not try to identify."
fi

if [ -z "$ORPHANS" ]; then
  echo "✅ No orphaned Vitest processes (parent = PID 1) found"
else
  echo "⚠️  Orphaned Vitest processes (parent = PID 1): $ORPHANS"
  if [ "$KILL" -eq 0 ]; then
    ORPHAN_CSV="$(echo "$ORPHANS" | tr ' ' ',')"
    ps -o pid=,etime=,command= -p "$ORPHAN_CSV" 2>/dev/null || true
    echo ""
    echo "   Reporting only. To terminate these: npm run cleanup -- --kill"
  else
    echo "🔄 Terminating..."
    # shellcheck disable=SC2086
    kill $ORPHANS 2>/dev/null || true
    sleep 2

    # Killing a coordinator reparents its workers to PID 1, so rescan once
    # rather than working from the original list.
    SECOND=""
    while read -r pid ppid command; do
      [ -z "${pid:-}" ] && continue
      [ "$ppid" = "1" ] && SECOND="$SECOND $pid"
    done < <(scan)
    SECOND="$(echo "$SECOND" | xargs || true)"

    STUBBORN=""
    for pid in $SECOND; do
      if kill -0 "$pid" 2>/dev/null && still_vitest "$pid"; then
        STUBBORN="$STUBBORN $pid"
      fi
    done
    STUBBORN="$(echo "$STUBBORN" | xargs || true)"

    if [ -n "$STUBBORN" ]; then
      echo "💥 Force killing: $STUBBORN"
      # shellcheck disable=SC2086
      kill -9 $STUBBORN 2>/dev/null || true
      sleep 1
    fi

    SURVIVED=""
    for pid in $STUBBORN; do
      if kill -0 "$pid" 2>/dev/null && still_vitest "$pid"; then
        SURVIVED="$SURVIVED $pid"
      fi
    done
    SURVIVED="$(echo "$SURVIVED" | xargs || true)"

    if [ -n "$SURVIVED" ]; then
      echo "⚠️  Could not terminate: $SURVIVED (owned by another user?)"
    else
      echo "✅ Cleanup complete"
    fi
  fi
fi

echo ""
echo "📈 Current System Status:"
if command -v top >/dev/null 2>&1; then
  if top -l 1 >/dev/null 2>&1; then
    top -l 1 | head -5      # macOS
  else
    top -b -n 1 | head -5   # Linux
  fi
fi
