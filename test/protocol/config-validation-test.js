/** Bounded CLI probes against the existing dedicated Docker fixture, never the user's home. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadRequiredDockerEnvironment } from '../docker/load-docker-environment.js';
const environment = { ...process.env };
let home;
function probe(env) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../../cli.js', import.meta.url)), 'config', 'validate'],
    {
      env: { ...env, HOME: home, USERPROFILE: home },
      cwd: home,
      encoding: 'utf8',
      timeout: 65000,
      maxBuffer: 65536,
      killSignal: 'SIGKILL'
    }
  );
}
function clean(r, secrets) {
  return (
    r.status === 0 &&
    !r.error &&
    !r.signal &&
    secrets.every(secret => !(r.stdout + r.stderr).includes(secret))
  );
}
try {
  loadRequiredDockerEnvironment(environment);
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'config-cli-live-'));
  const normal = probe(environment);
  const normalClean =
    clean(normal, [environment.SQL_SERVER_PASSWORD]) && fs.readdirSync(home).length === 0;
  console.log(`Configuration CLI fixed SELECT 1 probe: ${normalClean ? 'PASSED' : 'FAILED'}`);
  if (!normalClean) throw new Error('normal-probe');

  // Saved controls must select the real fixture over both a decoy default source and saved target.
  const inherited = { ...environment };
  for (const key of Object.keys(inherited))
    if (/^(SQL_SERVER_|DOTENV_)/i.test(key)) delete inherited[key];
  const saved = JSON.stringify({
    DOTENV_PATH: 'selected.env',
    DOTENV_OVERRIDE: 'true',
    SQL_SERVER_HOST: 'invalid.invalid',
    SQL_SERVER_USER: 'u',
    SQL_SERVER_PASSWORD: 'unused-live-saved-password'
  });
  const target = path.join(home, '.warp-sql-server-mcp.json');
  fs.writeFileSync(target, saved, { mode: 0o600 });
  fs.writeFileSync(path.join(home, '.env'), 'SQL_SERVER_HOST=decoy.invalid\n', { mode: 0o600 });
  const selected = Object.entries(environment).filter(([key]) => key.startsWith('SQL_SERVER_'));
  // Dedicated fixture generator uses printable quote/backslash-free values. Never log credentials.
  if (selected.some(([, value]) => /["\\\r\n]/.test(value))) throw new Error('fixture-encoding');
  fs.writeFileSync(
    path.join(home, 'selected.env'),
    selected.map(([key, value]) => `${key}="${value}"`).join('\n') + '\n',
    { mode: 0o600 }
  );
  const parity = probe(inherited);
  const parityClean =
    clean(parity, [environment.SQL_SERVER_PASSWORD, 'unused-live-saved-password']) &&
    parity.stdout.includes(`SQL_SERVER_HOST: ${environment.SQL_SERVER_HOST} [dotenv]`) &&
    fs.readFileSync(target, 'utf8') === saved &&
    fs.readdirSync(home).sort().join(',') === '.env,.warp-sql-server-mcp.json,selected.env';
  console.log(
    `Configuration CLI saved dotenv target-parity SELECT 1 probe: ${parityClean ? 'PASSED' : 'FAILED'}`
  );
  process.exitCode = parityClean ? 0 : 1;
} catch {
  console.error('Configuration CLI live test could not complete.');
  process.exitCode = 1;
} finally {
  if (home) fs.rmSync(home, { recursive: true, force: true });
}
