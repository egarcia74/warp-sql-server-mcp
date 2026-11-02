import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const unknown = reason => ({ kind: 'unknown', reason });
const positive = value => Number.isSafeInteger(value) && value >= 0;
const formatElapsed = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const clock = [minutes, rest].map(value => String(value).padStart(2, '0')).join(':');
  if (days) return `${days}-${String(hours).padStart(2, '0')}:${clock}`;
  if (hours) return `${String(hours).padStart(2, '0')}:${clock}`;
  return clock;
};

export function parseLinuxStat(value) {
  const text = String(value);
  const open = text.indexOf('(');
  const close = text.lastIndexOf(') ');
  if (open < 1 || close <= open) throw new Error('malformed stat');
  const pid = Number(text.slice(0, open).trim());
  const parts = text
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  const ppid = Number(parts[1]);
  const flags = parts[6];
  const ticks = parts[19];
  if (
    !positive(pid) ||
    pid === 0 ||
    !positive(ppid) ||
    !/^\d+$/.test(flags ?? '') ||
    !/^\d+$/.test(ticks ?? '') ||
    !/^[A-Za-z]$/.test(parts[0] ?? '')
  ) {
    throw new Error('malformed stat fields');
  }
  // Linux include/linux/sched.h defines PF_KTHREAD as 0x00200000.
  const kernelThread = (BigInt(flags) & 0x00200000n) !== 0n;
  return { pid, ppid, state: parts[0], startIdentity: `ticks_${ticks}`, kernelThread };
}

const DARWIN_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const DARWIN_MONTHS = new Set([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]);
const isSpace = char => char === ' ' || char === '\t' || char === '\r';

function parseDarwinRow(line) {
  let cursor = 0;
  const token = () => {
    while (cursor < line.length && isSpace(line[cursor])) cursor += 1;
    const start = cursor;
    while (cursor < line.length && !isSpace(line[cursor])) cursor += 1;
    return line.slice(start, cursor);
  };
  const [pid, ppid, dayName, month, day, time, year, state, elapsed] = Array.from(
    { length: 9 },
    token
  );
  while (cursor < line.length && isSpace(line[cursor])) cursor += 1;
  const command = line.slice(cursor);
  if (
    !/^\d+$/.test(pid) ||
    !/^\d+$/.test(ppid) ||
    !DARWIN_DAYS.has(dayName) ||
    !DARWIN_MONTHS.has(month) ||
    !/^\d{1,2}$/.test(day) ||
    !/^\d{2}:\d{2}:\d{2}$/.test(time) ||
    !/^\d{4}$/.test(year) ||
    !state ||
    !/^(?:\d+-)?\d+:\d{2}(?::\d{2})?$/.test(elapsed) ||
    !command
  )
    throw new Error('malformed ps row');
  return {
    pid: Number(pid),
    ppid: Number(ppid),
    state,
    elapsed,
    command,
    startIdentity: `lstart_${dayName}_${month}_${day}_${time}_${year}`
  };
}

export function parseDarwinTable(value, selfPid) {
  const rows = new Map();
  for (const line of String(value)
    .split(/\r?\n/)
    .filter(line => line.trim())) {
    const processRow = parseDarwinRow(line);
    const { pid, ppid } = processRow;
    if (!positive(pid) || pid === 0 || !positive(ppid) || rows.has(pid))
      throw new Error('invalid ps PID');
    rows.set(pid, processRow);
  }
  if (!rows.has(selfPid)) throw new Error('ps did not report self');
  return rows;
}

export function readSystemStatus({
  platform = process.platform,
  spawn = (file, args, options) => spawnSync(file, args, options)
} = {}) {
  if (platform !== 'darwin' && platform !== 'linux') return '';
  try {
    const args = platform === 'darwin' ? ['-l', '1'] : ['-b', '-n', '1'];
    const result = spawn('top', args, {
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' }
    });
    return result.status === 0 ? String(result.stdout) : '';
  } catch {
    return '';
  }
}

export function createPlatformAdapter({
  platform = process.platform,
  selfPid = process.pid,
  readFile = path => readFileSync(path),
  readDir = path => readdirSync(path),
  spawn = (file, args, options) => spawnSync(file, args, options),
  kill = (pid, signal) => process.kill(pid, signal)
} = {}) {
  const runPs = () => {
    try {
      const result = spawn(
        'ps',
        [
          '-eww',
          '-o',
          'pid=',
          '-o',
          'ppid=',
          '-o',
          'lstart=',
          '-o',
          'state=',
          '-o',
          'etime=',
          '-o',
          'command='
        ],
        {
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, LC_ALL: 'C' }
        }
      );
      if (result.error || result.status !== 0) return unknown('ps failed');
      return { kind: 'present', rows: parseDarwinTable(result.stdout, selfPid) };
    } catch {
      return unknown('ps output malformed');
    }
  };

  const procHealthy = () => {
    try {
      return parseLinuxStat(readFile('/proc/self/stat')).pid === selfPid;
    } catch {
      return false;
    }
  };

  const readLinux = pid => {
    if (!procHealthy()) return unknown('procfs unavailable');
    let first;
    try {
      first = parseLinuxStat(readFile(`/proc/${pid}/stat`));
    } catch (error) {
      if (error.code !== 'ENOENT') return unknown('stat unreadable');
      return probe(pid).kind === 'absent'
        ? { kind: 'absent' }
        : unknown('target hidden or uninspectable');
    }
    if (first.pid !== pid) return unknown('stat PID mismatch');
    let command;
    let last;
    try {
      command = String(readFile(`/proc/${pid}/cmdline`))
        .split('\0')
        .filter(Boolean)
        .join(' ');
      last = parseLinuxStat(readFile(`/proc/${pid}/stat`));
    } catch {
      return unknown('process changed during lookup');
    }
    if (
      last.pid !== first.pid ||
      last.ppid !== first.ppid ||
      last.kernelThread !== first.kernelThread ||
      last.startIdentity !== first.startIdentity
    ) {
      return unknown('process changed during lookup');
    }
    if (!command.trim() && last.kernelThread) command = '[kernel thread]';
    return { kind: 'present', process: { ...last, command, elapsed: '?' } };
  };

  const read = pid => {
    if (platform === 'linux') return readLinux(pid);
    if (platform === 'darwin') {
      const table = runPs();
      if (table.kind === 'unknown') return table;
      const processRow = table.rows.get(pid);
      if (processRow) return { kind: 'present', process: processRow };
      return probe(pid).kind === 'absent'
        ? { kind: 'absent' }
        : unknown('target hidden or uninspectable');
    }
    return unknown('unsupported platform');
  };

  const list = () => {
    if (platform === 'darwin') {
      const table = runPs();
      return table.kind === 'unknown'
        ? table
        : { kind: 'present', rows: [...table.rows.values()], uncertain: false };
    }
    if (platform !== 'linux' || !procHealthy()) return unknown('process table unavailable');
    let names;
    try {
      names = readDir('/proc');
    } catch {
      return unknown('process table unavailable');
    }
    const rows = [];
    let uncertain = false;
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      const result = readLinux(Number(name));
      if (result.kind === 'present') {
        rows.push(result.process);
        if (!result.process.command.trim() && !result.process.state.startsWith('Z'))
          uncertain = true;
      }
      if (result.kind === 'unknown') uncertain = true;
    }
    let uptime;
    let hz;
    try {
      uptime = Number(String(readFile('/proc/uptime')).trim().split(/\s+/)[0]);
      const answer = spawn('getconf', ['CLK_TCK'], {
        encoding: 'utf8',
        timeout: 1000,
        maxBuffer: 1024,
        env: { ...process.env, LC_ALL: 'C' }
      });
      hz = answer.status === 0 ? Number(String(answer.stdout).trim()) : Number.NaN;
    } catch {
      uptime = Number.NaN;
      hz = Number.NaN;
    }
    for (const row of rows) {
      const ticks = Number(row.startIdentity.slice('ticks_'.length));
      row.elapsed = positive(hz) && hz > 0 ? formatElapsed(uptime - ticks / hz) : '?';
    }
    return { kind: 'present', rows, uncertain };
  };

  const probe = pid => {
    try {
      kill(pid, 0);
      return { kind: 'present', signalable: true };
    } catch (error) {
      if (error.code === 'ESRCH') return { kind: 'absent' };
      if (error.code === 'EPERM') return { kind: 'present', signalable: false };
      return unknown('liveness probe failed');
    }
  };

  const signal = (pid, name) => {
    if (name !== 'SIGTERM' && name !== 'SIGKILL') return unknown('invalid signal');
    try {
      kill(pid, name);
      return { kind: 'sent' };
    } catch (error) {
      if (error.code === 'ESRCH') return { kind: 'absent' };
      if (error.code === 'EPERM') return { kind: 'denied' };
      return unknown('signal failed');
    }
  };

  return { read, list, probe, signal };
}
