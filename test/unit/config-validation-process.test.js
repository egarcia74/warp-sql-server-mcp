import { URL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { runConfigValidation } from '../../lib/cli/config-validation.js';
it.each(['good', 'invalid', 'crash', 'hang', 'disconnect'])(
  'real subprocess lifecycle: %s',
  async mode => {
    let child;
    const result = await runConfigValidation({
      resolved: {
        environment: {
          ...process.env,
          SQL_SERVER_PASSWORD: 'test-secret-1559',
          SQL_SERVER_USER: 'u'
        },
        sources: {}
      },
      spawnImpl: (exe, _args, options) =>
        (child = spawn(
          exe,
          [
            fileURLToPath(new URL('../fixtures/config-validation-process.js', import.meta.url)),
            mode
          ],
          options
        )),
      timers: { setTimeout: (fn, ms) => setTimeout(fn, Math.max(10, ms / 50)), clearTimeout }
    });
    expect(result.status).toBe(mode === 'good' ? 'success' : 'failure');
    expect(JSON.stringify(result)).not.toContain('test-secret-1559');
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  },
  5000
);
it('non-TTY validation reports local errors without changing file or leaking malformed text', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'config-command-'));
  const file = path.join(home, '.warp-sql-server-mcp.json');
  try {
    for (const bytes of ['{"SQL_SERVER_PORT":"wrong"}', '{"password":"test-secret-1559",bad}']) {
      fs.writeFileSync(file, bytes);
      const r = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('../../cli.js', import.meta.url)), 'config', 'validate'],
        { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 5000 }
      );
      expect(r.status).toBe(2);
      expect(r.stdout + r.stderr).not.toContain('test-secret-1559');
      expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
    }
    const usage = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../cli.js', import.meta.url)), 'config', 'validate', 'password'],
      { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 5000 }
    );
    expect(usage.status).toBe(2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
it('releases controller-host handles after unconfirmed worker termination', async () => {
  const host = spawn(
    process.execPath,
    [fileURLToPath(new URL('../fixtures/config-validation-host.js', import.meta.url))],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } }
  );
  let worker,
    received,
    output = '',
    timer;
  const exit = new Promise(resolve =>
    host.once('exit', (code, signal) => resolve({ code, signal }))
  );
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('host result was not received')), 3000);
      host.once('error', reject);
      host.stdout.on('data', bytes => {
        output += bytes;
        for (const line of output.split('\n').filter(Boolean)) {
          let row;
          try {
            row = JSON.parse(line);
          } catch {
            continue;
          }
          if (row.worker) worker = row.worker;
          if (row.result) {
            received = row.result;
            resolve();
          }
        }
      });
    });
    clearTimeout(timer);
    expect(received).toMatchObject({
      status: 'failure',
      category: 'total-timeout',
      cleanup: 'unconfirmed'
    });
    const outcome = await Promise.race([
      exit,
      new Promise(resolve => {
        timer = setTimeout(() => resolve('still alive'), 1000);
      })
    ]);
    expect(outcome).toEqual({ code: 0, signal: null });
  } finally {
    clearTimeout(timer);
    // The controller explicitly could not confirm disposal: harness cleans only its exact fixture.
    if (worker) {
      try {
        process.kill(worker, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
    if (host.exitCode === null && host.signalCode === null) host.kill('SIGKILL');
    await exit;
  }
}, 6000);
