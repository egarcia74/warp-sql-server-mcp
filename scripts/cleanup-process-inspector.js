const MAX_WALK = 64;
const isVitest = command => /node.*vitest/.test(command ?? '');
const canonicalPid = raw => {
  if (!/^\d+$/.test(raw)) return null;
  const digits = raw.replace(/^0+/, '') || '0';
  if (digits.length > 7 || digits === '0') return null;
  const pid = Number(digits);
  return Number.isSafeInteger(pid) ? pid : null;
};

const same = (result, want) => result.kind === 'present' && result.process.startIdentity === want;

function walk(adapter, start, stopPid) {
  let pid = start;
  const seen = new Set();
  for (let hops = 0; hops < MAX_WALK; hops += 1) {
    if (pid === stopPid) return 'yes';
    if (pid <= 1) return 'no';
    if (seen.has(pid)) return 'unknown';
    seen.add(pid);
    const result = adapter.read(pid);
    if (result.kind !== 'present') return 'unknown';
    const parent = result.process.ppid;
    if (!Number.isSafeInteger(parent) || parent < 0) return 'unknown';
    pid = parent;
  }
  return 'unknown';
}

function ownAncestry(adapter, selfPid) {
  const ids = new Set([1]);
  let pid = selfPid;
  for (let hops = 0; hops < MAX_WALK; hops += 1) {
    if (pid <= 1) return { kind: 'present', ids };
    if (ids.has(pid)) return { kind: 'unknown' };
    ids.add(pid);
    const result = adapter.read(pid);
    if (result.kind !== 'present') return { kind: 'unknown' };
    const parent = result.process.ppid;
    if (!Number.isSafeInteger(parent) || parent < 0) return { kind: 'unknown' };
    pid = parent;
  }
  return { kind: 'unknown' };
}

const linesForHelp = [
  'Usage: cleanup-test-processes.js [--kill PID...]',
  '',
  '  (no args)      List Vitest processes with parent, elapsed time and command.',
  '  --kill PID...  Terminate exactly these PIDs (TERM, then KILL if needed).',
  '                 Before TERM command and start time must match. Before KILL',
  '                 only start time is re-checked; a target can rename itself.',
  '',
  'Exit status: 0 listing completed, or every named PID gone/not Vitest;',
  '             1 left running, unsignallable, protected, or undetermined;',
  '             2 usage error; 3 caller ancestry could not be established.'
];

export async function inspect({
  args = [],
  adapter,
  selfPid,
  write = console.log,
  wait = async ms => new Promise(resolve => setTimeout(resolve, ms)),
  status = () => ''
}) {
  const emit = line => {
    try {
      write(line);
    } catch {
      /* display cannot abort inspection */
    }
  };
  if (args[0] === '--help' || args[0] === '-h') {
    linesForHelp.forEach(emit);
    return 0;
  }
  if (args.length && args[0] !== '--kill') {
    emit(`error: unknown option '${args[0]}' (see --help)`);
    return 2;
  }
  if (args[0] === '--kill' && args.length === 1) {
    emit('error: --kill needs at least one PID (see --help)');
    return 2;
  }

  emit('🧹 WARP Test Process Inspector');
  emit('==================================');
  const ancestry = ownAncestry(adapter, selfPid);
  let exit = 0;

  if (!args.length) {
    const listed = adapter.list();
    if (listed.kind !== 'present') {
      emit(
        '⚠️  The process table could not be read, so nothing was inspected. This is NOT a clean report.'
      );
    } else {
      let found = false;
      for (const processRow of listed.rows) {
        if (!isVitest(processRow.command) || ancestry.ids?.has(processRow.pid)) continue;
        const descendant = walk(adapter, processRow.pid, selfPid);
        if (descendant === 'yes') continue;
        if (!found) emit('PID      PPID     ELAPSED    COMMAND');
        found = true;
        emit(
          `${processRow.pid} ${processRow.ppid} ${processRow.elapsed ?? '?'} ${processRow.command}`
        );
      }
      if (!found && !listed.uncertain) emit('✅ No Vitest processes found');
      if (listed.uncertain)
        emit('⚠️  Some process rows could not be classified; this is not a clean report.');
      if (ancestry.kind === 'unknown')
        emit("⚠️  This script's own ancestry could not be walked completely.");
      if (found)
        emit('   Check ELAPSED and COMMAND, then: npm run cleanup -- --kill <pid> [<pid>...]');
    }
  } else {
    if (ancestry.kind === 'unknown') {
      emit(
        "error: the caller's ancestry could not be walked completely; refusing to signal anything"
      );
      return 3;
    }
    const targets = [];
    for (const raw of args.slice(1)) {
      const pid = canonicalPid(raw);
      if (pid === null) {
        emit(`  ⏭️  ${raw}: not a PID, skipped`);
        continue;
      }
      if (ancestry.ids.has(pid)) {
        emit(`  ⏭️  ${pid}: is this script's own ancestor, skipped`);
        exit = 1;
        continue;
      }
      const candidate = adapter.read(pid);
      if (candidate.kind === 'absent') {
        emit(`  ⏭️  ${pid}: not a running Vitest process, skipped`);
        continue;
      }
      if (candidate.kind !== 'present' || !candidate.process.command?.trim()) {
        emit(`  ⏭️  ${pid}: could not be classified, skipped`);
        exit = 1;
        continue;
      }
      if (!isVitest(candidate.process.command)) {
        emit(`  ⏭️  ${pid}: not a running Vitest process, skipped`);
        continue;
      }
      const descendant = walk(adapter, pid, selfPid);
      if (descendant !== 'no') {
        emit(
          `  ⏭️  ${pid}: ${descendant === 'yes' ? "is this script's own child" : "could not verify it is not this script's own child"}, skipped`
        );
        exit = 1;
        continue;
      }
      if (!candidate.process.startIdentity?.trim()) {
        emit(`  ⏭️  ${pid}: no start time available, skipped`);
        exit = 1;
        continue;
      }
      targets.push({ pid, identity: candidate.process.startIdentity, termReached: false });
    }
    if (!targets.length) emit('Nothing to terminate.');
    else {
      emit(`🔄 Sending TERM to: ${targets.map(target => target.pid).join(' ')}`);
      for (const target of targets) {
        const current = adapter.read(target.pid);
        if (!same(current, target.identity) || !isVitest(current.process.command)) {
          emit(`  ⏭️  ${target.pid}: no longer the same Vitest process, not signalled`);
          continue;
        }
        const sent = adapter.signal(target.pid, 'SIGTERM');
        target.termReached = sent.kind === 'sent';
        if (!target.termReached) emit(`  ⏭️  ${target.pid}: could not be signalled`);
      }
      let grace = true;
      try {
        await wait(2000);
      } catch {
        grace = false;
        emit('  ⚠️  the grace period could not be waited out; nothing will be force-killed');
      }
      if (grace) {
        const escalation = [];
        for (const target of targets.filter(value => value.termReached)) {
          const current = adapter.read(target.pid);
          if (same(current, target.identity) && !current.process.state.startsWith('Z'))
            escalation.push(target);
          else if (current.kind === 'unknown')
            emit(`  ⏭️  ${target.pid}: identity could not be re-read, not escalated`);
        }
        if (escalation.length)
          emit(
            `💥 Still running, sending KILL to: ${escalation.map(target => target.pid).join(' ')}`
          );
        for (const target of escalation) {
          const current = adapter.read(target.pid);
          if (same(current, target.identity) && !current.process.state.startsWith('Z'))
            adapter.signal(target.pid, 'SIGKILL');
          else emit(`  ⏭️  ${target.pid}: no longer the process that was signalled, not killed`);
        }
        if (escalation.length) {
          try {
            await wait(1000);
          } catch {
            /* final status still decides outcome */
          }
        }
      }
      for (const target of targets) {
        const current = adapter.read(target.pid);
        if (
          current.kind === 'absent' ||
          (current.kind === 'present' && current.process.startIdentity !== target.identity)
        ) {
          emit(`  ✅ ${target.pid}: terminated`);
        } else if (current.kind === 'present' && current.process.state.startsWith('Z')) {
          emit(`  ✅ ${target.pid}: terminated (exited; its parent has not reaped it yet)`);
        } else if (current.kind === 'present') {
          const probe = adapter.probe(target.pid);
          if (probe.kind === 'absent' && adapter.read(target.pid).kind === 'absent')
            emit(`  ✅ ${target.pid}: terminated`);
          else {
            emit(
              `  ⚠️  ${target.pid}: still running${probe.signalable === false ? ' and cannot be signalled' : ''}`
            );
            exit = 1;
          }
        } else {
          emit(`  ⚠️  ${target.pid}: outcome unknown`);
          exit = 1;
        }
      }
    }
  }
  emit('');
  emit('📈 Current System Status:');
  try {
    const snapshot = await status();
    const lines = String(snapshot).split(/\r?\n/).filter(Boolean).slice(0, 5);
    if (lines.length) lines.forEach(emit);
    else emit('   (top unavailable)');
  } catch {
    emit('   (top unavailable)');
  }
  return exit;
}
