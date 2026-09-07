// Stub executables for the process-inspector suite. `ps` is where these tests
// take control: the script reads all process state through it, so a stub on
// PATH makes every case deterministic and lets the destructive path run with
// no real process to kill. `sleep` returns immediately (the script waits 2s
// between TERM and KILL) and `top` prints instantly, so the suite stays fast.
//
// PIDs absent from the fixture table are delegated to the real `ps`, so the
// script's own ancestry walk still resolves and only the simulated processes
// are synthetic. The env knobs each simulate one failure mode:
//
//   PS_TABLE              path to the fixture table: "<pid> <ppid> <command...>"
//   PS_NOT_ANSWERING      every existence probe fails, including for our own PID
//   PS_PID_ABSENT=<pid>   that PID reports as gone while ps still works
//   PS_PPID_FAIL_FOR=<pid>  ppid lookup fails only for that PID
//   PS_PPID_BREAK=<file>  first ppid lookup answers, later ones fail
//   PS_LSTART_DRIFT=<file>  lstart changes from the second call onward
//   PS_LSTART_AFTER=<n>   lstart drifts only from call n+1
//   PS_LSTART_FAIL_AFTER=<n>  lstart succeeds n times then fails
//   PS_LSTART_COUNT=<file>  call counter used by the two above
//   PS_NO_LSTART          lstart unsupported entirely
//   PS_RENAME_AFTER=<n>   command= reports a non-Vitest name from call n+1
//   PS_STATE=<char>       process state reported by state= (Z for a zombie)

export const PS_STUB = `#!/bin/bash
table="\${PS_TABLE:-/dev/null}"
args="$*"
target="\${args##*-p }"
known() { awk -v p="$target" '$1==p { f=1 } END { exit !f }' "$table"; }
case "$args" in
  *-eo*)
    cat "$table" 2>/dev/null
    ;;
  *"-o state="*)
    known || exec /bin/ps "$@"
    echo "\${PS_STATE:-S}"
    ;;
  *"-o pid="*)
    # PS_NOT_ANSWERING makes every existence probe fail, including the one for
    # this script's own PID: ps not answering at all.
    [ -n "\${PS_NOT_ANSWERING:-}" ] && exit 1
    # PS_PID_ABSENT=<pid> reports that PID as gone while ps still works.
    if [ -n "\${PS_PID_ABSENT:-}" ] && [ "$target" = "$PS_PID_ABSENT" ]; then
      exit 1
    fi
    known || exec /bin/ps "$@"
    echo "$target"
    ;;
  *"-o ppid="*)
    # PS_PPID_FAIL_FOR=<pid> fails only for that PID, leaving the caller's own
    # ancestry walk intact: a descendant check that cannot conclude.
    if [ -n "\${PS_PPID_FAIL_FOR:-}" ] && [ "$target" = "$PS_PPID_FAIL_FOR" ]; then
      exit 1
    fi
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
    # PS_RENAME_AFTER=<n> reports a non-Vitest command from call n+1 onward,
    # while lstart stays put: a process that rewrites its own argv (Node's
    # process.title) without exiting.
    if [ -n "\${PS_RENAME_AFTER:-}" ]; then
      n=0
      [ -f "$PS_RENAME_COUNT" ] && n=$(cat "$PS_RENAME_COUNT")
      n=$((n + 1)); echo "$n" > "$PS_RENAME_COUNT"
      if [ "$n" -gt "$PS_RENAME_AFTER" ]; then
        echo "renamed-and-still-here"
        exit 0
      fi
    fi
    awk -v p="$target" '$1==p { $1=""; $2=""; sub(/^ +/, ""); print }' "$table"
    ;;
  *"-o etime="*)
    known || exec /bin/ps "$@"
    echo "05:00"
    ;;
  *"-o lstart="*)
    # PS_NO_LSTART simulates a ps without start-time support, while
    # -o command= keeps working: a target that cannot be given an identity.
    [ -n "\${PS_NO_LSTART:-}" ] && exit 1
    # PS_LSTART_FAIL_AFTER=<n> succeeds for n calls then fails: an identity
    # captured at validation whose re-read breaks later on.
    if [ -n "\${PS_LSTART_FAIL_AFTER:-}" ]; then
      n=0
      [ -f "$PS_LSTART_COUNT" ] && n=$(cat "$PS_LSTART_COUNT")
      n=$((n + 1)); echo "$n" > "$PS_LSTART_COUNT"
      [ "$n" -gt "$PS_LSTART_FAIL_AFTER" ] && exit 1
    fi
    known || exec /bin/ps "$@"
    if [ -n "\${PS_LSTART_DRIFT:-}" ]; then
      if [ -f "$PS_LSTART_DRIFT" ]; then echo "Mon Sep  7 11:11:11 2026"; exit 0; fi
      : > "$PS_LSTART_DRIFT"
    fi
    # PS_LSTART_AFTER=<n> drifts only from call n+1 onward, which lets a single
    # comparison site be targeted rather than all of them at once.
    if [ -n "\${PS_LSTART_AFTER:-}" ]; then
      n=0
      [ -f "$PS_LSTART_COUNT" ] && n=$(cat "$PS_LSTART_COUNT")
      n=$((n + 1)); echo "$n" > "$PS_LSTART_COUNT"
      if [ "$n" -gt "$PS_LSTART_AFTER" ]; then
        echo "Mon Sep  7 11:11:11 2026"
        exit 0
      fi
    fi
    echo "Mon Sep  7 09:00:00 2026"
    ;;
  *)
    exec /bin/ps "$@"
    ;;
esac
`;

export const SLEEP_STUB = '#!/bin/bash\nexit 0\n';
export const TOP_STUB = '#!/bin/bash\necho "Processes: 1 total"\necho "CPU usage: 0.0% user"\n';
