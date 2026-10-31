import fsNative from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { spawn as spawnNative, execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clock = () => performance.timeOrigin + performance.now();
export const DEFAULT_LIMITS = Object.freeze({
  totalMs: 1_200_000,
  preservationMs: 180_000,
  manifestMs: 5_000,
  outerMarginMs: 30_000,
  killGraceMs: 5_000,
  maxBytes: 128 * 1024 * 1024
});
const NAME = 'warp-mcp-sqlserver';
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = reason => Object.assign(new Error(reason), { safeReason: reason });

function aclListing(fs, filename) {
  if (fs.inspectAcl) return fs.inspectAcl(filename);
  return execFileSync('/bin/ls', ['-lde', '--', filename], {
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 16384,
    env: { ...process.env, CLICOLOR: '0' }
  });
}

// Modes alone do not exclude inherited macOS ACL grants.
function privatePath(fs, filename, mode, aclCache = new Map()) {
  const stat = fs.lstatSync(filename);
  if (
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== mode ||
    stat.uid !== process.getuid?.() ||
    (mode === 0o600 && (!stat.isFile() || stat.nlink !== 1)) ||
    (mode === 0o700 && !stat.isDirectory())
  )
    throw failure('unsafe-evidence-permissions');
  const signature = `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mode}`;
  if (process.platform === 'darwin' && aclCache.get(filename) !== signature) {
    const listing = aclListing(fs, filename);
    if (/^\s*\d+: /m.test(listing)) throw failure('unsafe-evidence-acl');
    const after = fs.lstatSync(filename);
    if (`${after.dev}:${after.ino}:${after.ctimeMs}:${after.mode}` !== signature)
      throw failure('evidence-acl-drift');
    aclCache.set(filename, signature);
  }
  return stat;
}

function sameMetadata(left, right) {
  return ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'ctimeMs', 'mtimeMs'].every(
    key => left[key] === right[key]
  );
}

function readBounded(fs, fd, maxBytes, reason) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw failure(reason);
  const chunks = [];
  let total = 0;
  while (total <= maxBytes) {
    const buffer = Buffer.alloc(Math.min(65536, maxBytes + 1 - total));
    const count = fs.readSync(fd, buffer, 0, buffer.length, null);
    if (count === 0) break;
    total += count;
    if (total > maxBytes) throw failure(reason);
    chunks.push(buffer.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

function syncDirectory(fs, directory) {
  const fd = fs.openSync(
    directory,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isDirectory()) throw failure('directory-identity-drift');
    const before = fs.lstatSync(directory);
    if (before.isSymbolicLink() || !sameMetadata(opened, before))
      throw failure('directory-identity-drift');
    fs.fsyncSync(fd);
    if (!sameMetadata(opened, fs.fstatSync(fd)) || !sameMetadata(opened, fs.lstatSync(directory)))
      throw failure('directory-identity-drift');
  } finally {
    fs.closeSync(fd);
  }
}

function trustedChain(fs, target, cache, pendingPrivateChild = false) {
  const paths = [];
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    paths.unshift(current);
    if (path.dirname(current) === current) break;
  }
  const identities = [];
  for (let i = 0; i < paths.length; i++) {
    const filename = paths[i],
      stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) {
      // Canonical system aliases such as macOS /var are root-owned. User aliases
      // are rejected before any evidence is created through them.
      if (stat.uid !== 0) throw failure('untrusted-symlink-ancestor');
      identities.push({
        path: filename,
        dev: stat.dev,
        ino: stat.ino,
        uid: stat.uid,
        mode: stat.mode,
        link: fs.readlinkSync(filename)
      });
      continue;
    }
    const sticky = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    const child = i + 1 < paths.length ? fs.lstatSync(paths[i + 1]) : null;
    const privateChild =
      child &&
      !child.isSymbolicLink() &&
      child.uid === process.getuid() &&
      (child.mode & 0o077) === 0;
    if (
      !stat.isDirectory() ||
      ![0, process.getuid()].includes(stat.uid) ||
      ((stat.mode & 0o022) !== 0 && !(sticky && (privateChild || (pendingPrivateChild && !child))))
    )
      throw failure('replaceable-evidence-ancestor');
    const signature = `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mode}`;
    if (process.platform === 'darwin' && cache.get(`ancestor:${filename}`) !== signature) {
      const listing = aclListing(fs, filename);
      if (listing.split('\n').some(line => /^\s*\d+:/.test(line) && /\ballow\b/.test(line)))
        throw failure('replaceable-evidence-acl');
      const after = fs.lstatSync(filename);
      if (
        after.dev !== stat.dev ||
        after.ino !== stat.ino ||
        after.mode !== stat.mode ||
        after.uid !== stat.uid
      )
        throw failure('evidence-ancestor-drift');
      // Other private children can change a shared directory's ctime. Re-read
      // ACL grants in that case; directory membership is not an authority grant.
      if (after.ctimeMs !== stat.ctimeMs) {
        const repeated = aclListing(fs, filename);
        if (repeated.split('\n').some(line => /^\s*\d+:/.test(line) && /\ballow\b/.test(line)))
          throw failure('replaceable-evidence-acl');
        const checked = fs.lstatSync(filename);
        if (
          checked.dev !== stat.dev ||
          checked.ino !== stat.ino ||
          checked.mode !== stat.mode ||
          checked.uid !== stat.uid
        )
          throw failure('evidence-ancestor-drift');
      }
      cache.set(`ancestor:${filename}`, signature);
    }
    identities.push({
      path: filename,
      dev: stat.dev,
      ino: stat.ino,
      uid: stat.uid,
      mode: stat.mode
    });
  }
  return identities;
}

function privateRoot(fs, input, sourceRoot, cache) {
  input = path.resolve(input);
  const pending = [];
  let existing = input;
  while (!fs.existsSync(existing)) {
    pending.unshift(existing);
    existing = path.dirname(existing);
  }
  trustedChain(fs, existing, cache, pending.length > 0);
  const predicted = path.join(fs.realpathSync(existing), path.relative(existing, input));
  const source = fs.realpathSync(sourceRoot);
  const relative = path.relative(source, predicted);
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    throw failure('evidence-must-be-outside-source');
  for (const directory of pending) {
    fs.mkdirSync(directory, { mode: 0o700 });
    privatePath(fs, directory, 0o700, cache);
    syncDirectory(fs, path.dirname(directory));
  }
  const canonical = fs.realpathSync(input);
  privatePath(fs, canonical, 0o700, cache);
  return {
    input,
    canonical,
    lexical: trustedChain(fs, input, cache),
    canonicalChain: trustedChain(fs, canonical, cache)
  };
}

function verifyRoot(fs, proof, cache) {
  if (
    fs.realpathSync(proof.input) !== proof.canonical ||
    JSON.stringify(trustedChain(fs, proof.input, cache)) !== JSON.stringify(proof.lexical) ||
    JSON.stringify(trustedChain(fs, proof.canonical, cache)) !==
      JSON.stringify(proof.canonicalChain)
  )
    throw failure('evidence-root-or-ancestor-drift');
  privatePath(fs, proof.canonical, 0o700, cache);
}

function readPrivate(fs, filename, cache, maxBytes = 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw failure('private-state-identity-failure');
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  try {
    const opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.uid !== process.getuid?.() ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.size > maxBytes
    )
      throw failure('private-state-identity-failure');
    const before = privatePath(fs, filename, 0o600, cache);
    if (!sameMetadata(opened, before)) throw failure('private-state-identity-failure');
    const bytes = readBounded(fs, fd, maxBytes, 'private-state-size-bound');
    const after = privatePath(fs, filename, 0o600, cache);
    if (!sameMetadata(opened, after) || !sameMetadata(opened, fs.fstatSync(fd)))
      throw failure('private-state-readback-drift');
    return { bytes, identity: { sha256: hash(bytes), dev: opened.dev, ino: opened.ino } };
  } finally {
    fs.closeSync(fd);
  }
}

function writePrivate(fs, filename, value, cache) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const fd = fs.openSync(
    filename,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600
  );
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (!readPrivate(fs, filename, cache).bytes.equals(bytes))
    throw failure('private-state-readback-failed');
  syncDirectory(fs, path.dirname(filename));
}

function acquireLock({ fs, root, sourceRoot, cache, daemon, project }) {
  const proof = privateRoot(fs, root, sourceRoot, cache);
  const directory = path.join(proof.canonical, `${hash(`${daemon}:${NAME}:14330`)}.lock`);
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw failure('existing-or-stale-lifecycle-lock');
    throw error;
  }
  const identity = privatePath(fs, directory, 0o700, cache);
  syncDirectory(fs, proof.canonical);
  const token = randomUUID();
  const owner = path.join(directory, 'owner.json');
  writePrivate(fs, owner, { token, pid: process.pid, project, daemonHash: hash(daemon) }, cache);
  const verify = () => {
    verifyRoot(fs, proof, cache);
    const current = privatePath(fs, directory, 0o700, cache);
    if (
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      JSON.parse(readPrivate(fs, owner, cache).bytes).token !== token
    )
      throw failure('lifecycle-lock-drift');
  };
  return {
    directory,
    proof,
    verify,
    stateFile: path.join(proof.canonical, `${hash(`${daemon}:${project}`)}.json`),
    release() {
      verify();
      if (fs.readdirSync(directory).length !== 1) throw failure('lifecycle-lock-contents-drift');
      fs.unlinkSync(owner);
      fs.rmdirSync(directory);
      syncDirectory(fs, proof.canonical);
    }
  };
}

function generatedCredential(fs, filename, cache) {
  trustedChain(fs, path.dirname(filename), cache);
  const read = readPrivate(fs, filename, cache);
  const parsed = dotenv.parse(read.bytes);
  const password = parsed.SQL_SERVER_PASSWORD;
  if (
    !password ||
    !/^[A-Za-z0-9][A-Za-z0-9!_-]{23,127}$/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[!_-]/.test(password) ||
    parsed.MCP_TESTING_MODE !== 'docker' ||
    !['localhost', '127.0.0.1'].includes(parsed.SQL_SERVER_HOST) ||
    parsed.SQL_SERVER_PORT !== '14330' ||
    !parsed.SQL_SERVER_USER?.trim()
  )
    throw failure('invalid-generated-credential');
  return read.identity;
}

// The generator/template remain unchanged. Refuse a modified template before
// invoking the monolithic startup command, even when a credential already exists.
function verifyCredentialTemplate(fs, filename, cache) {
  trustedChain(fs, path.dirname(filename), cache);
  const fd = fs.openSync(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  try {
    const opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.mode & 0o022 ||
      ![0, process.getuid()].includes(opened.uid) ||
      opened.size > 1024 * 1024
    )
      throw failure('invalid-docker-credential-template');
    const before = fs.lstatSync(filename);
    if (before.isSymbolicLink() || !sameMetadata(opened, before))
      throw failure('invalid-docker-credential-template');
    const bytes = readBounded(fs, fd, 1024 * 1024, 'invalid-docker-credential-template');
    if (
      !sameMetadata(opened, fs.lstatSync(filename)) ||
      !sameMetadata(opened, fs.fstatSync(fd)) ||
      hash(bytes) !== 'c7815ab256e230761912e5a093bb808e43f95dd1c0d566236713f726a06d0b5e'
    )
      throw failure('invalid-docker-credential-template');
  } finally {
    fs.closeSync(fd);
  }
}

export class EvidenceStore {
  constructor({
    root = path.join(os.homedir(), '.warp-sql-server-mcp-test-evidence'),
    fs = fsNative,
    now = clock,
    deadline = Infinity,
    sourceRoot = repoRoot
  } = {}) {
    this.fs = fs;
    this.now = now;
    this.deadline = deadline;
    this.aclCache = new Map();
    this.files = new Map();
    this.rootProof = privateRoot(fs, root, sourceRoot, this.aclCache);
    this.directory = path.join(this.rootProof.canonical, `sql-test-${randomUUID()}`);
    fs.mkdirSync(this.directory, { mode: 0o700 });
    this.runIdentity = privatePath(fs, this.directory, 0o700, this.aclCache);
    syncDirectory(fs, this.rootProof.canonical);
    syncDirectory(fs, this.directory);
    this.assertTrusted();
  }

  assertTrusted() {
    verifyRoot(this.fs, this.rootProof, this.aclCache);
    const stat = privatePath(this.fs, this.directory, 0o700, this.aclCache);
    if (
      stat.dev !== this.runIdentity.dev ||
      stat.ino !== this.runIdentity.ino ||
      this.fs.realpathSync(this.directory) !== this.directory
    )
      throw failure('run-directory-drift');
  }

  checkDeadline() {
    if (this.now() >= this.deadline) throw failure('evidence-deadline');
  }

  open(label) {
    this.checkDeadline();
    this.assertTrusted();
    if (!/^[a-z0-9.-]+$/.test(label)) throw failure('invalid-evidence-name');
    const filename = path.join(this.directory, label);
    const fd = this.fs.openSync(
      filename,
      this.fs.constants.O_CREAT |
        this.fs.constants.O_EXCL |
        this.fs.constants.O_WRONLY |
        this.fs.constants.O_NOFOLLOW,
      0o600
    );
    this.files.set(label, null);
    privatePath(this.fs, filename, 0o600, this.aclCache);
    return fd;
  }

  verify(label) {
    this.checkDeadline();
    this.assertTrusted();
    const fs = this.fs;
    const filename = path.join(this.directory, label);
    const before = privatePath(fs, filename, 0o600, this.aclCache);
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(fd);
      if (opened.ino !== before.ino || opened.dev !== before.dev)
        throw failure('evidence-path-drift');
      fs.fsyncSync(fd);
      const digest = createHash('sha256');
      const buffer = Buffer.alloc(64 * 1024);
      let bytes = 0;
      for (;;) {
        this.checkDeadline();
        const count = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!count) break;
        digest.update(buffer.subarray(0, count));
        bytes += count;
      }
      const after = privatePath(fs, filename, 0o600, this.aclCache);
      if (
        after.ino !== opened.ino ||
        after.dev !== opened.dev ||
        after.size !== bytes ||
        after.ctimeMs !== before.ctimeMs ||
        after.mtimeMs !== before.mtimeMs ||
        after.size !== before.size
      )
        throw failure('evidence-readback-drift');
      const result = { label, bytes, sha256: digest.digest('hex'), mode: '0600' };
      const previous = this.files.get(label);
      if (previous && (previous.bytes !== bytes || previous.sha256 !== result.sha256))
        throw failure('evidence-hash-drift');
      this.files.set(label, result);
      return result;
    } finally {
      fs.closeSync(fd);
    }
  }

  verifyAll() {
    this.assertTrusted();
    privatePath(this.fs, this.directory, 0o700, this.aclCache);
    for (const label of this.files.keys()) this.verify(label);
    const fd = this.fs.openSync(this.directory, this.fs.constants.O_RDONLY);
    try {
      this.fs.fsyncSync(fd);
    } finally {
      this.fs.closeSync(fd);
    }
    this.checkDeadline();
    return [...this.files.values()];
  }

  write(label, value) {
    this.writeBytes(label, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
  }

  writeBytes(label, bytes) {
    const fd = this.open(label);
    try {
      this.fs.writeFileSync(fd, bytes);
      this.fs.fsyncSync(fd);
    } finally {
      this.fs.closeSync(fd);
    }
    this.verify(label);
    this.verifyAll();
  }

  read(label) {
    const entry = this.verify(label);
    if (entry.bytes > 8 * 1024 * 1024) throw failure('metadata-size-bound');
    return this.fs.readFileSync(path.join(this.directory, label), 'utf8');
  }
}

// Each child owns a fresh POSIX group. Both descriptors go straight to exclusive
// files: neither shell redirection nor a pipe/maxBuffer limit can discard bytes.
export async function runCaptured({
  store,
  label,
  command,
  args = [],
  cwd = repoRoot,
  environment = process.env,
  input,
  deadline,
  spawn = spawnNative,
  kill = process.kill.bind(process),
  now = clock,
  maxBytes = DEFAULT_LIMITS.maxBytes,
  killGraceMs = DEFAULT_LIMITS.killGraceMs,
  abortSignal
}) {
  const startedAt = now();
  const output = store.open(`${label}.stdout`);
  const errors = store.open(`${label}.stderr`);
  let child,
    closed = false,
    status = null,
    signal = null,
    bounded = true;
  let reason = null,
    stoppingAt = null,
    escalated = false,
    terminated = false;
  const groupAlive = () => {
    if (!child?.pid) return false;
    try {
      kill(-child.pid, 0);
      return true;
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  };
  const stop = (why, requested = 'SIGTERM') => {
    bounded = false;
    reason ??= why;
    if (stoppingAt !== null) return;
    stoppingAt = now();
    signal = requested;
    if (child?.pid) {
      try {
        kill(-child.pid, requested);
      } catch (error) {
        if (error.code !== 'ESRCH') reason = 'termination-uncertain';
      }
    }
  };
  const aborted = () =>
    stop(
      'external-signal',
      ['SIGTERM', 'SIGINT', 'SIGHUP'].includes(abortSignal.reason) ? abortSignal.reason : 'SIGTERM'
    );
  try {
    await new Promise(resolve => {
      let timer;
      const tick = () => {
        const time = now();
        try {
          if (
            store.fs.fstatSync(output).size > maxBytes ||
            store.fs.fstatSync(errors).size > maxBytes
          )
            stop('capture-size-bound');
        } catch {
          stop('capture-write-failure');
        }
        if (time >= deadline) stop('deadline');
        if (closed && groupAlive() && stoppingAt === null) stop('descendant-still-running');
        if (stoppingAt !== null && time - stoppingAt >= killGraceMs && !escalated) {
          escalated = true;
          if (child?.pid && groupAlive()) {
            try {
              kill(-child.pid, 'SIGKILL');
            } catch {
              reason = 'termination-uncertain';
            }
          }
        }
        if ((closed || stoppingAt !== null) && !groupAlive()) {
          terminated = true;
          clearInterval(timer);
          resolve();
        } else if (stoppingAt !== null && time - stoppingAt >= 2 * killGraceMs) {
          reason = 'termination-uncertain';
          clearInterval(timer);
          resolve();
        }
      };
      try {
        child = spawn(command, args, {
          cwd,
          env: environment,
          detached: true,
          stdio: ['pipe', output, errors]
        });
        child.once('error', () => {
          status = 1;
          closed = true;
          stop('spawn-failure');
        });
        child.once('close', (code, receivedSignal) => {
          status = code;
          signal ??= receivedSignal;
          closed = true;
          tick();
        });
        child.stdin?.on?.('error', () => stop('stdin-write-failure'));
        child.stdin?.end(input);
        abortSignal?.addEventListener('abort', aborted, { once: true });
        timer = setInterval(tick, 25);
        if (abortSignal?.aborted) aborted();
        tick();
      } catch {
        status = 1;
        closed = true;
        stop('spawn-failure');
        tick();
      }
    });
  } finally {
    abortSignal?.removeEventListener('abort', aborted);
    store.fs.closeSync(output);
    store.fs.closeSync(errors);
  }
  let preserved = false;
  try {
    store.verify(`${label}.stdout`);
    store.verify(`${label}.stderr`);
    preserved = terminated;
  } catch {
    bounded = false;
    reason = 'capture-verification-failure';
  }
  return {
    status,
    signal,
    pid: child?.pid ?? null,
    bounded,
    terminated,
    preserved,
    reason,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(now()).toISOString()
  };
}

async function probeHostPort() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(failure('host-port-occupied')));
    server.listen({ port: 14330, host: '127.0.0.1', exclusive: true }, () => server.close(resolve));
  });
}

function labels(row) {
  if (typeof row.Labels === 'object') return row.Labels ?? {};
  return Object.fromEntries(
    (row.Labels ?? '').split(',').map(item => {
      const split = item.indexOf('=');
      return [item.slice(0, split), item.slice(split + 1)];
    })
  );
}
const ownProject = (row, project) => labels(row)['com.docker.compose.project'] === project;

export async function runSqlLifecycle({
  cwd = repoRoot,
  evidenceRoot,
  environment = process.env,
  fs = fsNative,
  spawn = spawnNative,
  kill = process.kill.bind(process),
  now = clock,
  probePort = probeHostPort,
  lockRoot = path.join(os.homedir(), '.warp-sql-server-mcp-test-locks'),
  limits = DEFAULT_LIMITS
} = {}) {
  environment = { ...environment };
  let lock,
    lockRetained = false,
    reusedVolume = false,
    volumeBinding = null,
    daemonID = null,
    preexistingCredential = null;
  let tlsNames = [];
  let store,
    project,
    pinned,
    startAttempted = false,
    code = 1,
    reason = null;
  const stages = [];
  const started = now();
  const totalDeadline = started + limits.totalMs;
  const workDeadline = totalDeadline - limits.preservationMs;
  const captureDeadline = totalDeadline - limits.manifestMs - 2 * limits.killGraceMs;
  const controller = new globalThis.AbortController();
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const onSignal = signal => controller.abort(signal);
  const handlers = new Map(signals.map(signal => [signal, () => onSignal(signal)]));
  let counter = 0;
  let stoppedForCapture = false;
  const stage = async (label, command, args, preserve = false, input) => {
    store.assertTrusted();
    if (lockRetained) lock.verify();
    for (const name of tlsNames) store.verify(name);
    const deadline = preserve ? captureDeadline : workDeadline;
    if (now() >= deadline) throw failure('deadline-reserve-reached');
    const result = await runCaptured({
      store,
      label,
      command,
      args,
      cwd,
      environment,
      input,
      deadline,
      spawn,
      kill,
      now,
      maxBytes: limits.maxBytes,
      killGraceMs: limits.killGraceMs,
      abortSignal: preserve ? undefined : controller.signal
    });
    stages.push({
      label,
      command: command === process.execPath ? 'node' : command,
      args,
      ...result
    });
    return result;
  };
  const successful = result =>
    result.status === 0 && result.bounded && result.terminated && result.preserved;
  const docker = async (args, preserve = false, input) => {
    const label = `inspection-${++counter}`;
    const result = await stage(label, 'docker', args, preserve, input);
    if (!successful(result)) throw failure('docker-inspection-failed');
    return store.read(`${label}.stdout`);
  };
  const currentDaemon = async preserve => {
    const id = JSON.parse(await docker(['info', '--format', '{{json .ID}}'], preserve));
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{5,127}$/.test(id))
      throw failure('daemon-identity-unavailable');
    return id;
  };
  const verifyDaemon = async preserve => {
    if ((await currentDaemon(preserve)) !== daemonID) throw failure('docker-daemon-drift');
  };
  const resolveRoute = async () => {
    try {
      let endpoint = environment.DOCKER_HOST,
        tls = false,
        verifyTLS = false;
      let materialDirectory;
      if (environment.DOCKER_CONTEXT || !endpoint) {
        const selected = environment.DOCKER_CONTEXT || (await docker(['context', 'show'])).trim();
        if (!selected || /[\r\n]/.test(selected)) throw failure('unsupported-context');
        const contexts = JSON.parse(await docker(['context', 'inspect', selected]));
        if (contexts.length !== 1 || contexts[0].Name !== selected)
          throw failure('unsupported-context');
        const context = contexts[0],
          target = context.Endpoints?.docker;
        endpoint = target?.Host;
        tls = Array.isArray(context.TLSMaterial?.docker) && context.TLSMaterial.docker.length > 0;
        // SkipTLSVerify still enables TLS without certificate material. Do not
        // translate that context into plaintext or load ambient certificates.
        if (target?.SkipTLSVerify && !tls && new URL(endpoint).protocol === 'tcp:')
          throw failure('unsupported-context');
        verifyTLS = tls && !target.SkipTLSVerify;
        materialDirectory =
          context.Storage?.TLSPath && path.join(context.Storage.TLSPath, 'docker');
      } else {
        tls = Boolean(environment.DOCKER_TLS || environment.DOCKER_TLS_VERIFY);
        verifyTLS = Boolean(environment.DOCKER_TLS_VERIFY);
        materialDirectory =
          environment.DOCKER_CERT_PATH ||
          environment.DOCKER_CONFIG ||
          path.join(os.homedir(), '.docker');
      }
      if (typeof endpoint !== 'string') throw failure('unsupported-context');
      const url = new URL(endpoint);
      if (
        !['unix:', 'ssh:', 'tcp:'].includes(url.protocol) ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === 'unix:'
          ? Boolean(url.host) || !path.isAbsolute(url.pathname)
          : !url.hostname) ||
        (url.protocol === 'tcp:' && url.username)
      )
        throw failure('unsupported-context');
      const pinnedEnvironment = { ...environment };
      for (const key of [
        'DOCKER_CONTEXT',
        'DOCKER_HOST',
        'DOCKER_TLS',
        'DOCKER_TLS_VERIFY',
        'DOCKER_CERT_PATH'
      ])
        delete pinnedEnvironment[key];
      pinnedEnvironment.DOCKER_HOST = endpoint;
      if (tls) {
        if (url.protocol !== 'tcp:' || !materialDirectory) throw failure('unsupported-context');
        for (const name of ['ca.pem', 'cert.pem', 'key.pem']) {
          const source = fs.realpathSync(path.join(materialDirectory, name));
          trustedChain(fs, path.dirname(source), store.aclCache);
          const fd = fs.openSync(
            source,
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
          );
          let bytes;
          try {
            const opened = fs.fstatSync(fd);
            if (
              !opened.isFile() ||
              opened.nlink !== 1 ||
              ![0, process.getuid()].includes(opened.uid) ||
              (opened.mode & 0o022) !== 0 ||
              (name === 'key.pem' && (opened.mode & 0o077) !== 0) ||
              opened.size > 1024 * 1024
            )
              throw failure('unsupported-context');
            const before = fs.lstatSync(source);
            if (before.isSymbolicLink() || !sameMetadata(opened, before))
              throw failure('unsupported-context');
            if (process.platform === 'darwin') {
              const listing = aclListing(fs, source);
              if (/^\s*\d+:/m.test(listing)) throw failure('unsupported-context');
              if (!sameMetadata(opened, fs.lstatSync(source))) throw failure('unsupported-context');
            }
            bytes = readBounded(fs, fd, 1024 * 1024, 'unsupported-context');
            if (
              !sameMetadata(opened, fs.lstatSync(source)) ||
              !sameMetadata(opened, fs.fstatSync(fd))
            )
              throw failure('unsupported-context');
          } finally {
            fs.closeSync(fd);
          }
          store.writeBytes(name, bytes);
        }
        tlsNames = ['ca.pem', 'cert.pem', 'key.pem'];
        pinnedEnvironment.DOCKER_TLS = '1';
        if (verifyTLS) pinnedEnvironment.DOCKER_TLS_VERIFY = '1';
        pinnedEnvironment.DOCKER_CERT_PATH = store.directory;
      }
      environment = pinnedEnvironment;
    } catch {
      throw failure('unsupported-context');
    }
  };
  const inventory = async preserve => {
    const parse = text =>
      text.trim()
        ? text
            .trim()
            .split(/\r?\n/)
            .map(line => JSON.parse(line))
        : [];
    return {
      containers: parse(
        await docker(['container', 'ls', '-a', '--no-trunc', '--format', '{{json .}}'], preserve)
      ),
      volumes: parse(await docker(['volume', 'ls', '--format', '{{json .}}'], preserve)),
      networks: parse(
        await docker(['network', 'ls', '--no-trunc', '--format', '{{json .}}'], preserve)
      )
    };
  };
  let composeFile, composeDirectory;
  const volumeName = () => `${project}_sqlserver_data`;
  const networkName = () => `${project}_warp-mcp-network`;
  const exactName = row => row.Names?.split(',').includes(NAME);
  const credentialPath = () => path.join(composeDirectory, '.env.docker');
  const volumeIdentity = volume => ({
    name: volume.Name,
    source: volume.Mountpoint,
    created: volume.CreatedAt,
    driver: volume.Driver,
    labels: volume.Labels
  });
  const verifyVolume = volume => {
    if (
      volume.Name !== volumeName() ||
      volume.Driver !== 'local' ||
      !volume.Mountpoint ||
      !Number.isFinite(Date.parse(volume.CreatedAt)) ||
      volume.Labels?.['com.docker.compose.project'] !== project ||
      volume.Labels?.['com.docker.compose.volume'] !== 'sqlserver_data'
    )
      throw failure('volume-ownership-failed');
  };
  const bindVolume = volume => {
    verifyVolume(volume);
    const binding = {
      project,
      daemonHash: hash(daemonID),
      volume: volumeIdentity(volume),
      credential: generatedCredential(fs, credentialPath(), store.aclCache)
    };
    if (volumeBinding && JSON.stringify(binding) !== JSON.stringify(volumeBinding))
      throw failure('volume-credential-binding-drift');
    if (!volumeBinding) {
      if (fs.existsSync(lock.stateFile)) {
        const previous = JSON.parse(readPrivate(fs, lock.stateFile, store.aclCache).bytes);
        if (JSON.stringify(previous) !== JSON.stringify(binding))
          throw failure('volume-credential-binding-drift');
      } else writePrivate(fs, lock.stateFile, binding, store.aclCache);
      volumeBinding = binding;
    }
    return binding;
  };
  const inspectIdentity = async (preserve, required = true, expectStopped = false) => {
    await verifyDaemon(preserve);
    const list = await inventory(preserve);
    const found = list.containers.filter(exactName);
    if (!found.length && !required && !pinned) return null;
    if (found.length !== 1 || !/^[a-f0-9]{64}$/.test(found[0].ID))
      throw failure('container-identity-ambiguous');
    const id = pinned?.id ?? found[0].ID;
    if (
      found[0].ID !== id ||
      list.containers.filter(row => ownProject(row, project)).length !== 1 ||
      list.volumes.filter(row => row.Name === volumeName() || ownProject(row, project)).length !==
        1 ||
      list.networks.filter(row => row.Name === networkName() || ownProject(row, project)).length !==
        1
    )
      throw failure('project-resource-drift');
    const one = text => {
      const values = JSON.parse(text);
      if (values.length !== 1) throw failure('inspection-ambiguous');
      return values[0];
    };
    const container = one(await docker(['container', 'inspect', id], preserve));
    const volume = one(await docker(['volume', 'inspect', volumeName()], preserve));
    const network = one(await docker(['network', 'inspect', networkName()], preserve));
    bindVolume(volume);
    const cl = container.Config?.Labels ?? {},
      vl = volume.Labels ?? {},
      nl = network.Labels ?? {};
    const mounts = container.Mounts ?? [],
      networks = container.NetworkSettings?.Networks ?? {};
    const stopped =
      container.State?.Running === false &&
      container.State?.Status === 'exited' &&
      container.State?.Pid === 0;
    if (expectStopped && !stopped) throw failure('container-not-stopped');
    const attachedNames = Object.keys(networks);
    const runtimeNetworkMatches =
      attachedNames.length === 1 &&
      attachedNames[0] === networkName() &&
      (networks[networkName()]?.NetworkID === network.Id ||
        (stopped && !networks[networkName()]?.NetworkID));
    const detachedWhileStopped = stopped && attachedNames.length === 0;
    const ports = container.HostConfig?.PortBindings ?? {};
    const data = mounts.find(mount => mount.Destination === '/var/opt/mssql');
    const seed = mounts.find(mount => mount.Destination === '/tmp/init-db.sql');
    if (
      container.Id !== id ||
      container.Name !== `/${NAME}` ||
      cl['com.docker.compose.project'] !== project ||
      cl['com.docker.compose.service'] !== 'sqlserver' ||
      cl['com.docker.compose.project.working_dir'] !== composeDirectory ||
      cl['com.docker.compose.project.config_files'] !== composeFile ||
      !Number.isFinite(Date.parse(container.Created)) ||
      Date.parse(container.Created) < Math.floor(started) - 1000 ||
      Date.parse(container.Created) > now() ||
      container.HostConfig?.NetworkMode !== networkName() ||
      Object.keys(ports).length !== 1 ||
      ports['1433/tcp']?.length !== 1 ||
      ports['1433/tcp'][0].HostIp !== '127.0.0.1' ||
      ports['1433/tcp'][0].HostPort !== '14330' ||
      mounts.length !== 2 ||
      data?.Type !== 'volume' ||
      data.Name !== volumeName() ||
      data.RW !== true ||
      data.Source !== volume.Mountpoint ||
      seed?.Type !== 'bind' ||
      seed.RW !== false ||
      seed.Source !== path.join(composeDirectory, 'init-db.sql') ||
      volume.Name !== volumeName() ||
      volume.Driver !== 'local' ||
      vl['com.docker.compose.project'] !== project ||
      vl['com.docker.compose.volume'] !== 'sqlserver_data' ||
      network.Name !== networkName() ||
      network.Driver !== 'bridge' ||
      !/^[a-f0-9]{64}$/.test(network.Id) ||
      nl['com.docker.compose.project'] !== project ||
      nl['com.docker.compose.network'] !== 'warp-mcp-network' ||
      (!runtimeNetworkMatches && !detachedWhileStopped)
    )
      throw failure('ownership-verification-failed');
    const composeHash = readPrivate(fs, composeFile, store.aclCache, 8 * 1024 * 1024).identity
      .sha256;
    const effective = await docker(
      ['compose', '-f', composeFile, 'config', '--format', 'json'],
      preserve
    );
    if (JSON.parse(effective).name !== project) throw failure('compose-project-drift');
    const identity = {
      id,
      project,
      name: NAME,
      created: container.Created,
      volume: { name: volume.Name, source: volume.Mountpoint, created: volume.CreatedAt },
      network: { name: network.Name, id: network.Id },
      composeHash,
      effectiveHash: hash(effective)
    };
    if (pinned && JSON.stringify(identity) !== JSON.stringify(pinned))
      throw failure('pinned-identity-drift');
    return identity;
  };
  const report = () => ({
    code,
    reason,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(now()).toISOString(),
    limits,
    identity: pinned ?? null,
    stages,
    files: [...store.files.values()].filter(Boolean),
    interrupted: controller.signal.aborted,
    stoppedForCapture,
    project,
    reusedVolume,
    daemonHash: daemonID && hash(daemonID),
    routeHash: environment.DOCKER_HOST && hash(environment.DOCKER_HOST),
    lock: lock?.directory,
    lockRetained
  });
  try {
    if (process.platform === 'win32' || !fs.constants.O_NOFOLLOW)
      throw failure('unsupported-private-capture-platform');
    if (!environment.npm_execpath) throw failure('npm-execpath-required');
    if (
      Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0) ||
      limits.preservationMs <= 4 * limits.killGraceMs + limits.manifestMs ||
      limits.totalMs <= limits.preservationMs
    )
      throw failure('invalid-deadline-budget');
    const outer = environment.SQL_TEST_OUTER_TIMEOUT_MS;
    if (
      outer !== undefined &&
      (!/^\d+$/.test(outer) ||
        !Number.isSafeInteger(Number(outer)) ||
        Number(outer) <= limits.totalMs + limits.preservationMs + limits.outerMarginMs)
    )
      throw failure('outer-watchdog-too-short');
    cwd = fs.realpathSync(cwd);
    composeFile = path.join(cwd, 'test/docker/docker-compose.yml');
    composeDirectory = path.dirname(composeFile);
    project = `warp_sql_${hash(`${process.getuid()}:${cwd}`).slice(0, 24)}`;
    environment.COMPOSE_PROJECT_NAME = project;
    const root =
      evidenceRoot ??
      environment.SQL_TEST_EVIDENCE_ROOT ??
      path.join(os.homedir(), '.warp-sql-server-mcp-test-evidence');
    const relative = path.relative(cwd, path.resolve(root));
    if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      throw failure('evidence-must-be-outside-source');
    store = new EvidenceStore({ root, fs, now, deadline: totalDeadline, sourceRoot: cwd });
    for (const [signal, handler] of handlers) process.on(signal, handler);
    await resolveRoute();
    daemonID = await currentDaemon(false);
    lock = acquireLock({
      fs,
      root: lockRoot,
      sourceRoot: cwd,
      cache: store.aclCache,
      daemon: daemonID,
      project
    });
    lockRetained = true;
    const resolved = JSON.parse(
      await docker(
        [
          'compose',
          '--project-directory',
          composeDirectory,
          '-f',
          '-',
          'config',
          '--format',
          'json'
        ],
        false,
        'services:\n  probe:\n    image: scratch\n'
      )
    );
    if (resolved.name !== project || !/^[a-z0-9][a-z0-9_-]*$/.test(project))
      throw failure('invalid-compose-project');
    const existing = await inventory(false);
    if (
      existing.containers.some(
        row => exactName(row) || /:14330->/.test(row.Ports ?? '') || ownProject(row, project)
      ) ||
      existing.networks.some(row => row.Name === networkName() || ownProject(row, project))
    )
      throw failure('admission-collision');
    verifyCredentialTemplate(
      fs,
      path.join(composeDirectory, 'docker-env.template'),
      store.aclCache
    );
    if (fs.existsSync(credentialPath()))
      preexistingCredential = generatedCredential(fs, credentialPath(), store.aclCache);
    const volumes = existing.volumes.filter(
      row => row.Name === volumeName() || ownProject(row, project)
    );
    if (volumes.length > 1) throw failure('admission-volume-ambiguity');
    if (volumes.length === 1) {
      if (volumes[0].Name !== volumeName() || !fs.existsSync(lock.stateFile))
        throw failure('unbound-existing-volume');
      const inspected = JSON.parse(await docker(['volume', 'inspect', volumeName()]));
      if (inspected.length !== 1) throw failure('admission-volume-ambiguity');
      bindVolume(inspected[0]);
      reusedVolume = true;
    } else if (fs.existsSync(lock.stateFile)) throw failure('project-state-volume-missing');
    await probePort();
    store.write('admission.json', {
      project,
      name: NAME,
      port: '127.0.0.1:14330',
      absent: true,
      reusedVolume,
      volume: volumeBinding?.volume ?? null,
      checkedAt: new Date(now()).toISOString()
    });
    await verifyDaemon(false);
    verifyCredentialTemplate(
      fs,
      path.join(composeDirectory, 'docker-env.template'),
      store.aclCache
    );
    if (
      preexistingCredential &&
      JSON.stringify(generatedCredential(fs, credentialPath(), store.aclCache)) !==
        JSON.stringify(preexistingCredential)
    )
      throw failure('preexisting-credential-drift');
    startAttempted = true;
    const startup = await stage('start', process.execPath, [
      environment.npm_execpath,
      'run',
      'docker:start:init'
    ]);
    code = successful(startup) ? 0 : startup.status || 1;
    if (code) reason = 'start-init-failed';
    const generated = generatedCredential(fs, credentialPath(), store.aclCache);
    if (
      preexistingCredential &&
      JSON.stringify(generated) !== JSON.stringify(preexistingCredential)
    )
      throw failure('preexisting-credential-drift');
    pinned = await inspectIdentity(true, code === 0);
    if (!pinned) throw failure('no-created-container');
    if (code === 0 && now() < workDeadline && !controller.signal.aborted) {
      const tests = await stage('integration', process.execPath, [
        'scripts/ci/run-docker-integration.mjs'
      ]);
      code = successful(tests) ? 0 : tests.status || 1;
      if (code) reason = 'integration-failed';
    } else if (code === 0) {
      code = 1;
      reason = 'work-deadline-or-signal';
    }
  } catch (error) {
    if (code === 0) code = 1;
    reason ??= error.safeReason ?? 'lifecycle-failure';
  }
  try {
    if (store && startAttempted && pinned) {
      await inspectIdentity(true);
      if (code === 0 && !controller.signal.aborted) {
        await verifyDaemon(true);
        const stop = await stage('owned-stop', 'docker', ['stop', pinned.id], true);
        if (!successful(stop)) {
          code = stop.status || 1;
          reason = 'owned-stop-failed';
        } else {
          stoppedForCapture = true;
        }
        await inspectIdentity(true, true, stoppedForCapture);
      } else if (code === 0) {
        code = 1;
        reason = 'interrupted-before-stop';
      }
      const logs = await stage('docker-logs', 'docker', ['logs', '--timestamps', pinned.id], true);
      await inspectIdentity(true, true, stoppedForCapture);
      const archive = await stage(
        'engine-archive',
        'docker',
        ['cp', `${pinned.id}:/var/opt/mssql/log`, '-'],
        true
      );
      const logBytes =
        store.verify('docker-logs.stdout').bytes + store.verify('docker-logs.stderr').bytes;
      const archiveBytes = store.verify('engine-archive.stdout').bytes;
      if (!successful(logs) || !successful(archive) || logBytes === 0 || archiveBytes === 0)
        throw failure('container-log-preservation-failed');
      await inspectIdentity(true, true, stoppedForCapture);
      if (now() >= captureDeadline) throw failure('manifest-reserve-reached');
      store.verifyAll();
      store.write('pre-removal.json', report());
      if (
        code === 0 &&
        stoppedForCapture &&
        !controller.signal.aborted &&
        now() < captureDeadline
      ) {
        await verifyDaemon(true);
        await inspectIdentity(true, true, true);
        await verifyDaemon(true);
        store.verifyAll();
        store.assertTrusted();
        lock.verify();
        const cleanup = await stage(
          'cleanup',
          process.execPath,
          [environment.npm_execpath, 'run', 'docker:stop'],
          true
        );
        code = successful(cleanup) ? 0 : cleanup.status || 1;
        if (code) reason = 'cleanup-failed';
        else {
          await verifyDaemon(true);
          const remaining = await inventory(true);
          if (
            remaining.containers.some(row => exactName(row) || ownProject(row, project)) ||
            remaining.networks.some(row => row.Name === networkName() || ownProject(row, project))
          )
            throw failure('cleanup-resource-verification-failed');
          const volumes = remaining.volumes.filter(
            row => row.Name === volumeName() || ownProject(row, project)
          );
          if (volumes.length !== 1 || volumes[0].Name !== volumeName())
            throw failure('cleanup-volume-drift');
          const inspected = JSON.parse(await docker(['volume', 'inspect', volumeName()], true));
          if (inspected.length !== 1) throw failure('cleanup-volume-drift');
          bindVolume(inspected[0]);
          store.verifyAll();
          lock.release();
          lockRetained = false;
          lock = { directory: lock.directory };
        }
      } else if (code === 0) {
        code = 1;
        reason = 'cleanup-deadline-or-signal';
      }
    }
  } catch (error) {
    if (code === 0) code = 1;
    reason ??= error.safeReason ?? 'preservation-failure';
  }
  try {
    if (lockRetained && !startAttempted) {
      lock.release();
      lockRetained = false;
      lock = { directory: lock.directory };
    }
    if (store) {
      store.verifyAll();
      store.write('result.json', report());
    }
  } catch {
    if (code === 0) code = 1;
    reason ??= 'final-evidence-verification-failed';
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
  return { code, reason, directory: store?.directory, lock: lock?.directory, lockRetained };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runSqlLifecycle();
  process.stdout.write(
    `SQL lifecycle: ${result.code === 0 ? 'passed' : 'failed'}; private evidence: ${result.directory ?? 'unavailable'}\n`
  );
  process.exitCode = result.code;
}
