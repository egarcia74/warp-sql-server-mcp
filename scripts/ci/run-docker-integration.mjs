import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function runDockerIntegration(spawnProcess = spawnSync, environment = process.env) {
  if (!environment.npm_execpath) {
    throw new Error('npm_execpath is required to run Docker integration tests');
  }
  const result = spawnProcess(
    process.execPath,
    [environment.npm_execpath, 'run', 'test:integration:run'],
    {
      stdio: 'inherit',
      env: { ...environment, MCP_TESTING_MODE: 'docker' }
    }
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runDockerIntegration();
}
