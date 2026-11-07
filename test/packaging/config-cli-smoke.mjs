/** Run against an actual fresh tarball installation; no repository node_modules fallback. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
const root = path.resolve(process.argv[2]),
  node = process.argv[3] || process.execPath;
for (const file of [
  'lib/cli/config-editor.js',
  'lib/cli/config-prompts.js',
  'lib/cli/config-validation-worker.js',
  'lib/config/config-store.js',
  'lib/config/environment.js'
])
  assert.ok(fs.existsSync(path.join(root, file)), `Packaged module missing: ${file}`);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'config-packed-home-'));
const env = { ...process.env, HOME: home, USERPROFILE: home };
function run(args) {
  const r = spawnSync(node, args, { cwd: root, env, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.error, undefined);
  return r;
}
async function packagedWorker() {
  const child = spawn(node, [path.join(root, 'lib/cli/config-validation-worker.js')], {
    cwd: home,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let received,
    bytes = '';
  child.stdout.on('data', b => (bytes += b));
  child.stderr.on('data', b => (bytes += b));
  child.on('message', r => (received = r));
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Packed worker timeout'));
    }, 5000);
    child.once('error', reject);
    child.once('exit', status => {
      clearTimeout(timer);
      resolve(status);
    });
    // No database access: cancellation is delivered before start, exercising the real entrypoint and IPC.
    child.send({ type: 'cancel' }, () => child.send({ type: 'start' }));
  });
  assert.equal(code, 0);
  assert.equal(received?.status, 'cancelled');
  assert.equal(received?.cleanup, 'complete');
  assert.equal(bytes, '');
}
async function packagedLegacyHandshake() {
  const child = spawn(node, [path.join(root, 'cli.js'), 'start'], {
    cwd: home,
    env: { ...env, NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let bytes = '',
    stderr = '',
    timer;
  child.stderr.on('data', b => (stderr += b));
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Packed legacy initialize timeout')), 5000);
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Packed legacy server exited before initialize')));
      child.stdout.on('data', chunk => {
        bytes += chunk;
        for (const line of bytes.split('\n').filter(Boolean)) {
          try {
            const frame = JSON.parse(line);
            if (frame.id === 1 && frame.result?.protocolVersion) resolve();
          } catch {
            /* an incomplete final line is checked after shutdown */
          }
        }
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'packed-smoke', version: '1' }
          }
        }) + '\n'
      );
    });
    assert.ok(stderr.includes('Starting Warp SQL Server MCP'));
  } finally {
    clearTimeout(timer);
    child.kill('SIGTERM'); // CLI forwards to its owned index child.
    const force = setTimeout(() => {
      if (process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* exited */
        }
      } else child.kill('SIGKILL');
    }, 2000);
    await exited;
    clearTimeout(force);
  }
  // Every stdout line must be a protocol frame, not dotenv or CLI chatter.
  for (const line of bytes.trim().split('\n')) assert.equal(JSON.parse(line).jsonrpc, '2.0');
}
try {
  const help = run(['cli.js', 'help']);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes('config edit'));
  assert.ok(help.stdout.includes('config validate'));
  assert.equal(run(['cli.js', 'config', 'edit']).status, 2);
  fs.writeFileSync(
    path.join(home, '.warp-sql-server-mcp.json'),
    JSON.stringify({ SQL_SERVER_PORT: 'invalid' })
  );
  assert.equal(run(['cli.js', 'config', 'validate']).status, 2);
  assert.equal(run(['cli.js', 'config', 'validate', 'extra']).status, 2);
  assert.equal(
    run([
      '--input-type=module',
      '-e',
      "import {PassThrough} from 'node:stream'; const {createPromptAdapter}=await import('./lib/cli/config-prompts.js'); const adapter=await createPromptAdapter({input:new PassThrough(),output:new PassThrough()}); adapter.dispose();"
    ]).status,
    0
  );
  fs.unlinkSync(path.join(home, '.warp-sql-server-mcp.json'));
  await packagedWorker();
  await packagedLegacyHandshake();
  console.log(
    'PASS: packaged modules, lazy production prompt dependency, help, non-TTY edit, non-TTY validation, strict arguments, spawned worker cancellation, legacy MCP initialize with protocol-only stdout.'
  );
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
