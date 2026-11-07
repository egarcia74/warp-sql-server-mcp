import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { validateConfigCommand } from '../../lib/cli/config-validation.js';
import { createConfigOutput } from '../../lib/cli/config-output.js';
vi.unmock('dotenv');
vi.mock('node:child_process', () => ({
  spawn: (_exe, _args, options) => {
    const child = new EventEmitter();
    child.send = () =>
      globalThis.queueMicrotask(() => {
        // Only the selected password enters the actual worker environment; never candidate metadata.
        expect(options.env.SQL_SERVER_PASSWORD).toBe('winning-password');
        expect(Object.keys(options.env)).not.toContain('passwordCandidates');
        child.emit('message', {
          version: 1,
          status: 'success',
          category: 'ok',
          stage: 'finished',
          elapsedMs: 1,
          attempts: 1,
          cleanup: 'complete'
        });
        child.emit('exit', 0, null);
      });
    return child;
  }
}));
it.each(['inherited', 'file'])(
  'standalone output redacts unused dotenv passwords overridden by %s',
  async winner => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'config-output-'));
    let text = '';
    try {
      await fs.writeFile(
        path.join(home, '.env'),
        'SQL_SERVER_PASSWORD=hidden-dotenv-review-1559\n'
      );
      const file = path.join(home, '.warp-sql-server-mcp.json');
      const bytes = JSON.stringify({
        SQL_SERVER_USER: 'u',
        SQL_SERVER_HOST: 'hidden-dotenv-review-1559',
        ...(winner === 'file' ? { SQL_SERVER_PASSWORD: 'winning-password' } : {})
      });
      await fs.writeFile(file, bytes);
      const code = await validateConfigCommand({
        cwd: home,
        inherited: {
          HOME: home,
          ...(winner === 'inherited' ? { SQL_SERVER_PASSWORD: 'winning-password' } : {})
        },
        output: createConfigOutput({
          stdout: { write: s => (text += s) },
          stderr: { write: s => (text += s) }
        })
      });
      expect(code).toBe(0);
      expect(text.includes('hidden-dotenv-review-1559')).toBe(false);
      expect(text.includes('winning-password')).toBe(false);
      expect(await fs.readFile(file, 'utf8')).toBe(bytes);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }
);
