import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { runDockerIntegration } from '../../scripts/ci/run-docker-integration.mjs';
import { runDockerTestHelper } from '../../scripts/ci/run-docker-test-helper.mjs';

const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
const scripts = JSON.parse(readFileSync(packagePath, 'utf8')).scripts;

describe('Docker integration entrypoint', () => {
  it('passes Docker mode to the nested integration runner without shell-specific syntax', () => {
    const spawn = vi.fn(() => ({ status: 0 }));

    expect(runDockerIntegration(spawn, { EXISTING: 'yes', npm_execpath: '/npm-cli.js' })).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/npm-cli.js', 'run', 'test:integration:run'],
      expect.objectContaining({
        env: { EXISTING: 'yes', npm_execpath: '/npm-cli.js', MCP_TESTING_MODE: 'docker' }
      })
    );
  });

  it('leaves external integration credentials out of Docker mode', () => {
    expect(scripts['test:integration:ci']).toContain('npm run test:integration:run');
    expect(scripts['test:integration:manual']).not.toContain('MCP_TESTING_MODE=docker');
    expect(scripts['test:integration:protocol']).not.toContain('MCP_TESTING_MODE=docker');
  });

  it('uses portable commands for Docker-only scripts', () => {
    expect(scripts['test:integration']).toContain('node scripts/ci/run-docker-integration.mjs');
    for (const name of ['docker:start', 'docker:wait', 'docker:init', 'docker:test-connection']) {
      expect(scripts[name]).not.toMatch(/\b\w+=\w+\s+(?:npm|node)\b/);
    }
  });

  it('launches each Docker helper with Docker mode but no shell assignment', () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(runDockerTestHelper('wait', spawn, { EXISTING: 'yes' })).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [fileURLToPath(new URL('../docker/wait-for-db.js', import.meta.url))],
      expect.objectContaining({ env: { EXISTING: 'yes', MCP_TESTING_MODE: 'docker' } })
    );
    expect(scripts['docker:wait']).toContain('node scripts/ci/run-docker-test-helper.mjs wait');
    expect(scripts['docker:init']).toContain('node scripts/ci/run-docker-test-helper.mjs init');
    expect(scripts['docker:test-connection']).toContain(
      'node scripts/ci/run-docker-test-helper.mjs connect'
    );
  });

  it('refuses an unlisted Docker helper', () => {
    const spawn = vi.fn();
    expect(() => runDockerTestHelper('../unlisted', spawn)).toThrow('Unknown Docker test helper');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== 'win32')(
    'refuses the Docker generator at its real Windows CLI entrypoint',
    () => {
      const generatorPath = fileURLToPath(new URL('../docker/detect-platform.js', import.meta.url));
      const result = spawnSync(process.execPath, [generatorPath], {
        encoding: 'utf8',
        env: { ...process.env, TESTING_MODE: 'true' }
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Windows Docker credential storage is not supported');
    }
  );
});
