import { URL } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readConfigSnapshot, saveConfigSnapshot } from '../../lib/config/config-store.js';
let home, file;
const original = { SQL_SERVER_HOST: 'old', unknown: { nested: [1, true, null] } };
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'config-store-'));
  file = path.join(home, '.warp-sql-server-mcp.json');
  await fs.writeFile(file, JSON.stringify(original), { mode: 0o600 });
});
afterEach(async () => {
  await fs.chmod(home, 0o700);
  await fs.rm(home, { recursive: true, force: true });
});
describe('safe snapshot and atomic publication', () => {
  it('preserves unknown keys/types and publishes restrictive replacement', async () => {
    const s = await readConfigSnapshot(file);
    const r = await saveConfigSnapshot(s, { ...s.values, SQL_SERVER_PORT: '1559' });
    expect(r.committed).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      ...original,
      SQL_SERVER_PORT: '1559'
    });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
  });
  it.each(['null', '[]', '3', '{"password":"test-secret-1559",bad}', 'x'.repeat(1048577)])(
    'rejects malformed/oversized input without leaking bytes %#',
    async bytes => {
      await fs.writeFile(file, bytes);
      try {
        await readConfigSnapshot(file);
        throw new Error('accepted');
      } catch (e) {
        expect(e.code).toMatch(/invalid-json|unsafe-file/);
        expect(String(e)).not.toContain('test-secret-1559');
      }
    }
  );
  it('refuses symlinks, hardlinks, directories and writable home', async () => {
    await fs.rename(file, file + '.real');
    await fs.symlink(file + '.real', file);
    await expect(readConfigSnapshot(file)).rejects.toMatchObject({ code: 'unsafe-file' });
    await fs.unlink(file);
    await fs.link(file + '.real', file);
    await expect(readConfigSnapshot(file)).rejects.toMatchObject({ code: 'unsafe-file' });
    await fs.unlink(file);
    await fs.mkdir(file);
    await expect(readConfigSnapshot(file)).rejects.toMatchObject({ code: 'unsafe-file' });
    await fs.rm(file, { recursive: true });
    await fs.chmod(home, 0o777);
    await expect(readConfigSnapshot(file)).rejects.toMatchObject({ code: 'unsafe-file' });
  });
  it('creates absent targets once and detects external edits', async () => {
    const s = await readConfigSnapshot(file);
    await fs.writeFile(file, '{"SQL_SERVER_HOST":"external"}');
    await expect(saveConfigSnapshot(s, {})).rejects.toMatchObject({ code: 'conflict' });
    await fs.unlink(file);
    const missing = await readConfigSnapshot(file);
    expect(missing.exists).toBe(false);
    expect((await saveConfigSnapshot(missing, { SQL_SERVER_HOST: 'new' })).committed).toBe(true);
    await expect(saveConfigSnapshot(missing, {})).rejects.toMatchObject({ code: 'conflict' });
  });
  it('never breaks busy/stale locks', async () => {
    const s = await readConfigSnapshot(file);
    await fs.mkdir(file + '.lock');
    await fs.writeFile(file + '.lock/owner.json', '{}');
    await expect(saveConfigSnapshot(s, {})).rejects.toMatchObject({ code: 'lock-busy' });
    expect(await fs.readFile(file + '.lock/owner.json', 'utf8')).toBe('{}');
  });
  it('cancels before publication and leaves original intact', async () => {
    const s = await readConfigSnapshot(file);
    const c = new globalThis.AbortController();
    c.abort();
    await expect(saveConfigSnapshot(s, {}, { signal: c.signal })).rejects.toMatchObject({
      code: 'cancelled'
    });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(original);
    expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
  });
  for (const phase of ['open', 'writeFile', 'sync', 'close', 'rename', 'link'])
    it(`preserves previous state on injected ${phase} failure`, async () => {
      if (phase === 'link') await fs.unlink(file);
      const s = await readConfigSnapshot(file);
      const fsApi = {
        ...fs,
        open: async (p, ...args) => {
          if (String(p).includes('.tmp-')) {
            if (phase === 'open')
              throw Object.assign(new Error('test-secret-1559'), { code: 'ENOSPC' });
            const h = await fs.open(p, ...args);
            return new Proxy(h, {
              get: (t, k) => {
                if (k === phase)
                  return async () => {
                    if (k === 'close') await t.close();
                    throw new Error('test-secret-1559');
                  };
                const v = t[k];
                return typeof v === 'function' ? v.bind(t) : v;
              }
            });
          }
          return fs.open(p, ...args);
        }
      };
      if (['rename', 'link'].includes(phase))
        fsApi[phase] = async () => {
          throw new Error('test-secret-1559');
        };
      await expect(
        saveConfigSnapshot(s, { SQL_SERVER_HOST: 'new' }, { fsApi })
      ).rejects.toMatchObject({ code: 'file-error' });
      expect(await fs.readdir(home)).toEqual(phase === 'link' ? [] : ['.warp-sql-server-mcp.json']);
      if (s.exists) expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(original);
    });
  it('reports committed state after durability/temporary cleanup failures and cancellation', async () => {
    await fs.unlink(file);
    const s = await readConfigSnapshot(file);
    const c = new globalThis.AbortController();
    const parent = await fs.realpath(home);
    const fsApi = {
      ...fs,
      link: async (...args) => {
        await fs.link(...args);
        c.abort();
      },
      unlink: async p => {
        if (p.includes('.tmp-')) throw new Error('private');
        return fs.unlink(p);
      },
      open: async (p, ...args) => {
        if (p === parent) throw new Error('private');
        return fs.open(p, ...args);
      }
    };
    const r = await saveConfigSnapshot(s, { SQL_SERVER_HOST: 'new' }, { signal: c.signal, fsApi });
    expect(r.committed).toBe(true);
    expect(r.warningCodes).toEqual(expect.arrayContaining(['temporary-cleanup', 'directory-sync']));
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ SQL_SERVER_HOST: 'new' });
  });
  it.each([false, true])(
    'two real processes cannot overwrite the same baseline, absent=%s',
    async absent => {
      if (absent) await fs.unlink(file);
      const children = [0, 1].map(() =>
        fork(new URL('../fixtures/config-store-process.js', import.meta.url), [file], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          execArgv: []
        })
      );
      const ready = await Promise.all(children.map(c => once(c, 'message')));
      expect(ready.map(r => r[0])).toEqual(['ready', 'ready']);
      const results = children.map(c => once(c, 'message'));
      children[0].send({ SQL_SERVER_HOST: 'first' });
      children[1].send({ SQL_SERVER_HOST: 'second' });
      const statuses = (await Promise.all(results)).map(([r]) => r);
      await Promise.all(
        children.map(c => (c.exitCode === null ? once(c, 'exit') : Promise.resolve()))
      );
      expect(statuses.filter(r => r.committed)).toHaveLength(1);
      expect(statuses.find(r => r.code)?.code).toMatch(/lock-busy|conflict/);
      expect(['first', 'second']).toContain(
        JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_HOST
      );
      expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
    }
  );
});
it.skipIf(process.platform === 'win32')(
  'refuses a different target owner without opening or modifying the target',
  async () => {
    const s = await fs.lstat(file);
    const canonicalFile = await fs.realpath(file);
    const bytes = await fs.readFile(file);
    const fsApi = {
      ...fs,
      lstat: async p =>
        p === canonicalFile
          ? new Proxy(s, {
              get: (target, key) =>
                key === 'uid'
                  ? s.uid + 1
                  : typeof target[key] === 'function'
                    ? target[key].bind(target)
                    : target[key]
            })
          : fs.lstat(p)
    };
    await expect(readConfigSnapshot(file, { fsApi })).rejects.toMatchObject({
      code: 'unsafe-file'
    });
    expect(await fs.readFile(file)).toEqual(bytes);
  }
);
it('refuses a replaced parent directory identity before acquiring the save lock', async () => {
  const s = await readConfigSnapshot(file);
  const oldHome = home + '-old';
  await fs.rename(home, oldHome);
  try {
    await fs.mkdir(home, { mode: 0o700 });
    await fs.writeFile(file, '{"SQL_SERVER_HOST":"external"}', { mode: 0o600 });
    await expect(saveConfigSnapshot(s, { SQL_SERVER_HOST: 'new' })).rejects.toMatchObject({
      code: 'conflict'
    });
    expect(await fs.readFile(file, 'utf8')).toBe('{"SQL_SERVER_HOST":"external"}');
    expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
  } finally {
    await fs.rm(oldHome, { recursive: true, force: true });
  }
});
it('does not remove a lock whose owner token was replaced after publication', async () => {
  const s = await readConfigSnapshot(file);
  const lockOwner = file + '.lock/owner.json';
  const fsApi = {
    ...fs,
    rename: async (...args) => {
      await fs.rename(...args);
      await fs.writeFile(
        lockOwner,
        JSON.stringify({ token: 'replacement-owner', pid: process.pid })
      );
    }
  };
  const result = await saveConfigSnapshot(s, { SQL_SERVER_HOST: 'new' }, { fsApi });
  expect(result.committed).toBe(true);
  expect(result.warningCodes).toContain('lock-cleanup');
  expect(JSON.parse(await fs.readFile(lockOwner, 'utf8')).token).toBe('replacement-owner');
  expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_HOST).toBe('new');
});
it('cancels after temporary-file flush and before publication without changing the original', async () => {
  const s = await readConfigSnapshot(file);
  const controller = new globalThis.AbortController();
  const fsApi = {
    ...fs,
    open: async (p, ...args) => {
      const h = await fs.open(p, ...args);
      if (!String(p).includes('.tmp-')) return h;
      return new Proxy(h, {
        get: (target, key) =>
          key === 'sync'
            ? async () => {
                await target.sync();
                controller.abort();
              }
            : typeof target[key] === 'function'
              ? target[key].bind(target)
              : target[key]
      });
    }
  };
  await expect(
    saveConfigSnapshot(s, { SQL_SERVER_HOST: 'new' }, { fsApi, signal: controller.signal })
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(original);
  expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
});
it('contains non-ENOENT target inspection failure without changing stored bytes', async () => {
  const bytes = await fs.readFile(file);
  await expect(
    readConfigSnapshot(file, {
      fsApi: {
        ...fs,
        lstat: async () => {
          throw Object.assign(new Error('credential-store-1561'), { code: 'EACCES' });
        }
      }
    })
  ).rejects.toMatchObject({ code: 'file-error' });
  expect(await fs.readFile(file)).toEqual(bytes);
});
it('rejects a target changed after descriptor reading instead of blessing the new bytes', async () => {
  let inspections = 0;
  const fsApi = {
    ...fs,
    lstat: async p => {
      if (++inspections === 2) await fs.writeFile(file, '{"SQL_SERVER_HOST":"external"}');
      return fs.lstat(p);
    }
  };
  await expect(readConfigSnapshot(file, { fsApi })).rejects.toMatchObject({ code: 'conflict' });
  expect(await fs.readFile(file, 'utf8')).toBe('{"SQL_SERVER_HOST":"external"}');
});
it('rejects nonobject and unserializable drafts before locks or publication', async () => {
  const snapshot = await readConfigSnapshot(file);
  const cyclic = {};
  cyclic.child = cyclic;
  const bytes = await fs.readFile(file);
  for (const values of [null, [], 3, { unknown: 1n }, cyclic]) {
    await expect(saveConfigSnapshot(snapshot, values)).rejects.toMatchObject({
      code: 'invalid-json'
    });
    expect(await fs.readFile(file)).toEqual(bytes);
    expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
  }
});
it('does not delete a lock whose owner token cannot be read after publication', async () => {
  const snapshot = await readConfigSnapshot(file);
  const fsApi = {
    ...fs,
    readFile: async (p, ...args) => {
      if (String(p).endsWith('owner.json')) throw new Error('credential-store-1561');
      return fs.readFile(p, ...args);
    }
  };
  const saved = await saveConfigSnapshot(snapshot, { SQL_SERVER_HOST: 'new' }, { fsApi });
  expect(saved.committed).toBe(true);
  expect(saved.warningCodes).toContain('lock-cleanup');
  expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_HOST).toBe('new');
  expect(JSON.parse(await fs.readFile(file + '.lock/owner.json', 'utf8')).pid).toBe(process.pid);
});
it('contains non-busy lock creation failure without changing the original', async () => {
  const snapshot = await readConfigSnapshot(file);
  const bytes = await fs.readFile(file);
  const fsApi = {
    ...fs,
    mkdir: async () => {
      throw Object.assign(new Error('credential-store-1561'), { code: 'EACCES' });
    }
  };
  await expect(
    saveConfigSnapshot(snapshot, { SQL_SERVER_HOST: 'new' }, { fsApi })
  ).rejects.toMatchObject({ code: 'file-error' });
  expect(await fs.readFile(file)).toEqual(bytes);
  expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
});
it.each(['inspection', 'owner-absent', 'owner-partial'])(
  'reports only uncertain acquisition cleanup after %s failure',
  async phase => {
    const snapshot = await readConfigSnapshot(file);
    const bytes = await fs.readFile(file);
    const lock = snapshot.path + '.lock';
    const fsApi = {
      ...fs,
      lstat: async p => {
        if (p === lock && phase === 'inspection') throw new Error('credential-lock-1561');
        return fs.lstat(p);
      },
      writeFile: async (p, ...args) => {
        if (p === path.join(lock, 'owner.json')) {
          if (phase === 'owner-partial') await fs.writeFile(p, '{"token":');
          throw new Error('credential-lock-1561');
        }
        return fs.writeFile(p, ...args);
      }
    };
    const error = await saveConfigSnapshot(snapshot, { SQL_SERVER_HOST: 'new' }, { fsApi }).catch(
      e => e
    );
    expect(error.code).toBe('file-error');
    expect(error.warningCodes).toEqual(
      phase === 'owner-absent' ? undefined : ['lock-cleanup-uncertain']
    );
    expect(String(error)).not.toContain('credential-lock-1561');
    const after = await readConfigSnapshot(file);
    expect(await fs.readFile(file)).toEqual(bytes);
    expect(after.identity).toEqual(snapshot.identity);
    if (phase === 'owner-absent') {
      await expect(fs.lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      expect((await fs.lstat(lock)).isDirectory()).toBe(true);
      if (phase === 'owner-partial')
        expect(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')).toBe('{"token":');
      else expect(await fs.readdir(lock)).toEqual([]);
    }
  }
);
it.each(['readFile', 'unlink', 'rmdir'])(
  'preserves failed save and original identity when lock %s cleanup fails',
  async phase => {
    const snapshot = await readConfigSnapshot(file);
    const bytes = await fs.readFile(file);
    const lock = snapshot.path + '.lock';
    const fsApi = {
      ...fs,
      open: async (p, ...args) => {
        if (String(p).includes('.tmp-')) throw new Error('credential-lock-1561');
        return fs.open(p, ...args);
      },
      [phase]: async (p, ...args) => {
        if (p === lock || p === path.join(lock, 'owner.json'))
          throw new Error('credential-lock-1561');
        return fs[phase](p, ...args);
      }
    };
    const error = await saveConfigSnapshot(snapshot, { SQL_SERVER_HOST: 'new' }, { fsApi }).catch(
      e => e
    );
    expect(error).toMatchObject({ code: 'file-error', warningCodes: ['lock-cleanup-uncertain'] });
    expect(await fs.readFile(file)).toEqual(bytes);
    expect((await readConfigSnapshot(file)).identity).toEqual(snapshot.identity);
    expect((await fs.lstat(lock)).isDirectory()).toBe(true);
  }
);
it.each(['conflict', 'cancelled'])(
  'retains the primary %s outcome when lock cleanup is uncertain',
  async code => {
    const snapshot = await readConfigSnapshot(file);
    const bytes = await fs.readFile(file);
    const controller = new globalThis.AbortController();
    const fsApi = {
      ...fs,
      writeFile: async (...args) => {
        await fs.writeFile(...args);
        if (code === 'cancelled') controller.abort();
      },
      readFile: async (p, ...args) => {
        if (String(p).endsWith('owner.json')) throw new Error('credential-lock-1561');
        return fs.readFile(p, ...args);
      }
    };
    const baseline = code === 'conflict' ? { ...snapshot, contentHash: 'stale' } : snapshot;
    const error = await saveConfigSnapshot(
      baseline,
      {},
      { fsApi, signal: controller.signal }
    ).catch(e => e);
    expect(error).toMatchObject({ code, warningCodes: ['lock-cleanup-uncertain'] });
    expect(await fs.readFile(file)).toEqual(bytes);
    expect((await readConfigSnapshot(file)).identity).toEqual(snapshot.identity);
  }
);
it.each(['token', 'identity'])(
  'never removes a pre-publication replacement lock %s and reports uncertainty',
  async replacement => {
    const snapshot = await readConfigSnapshot(file);
    const bytes = await fs.readFile(file);
    const lock = snapshot.path + '.lock';
    const replacementBytes = '{"token":"replacement-owner","pid":2147483647}';
    const fsApi = {
      ...fs,
      open: async (p, ...args) => {
        if (String(p).includes('.tmp-')) {
          if (replacement === 'identity') {
            await fs.rename(lock, lock + '.old');
            await fs.mkdir(lock);
          }
          await fs.writeFile(path.join(lock, 'owner.json'), replacementBytes);
          throw new Error('credential-lock-1561');
        }
        return fs.open(p, ...args);
      }
    };
    const error = await saveConfigSnapshot(snapshot, {}, { fsApi }).catch(e => e);
    expect(error).toMatchObject({ code: 'file-error', warningCodes: ['lock-cleanup-uncertain'] });
    expect(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')).toBe(replacementBytes);
    expect(await fs.readFile(file)).toEqual(bytes);
    expect((await readConfigSnapshot(file)).identity).toEqual(snapshot.identity);
  }
);
it('preserves a synthetic dead-PID lock without consulting or taking over its owner', async () => {
  const snapshot = await readConfigSnapshot(file);
  const bytes = await fs.readFile(file);
  const lock = snapshot.path + '.lock';
  const owner = '{"token":"stale-owner","pid":2147483647}';
  await fs.mkdir(lock);
  await fs.writeFile(path.join(lock, 'owner.json'), owner);
  const identity = await fs.lstat(lock);
  const error = await saveConfigSnapshot(snapshot, {}).catch(e => e);
  expect(error.code).toBe('lock-busy');
  expect(error.warningCodes).toBeUndefined();
  expect(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')).toBe(owner);
  expect((await fs.lstat(lock)).ino).toBe(identity.ino);
  expect(await fs.readFile(file)).toEqual(bytes);
});
it('adds no cleanup warning after a failed save releases its verified lock', async () => {
  const snapshot = await readConfigSnapshot(file);
  const bytes = await fs.readFile(file);
  const fsApi = {
    ...fs,
    open: async (p, ...args) => {
      if (String(p).includes('.tmp-')) throw new Error('credential-lock-1561');
      return fs.open(p, ...args);
    }
  };
  const error = await saveConfigSnapshot(snapshot, {}, { fsApi }).catch(e => e);
  expect(error.code).toBe('file-error');
  expect(error.warningCodes).toBeUndefined();
  expect(await fs.readFile(file)).toEqual(bytes);
  expect(await fs.readdir(home)).toEqual(['.warp-sql-server-mcp.json']);
});
