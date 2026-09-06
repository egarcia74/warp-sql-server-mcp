#!/bin/bash

# WARP SQL Server MCP - Test Process Cleanup Script
#
# Terminates ORPHANED Vitest processes only.
#
# The previous version selected every process matching `node.*vitest` and killed
# it, which meant running this - or the pre-push hook that calls it - could tear
# down a test run that was working perfectly well, including one in a different
# checkout, and including the caller's own suite. docs/operations/MAINTENANCE.md
# promised "zero false positives"; that promise is only true if the selection is
# actually scoped, which is what this does.
#
# Orphaned means the process was reparented to init/launchd (PPID 1) because the
# shell or runner that started it died. A Vitest process still owned by a live
# parent is somebody's running test suite and is left alone. The script's own
# process ancestry is excluded as well, so it can never kill its caller.

set -uo pipefail

echo "🧹 WARP Test Process Cleanup"
echo "=================================="
echo "📊 Scanning for orphaned Vitest processes..."

# PIDs from this script up to init, so we never target our own ancestry.
self_ancestry() {
  local pid=$$
  while [ "$pid" -gt 1 ]; do
    echo "$pid"
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$pid" ] && break
  done
}
ANCESTRY=" $(self_ancestry | tr '\n' ' ') "

ORPHAN_PIDS=""
LIVE_COUNT=0

# `ps -o pid=,ppid=,command=` is portable across macOS and Linux.
# pgrep cannot report PPID and command together, and the parent is precisely
# what distinguishes an orphan from a live run - hence ps, not pgrep.
# shellcheck disable=SC2009
while read -r pid ppid command; do
  case "$command" in
    *vitest*) ;;
    *) continue ;;
  esac
  case "$command" in
    *cleanup-test-processes*) continue ;;
  esac
  case "$ANCESTRY" in
    *" $pid "*) continue ;;
  esac
  if [ "$ppid" = "1" ]; then
    ORPHAN_PIDS="$ORPHAN_PIDS $pid"
  else
    LIVE_COUNT=$((LIVE_COUNT + 1))
  fi
done < <(ps -eo pid=,ppid=,command= 2>/dev/null | grep -E "node.*vitest" | grep -v grep || true)

ORPHAN_PIDS="$(echo "$ORPHAN_PIDS" | xargs || true)"

if [ "$LIVE_COUNT" -gt 0 ]; then
  echo "ℹ️  $LIVE_COUNT Vitest process(es) still have a live parent - leaving them alone."
  echo "   These are running test suites, not leftovers."
fi

if [ -z "$ORPHAN_PIDS" ]; then
  echo "✅ No orphaned Vitest processes found"
else
  echo "⚠️  Found orphaned Vitest processes (parent exited): $ORPHAN_PIDS"
  echo "🔄 Terminating..."
  # shellcheck disable=SC2086
  kill $ORPHAN_PIDS 2>/dev/null || true

  sleep 2

  STILL_RUNNING=""
  for pid in $ORPHAN_PIDS; do
    if kill -0 "$pid" 2>/dev/null; then
      STILL_RUNNING="$STILL_RUNNING $pid"
    fi
  done
  STILL_RUNNING="$(echo "$STILL_RUNNING" | xargs || true)"

  if [ -n "$STILL_RUNNING" ]; then
    echo "💥 Force killing stubborn processes: $STILL_RUNNING"
    # shellcheck disable=SC2086
    kill -9 $STILL_RUNNING 2>/dev/null || true
  fi

  echo "✅ Cleanup complete"
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

echo ""
echo "🎯 Done."
