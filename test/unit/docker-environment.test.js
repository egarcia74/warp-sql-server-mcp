import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadRequiredDockerEnvironment } from '../docker/load-docker-environment.js';
import { ensureDockerPassword, writePrivateDockerCompose } from '../docker/detect-platform.js';

const initCli = fileURLToPath(new URL('../docker/init-db-node.js', import.meta.url));

function withDockerEnvironment(content, callback, mode = 0o600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-loader-'));
  const envPath = path.join(dir, '.env.docker');
  try {
    fs.writeFileSync(envPath, content, { mode });
    return callback(envPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('required Docker environment', () => {
  it.skipIf(process.platform === 'win32')(
    'overrides ambient credentials only after validating the file',
    () => {
      withDockerEnvironment(
        'MCP_TESTING_MODE=docker\nSQL_SERVER_HOST=localhost\nSQL_SERVER_PORT=14330\nSQL_SERVER_USER=sa\nSQL_SERVER_PASSWORD=LocalPasswordAa1!2026\n',
        envPath => {
          const environment = {
            MCP_TESTING_MODE: 'docker',
            SQL_SERVER_HOST: 'external.example',
            SQL_SERVER_PASSWORD: 'ExternalPasswordAa1!2026'
          };
          loadRequiredDockerEnvironment(environment, envPath);
          expect(environment).toMatchObject({
            SQL_SERVER_HOST: 'localhost',
            SQL_SERVER_PORT: '14330',
            SQL_SERVER_USER: 'sa',
            SQL_SERVER_PASSWORD: 'LocalPasswordAa1!2026'
          });
        }
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a missing generated file despite inherited external credentials',
    () => {
      const environment = {
        MCP_TESTING_MODE: 'docker',
        SQL_SERVER_HOST: 'external.example',
        SQL_SERVER_PASSWORD: 'ExternalPasswordAa1!2026'
      };
      expect(() => loadRequiredDockerEnvironment(environment, '/nonexistent/.env.docker')).toThrow(
        'Generated Docker environment is required'
      );
      expect(environment.SQL_SERVER_HOST).toBe('external.example');
    }
  );

  it.skipIf(process.platform === 'win32')('rejects an exposed Docker environment file', () => {
    withDockerEnvironment(
      'MCP_TESTING_MODE=docker\nSQL_SERVER_HOST=localhost\nSQL_SERVER_PORT=14330\nSQL_SERVER_USER=sa\nSQL_SERVER_PASSWORD=LocalPasswordAa1!2026\n',
      envPath => {
        expect(() =>
          loadRequiredDockerEnvironment({ MCP_TESTING_MODE: 'docker' }, envPath)
        ).toThrow('unsafe permissions or ownership');
      },
      0o644
    );
  });

  it.skipIf(process.platform !== 'darwin')(
    'rejects a 0600 credential with a macOS read ACL',
    () => {
      withDockerEnvironment(
        'MCP_TESTING_MODE=docker\nSQL_SERVER_HOST=localhost\nSQL_SERVER_PORT=14330\nSQL_SERVER_USER=sa\nSQL_SERVER_PASSWORD=LocalPasswordAa1!2026\n',
        envPath => {
          execFileSync('/bin/chmod', ['+a', 'everyone allow read', envPath]);
          expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
          expect(() =>
            loadRequiredDockerEnvironment({ MCP_TESTING_MODE: 'docker' }, envPath)
          ).toThrow('ACL');
        }
      );
    }
  );

  it.skipIf(process.platform !== 'darwin')(
    'refuses to write a new password into an ACL-inheriting directory',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-acl-'));
      const envPath = path.join(dir, '.env.docker');
      const composePath = path.join(dir, 'docker-compose.yml');
      const templatePath = path.join(dir, 'template');
      try {
        execFileSync('/bin/chmod', ['+a', 'everyone allow read,file_inherit', dir]);
        fs.writeFileSync(templatePath, 'MCP_TESTING_MODE=docker\nSQL_SERVER_PASSWORD=\n');
        expect(() => ensureDockerPassword(envPath, templatePath)).toThrow('ACL');
        expect(fs.readFileSync(envPath, 'utf8')).toBe('');
        expect(() => writePrivateDockerCompose(composePath, 'password: secret')).toThrow('ACL');
        expect(fs.readFileSync(composePath, 'utf8')).toBe('');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it('rejects calls outside explicit Docker mode', () => {
    expect(() => loadRequiredDockerEnvironment({}, '/nonexistent/.env.docker')).toThrow(
      'Docker testing mode is required'
    );
  });

  it.skipIf(process.platform === 'win32')(
    'refuses database initialization before connecting if the generated file is missing',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-init-missing-'));
      try {
        const result = spawnSync(process.execPath, [initCli], {
          cwd: dir,
          env: {
            ...process.env,
            MCP_TESTING_MODE: 'docker',
            SQL_SERVER_HOST: '127.0.0.1',
            SQL_SERVER_PORT: '1',
            SQL_SERVER_PASSWORD: 'ExternalPasswordAa1!2026'
          },
          encoding: 'utf8',
          timeout: 3000
        });
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Generated Docker environment is required');
        expect(result.stdout).not.toContain('Connecting to');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
