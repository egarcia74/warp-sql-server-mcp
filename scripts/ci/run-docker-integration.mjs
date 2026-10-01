import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function runDockerIntegration(
  spawnProcess = spawnSync,
  environment = process.env,
  npmScript = 'test:integration:run'
) {
  if (!environment.npm_execpath) {
    throw new Error('npm_execpath is required to run Docker integration tests');
  }
  const options = {
    stdio: 'inherit',
    env: { ...environment, MCP_TESTING_MODE: 'docker' }
  };
  let result;
  switch (npmScript) {
    case 'test:integration:run':
      result = spawnProcess(
        process.execPath,
        [environment.npm_execpath, 'run', 'test:integration:run'],
        options
      );
      break;
    case 'test:integration:manual':
      result = spawnProcess(
        process.execPath,
        [environment.npm_execpath, 'run', 'test:integration:manual'],
        options
      );
      break;
    case 'test:integration:protocol':
      result = spawnProcess(
        process.execPath,
        [environment.npm_execpath, 'run', 'test:integration:protocol'],
        options
      );
      break;
    case 'test:integration:performance':
      result = spawnProcess(
        process.execPath,
        [environment.npm_execpath, 'run', 'test:integration:performance'],
        options
      );
      break;
    default:
      throw new Error(`Unknown Docker integration script: ${npmScript}`);
  }
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = runDockerIntegration(spawnSync, process.env, process.argv[2]);
}
