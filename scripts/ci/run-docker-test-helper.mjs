import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const helperPaths = {
  wait: fileURLToPath(new URL('../../test/docker/wait-for-db.js', import.meta.url)),
  init: fileURLToPath(new URL('../../test/docker/init-db-node.js', import.meta.url)),
  connect: fileURLToPath(new URL('../../test/docker/test-connectivity.js', import.meta.url))
};

export function runDockerTestHelper(kind, spawnProcess = spawnSync, environment = process.env) {
  if (!Object.hasOwn(helperPaths, kind)) {
    throw new Error(`Unknown Docker test helper: ${kind}`);
  }
  const result = spawnProcess(process.execPath, [helperPaths[kind]], {
    stdio: 'inherit',
    env: { ...environment, MCP_TESTING_MODE: 'docker' }
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = runDockerTestHelper(process.argv[2]);
}
