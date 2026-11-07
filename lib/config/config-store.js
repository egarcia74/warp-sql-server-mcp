/** Private-home, conflict-aware publication. Portable Node cannot CAS against hostile same-user writers. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { configError } from './environment.js';
import { checkStoredConfig } from './config-schema.js';
const MAX_BYTES = 1024 * 1024;
const parentIdentity = s => ({ dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode });
const fileIdentity = s => ({
  ...parentIdentity(s),
  size: s.size,
  mtimeMs: s.mtimeMs,
  ctimeMs: s.ctimeMs,
  nlink: s.nlink
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const owned = s =>
  process.platform === 'win32' ||
  typeof process.getuid !== 'function' ||
  s.uid === process.getuid();
const abort = signal => {
  if (signal?.aborted) throw configError('cancelled');
};
function safeError(e) {
  return ['unsafe-file', 'invalid-json', 'conflict', 'lock-busy', 'cancelled'].includes(e?.code)
    ? e
    : configError('file-error');
}
async function parentState(parent, api) {
  const s = await api.stat(parent);
  if (!s.isDirectory() || !owned(s) || (process.platform !== 'win32' && s.mode & 0o022))
    throw configError('unsafe-file');
  return parentIdentity(s);
}
async function targetState(file, api) {
  try {
    return await api.lstat(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function checkTarget(s) {
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || !owned(s))
    throw configError('unsafe-file');
}
/** @returns {Promise<{path:string,exists:boolean,values:object,contentHash:string|null,identity:object|null,parentIdentity:object}>} */
export async function readConfigSnapshot(file, { fsApi = fs } = {}) {
  try {
    const parent = await fsApi.realpath(path.dirname(file));
    file = path.join(parent, path.basename(file));
    const parentId = await parentState(parent, fsApi);
    const before = await targetState(file, fsApi);
    if (!before)
      return {
        path: file,
        exists: false,
        values: Object.create(null),
        contentHash: null,
        identity: null,
        parentIdentity: parentId
      };
    checkTarget(before);
    if (before.size > MAX_BYTES) throw configError('unsafe-file');
    const h = await fsApi.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let bytes, stat;
    try {
      stat = await h.stat();
      checkTarget(stat);
      if (!same(fileIdentity(before), fileIdentity(stat))) throw configError('conflict');
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const r = await h.read(buffer, length, buffer.length - length, null);
        if (!r.bytesRead) break;
        length += r.bytesRead;
      }
      if (length > MAX_BYTES) throw configError('unsafe-file');
      bytes = buffer.subarray(0, length);
      const after = await h.stat();
      if (!same(fileIdentity(stat), fileIdentity(after))) throw configError('conflict');
    } finally {
      await h.close();
    }
    const after = await targetState(file, fsApi);
    if (
      !after ||
      !same(fileIdentity(stat), fileIdentity(after)) ||
      !same(parentId, await parentState(parent, fsApi))
    )
      throw configError('conflict');
    let values;
    try {
      values = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw configError('invalid-json');
    }
    if (values === null || typeof values !== 'object' || Array.isArray(values))
      throw configError('invalid-json');
    return {
      path: file,
      exists: true,
      values,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      identity: fileIdentity(after),
      parentIdentity: parentId
    };
  } catch (e) {
    throw safeError(e);
  }
}
async function verify(snapshot, api) {
  const latest = await readConfigSnapshot(snapshot.path, { fsApi: api });
  if (
    !same(snapshot.parentIdentity, latest.parentIdentity) ||
    snapshot.exists !== latest.exists ||
    !same(snapshot.identity, latest.identity) ||
    snapshot.contentHash !== latest.contentHash
  )
    throw configError('conflict');
  return latest;
}
/** A successful rename/link is irrevocably committed, even when cleanup/durability fails. */
export async function saveConfigSnapshot(snapshot, nextValues, { signal, fsApi = fs } = {}) {
  const warnings = [];
  if (nextValues === null || typeof nextValues !== 'object' || Array.isArray(nextValues))
    throw configError('invalid-json');
  if (checkStoredConfig(nextValues).errors.length) throw configError('invalid-value');
  let bytes;
  try {
    bytes = JSON.stringify(nextValues, null, 2) + '\n';
  } catch {
    throw configError('invalid-json');
  }
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw configError('unsafe-file');
  const parent = path.dirname(snapshot.path),
    lock = snapshot.path + '.lock',
    token = randomUUID();
  let lockId,
    lockCreated = false,
    pendingError,
    temp,
    tempId,
    committed = false;
  const cleanupTemp = async () => {
    if (!temp) return;
    const current = await targetState(temp, fsApi);
    if (current && same(parentIdentity(current), tempId)) await fsApi.unlink(temp);
  };
  const releaseLock = async () => {
    if (!lockCreated) return true;
    // mkdir alone does not prove ownership when its subsequent inspection failed.
    if (!lockId) return false;
    try {
      const current = await fsApi.lstat(lock);
      if (!same(parentIdentity(current), lockId)) throw configError('conflict');
      let owner;
      try {
        owner = JSON.parse(await fsApi.readFile(path.join(lock, 'owner.json'), 'utf8'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (owner && owner.token !== token) throw configError('conflict');
      if (owner) await fsApi.unlink(path.join(lock, 'owner.json'));
      await fsApi.rmdir(lock);
      return true;
    } catch {
      return false;
    }
  };
  try {
    abort(signal);
    if (!same(snapshot.parentIdentity, await parentState(parent, fsApi)))
      throw configError('conflict');
    try {
      await fsApi.mkdir(lock, { mode: 0o700 });
      lockCreated = true;
    } catch (e) {
      if (e.code === 'EEXIST') throw configError('lock-busy');
      throw e;
    }
    lockId = parentIdentity(await fsApi.lstat(lock));
    await fsApi.writeFile(
      path.join(lock, 'owner.json'),
      JSON.stringify({ token, pid: process.pid }),
      { flag: 'wx', mode: 0o600 }
    );
    await verify(snapshot, fsApi);
    abort(signal);
    temp = path.join(parent, '.warp-sql-server-mcp.tmp-' + randomUUID());
    const h = await fsApi.open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    try {
      tempId = parentIdentity(await h.stat());
      await h.writeFile(bytes, 'utf8');
      await h.sync();
    } finally {
      await h.close();
    }
    abort(signal);
    await verify(snapshot, fsApi);
    abort(signal);
    if (snapshot.exists) {
      await fsApi.rename(temp, snapshot.path);
      committed = true;
      temp = null;
    } else {
      await fsApi.link(temp, snapshot.path);
      committed = true;
    }
    // Do not inspect signal after publication: it cannot undo a committed save.
    try {
      await cleanupTemp();
      temp = null;
    } catch {
      warnings.push('temporary-cleanup');
    }
    let directory;
    try {
      directory = await fsApi.open(parent, constants.O_RDONLY);
      await directory.sync();
    } catch {
      warnings.push('directory-sync');
    } finally {
      if (directory)
        try {
          await directory.close();
        } catch {
          if (!warnings.includes('directory-sync')) warnings.push('directory-sync');
        }
    }
  } catch (e) {
    if (!committed) {
      try {
        await cleanupTemp();
      } catch {
        /* restrictive orphan may remain; never remove an unowned file */
      }
      pendingError = safeError(e);
    } else warnings.push('temporary-cleanup');
  } finally {
    if (!(await releaseLock())) {
      if (committed) warnings.push('lock-cleanup');
      else if (pendingError) pendingError.warningCodes = ['lock-cleanup-uncertain'];
    }
  }
  // Preserve the original failed/cancelled outcome; do not reread it as a saved result.
  if (pendingError) throw pendingError;
  let saved;
  try {
    saved = await readConfigSnapshot(snapshot.path, { fsApi });
  } catch {
    warnings.push('file-error');
  }
  return { committed, snapshot: saved, warningCodes: [...new Set(warnings)] };
}
