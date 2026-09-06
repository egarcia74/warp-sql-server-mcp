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
# Orphaned means the process was reparented to an init-like process because the
# shell or runner that started it died. A Vitest process still owned by a live
# parent is somebody's running test suite and is left alone. The script's own
# process ancestry is excluded as well, so it can never kill its caller.
#
# "Init-like" is NOT just PID 1. On Linux, `systemd --user` sets
# PR_SET_CHILD_SUBREAPER, so an orphan in a desktop session reparents to the
# user manager rather than to PID 1. Testing `ppid == 1` alone would classify
# every such orphan as live and make this script a silent no-op on the most
# common Linux dev setup - while still printing a reassuring "leaving them
# alone". So the parent's command is checked too.
#
# Known residual gap: an abandoned `npm run test:unit` whose npm/sh wrappers
# are still alive leaves vitest with a live, non-init parent, and is skipped.
# That is deliberate - it is indistinguishable from a running suite without
# guessing - but it means this script does not catch every leak.

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

# A parent is init-like if it is PID 1 or a session/user manager that adopts
# orphans (systemd --user, launchd, init, upstart).
is_init_like() {
  local ppid="$1"
  [ "$ppid" = "1" ] && return 0
  local pcmd
  pcmd=$(ps -o command= -p "$ppid" 2>/dev/null || true)
  case "$pcmd" in
    *systemd*|*launchd*|/sbin/init*|*/init) return 0 ;;
    *) return 1 ;;
  esac
}

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
  if is_init_like "$ppid"; then
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
    sleep 1
  fi

  # Re-check rather than assume: a process owned by another user is listed by
  # `ps -e` but cannot be signalled, and both kills fail silently.
  SURVIVED=""
  for pid in $ORPHAN_PIDS; do
    if kill -0 "$pid" 2>/dev/null; then
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
