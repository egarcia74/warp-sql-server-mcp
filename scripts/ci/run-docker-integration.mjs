import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedScripts = new Set([
  'test:integration:run',
  'test:integration:manual',
  'test:integration:protocol',
  'test:integration:performance'
]);

export function runDockerIntegration(
  spawnProcess = spawnSync,
  environment = process.env,
  npmScript = 'test:integration:run'
) {
  if (!allowedScripts.has(npmScript)) {
    throw new Error(`Unknown Docker integration script: ${npmScript}`);
  }
  if (!environment.npm_execpath) {
    throw new Error('npm_execpath is required to run Docker integration tests');
  }
  const result = spawnProcess(process.execPath, [environment.npm_execpath, 'run', npmScript], {
    stdio: 'inherit',
    env: { ...environment, MCP_TESTING_MODE: 'docker' }
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = runDockerIntegration(spawnSync, process.env, process.argv[2]);
}
