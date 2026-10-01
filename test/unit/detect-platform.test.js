import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chooseBestConfiguration,
  ensureDockerPassword,
  generateDockerCompose,
  main
} from '../docker/detect-platform.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

const originalTestingMode = process.env.TESTING_MODE;
const dockerEnvPath = fileURLToPath(new URL('../docker/.env.docker', import.meta.url));

function runDetectionForHost(hostArch, hostPlatform, dockerArch) {
  const realOpenSync = fs.openSync;
  vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
    if (file === dockerEnvPath) {
      const error = new Error('Docker test environment not yet generated');
      error.code = 'ENOENT';
      throw error;
    }
    return realOpenSync(file, ...args);
  });
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'arch', { configurable: true, value: hostArch });
  Object.defineProperty(process, 'platform', { configurable: true, value: hostPlatform });
  vi.mocked(execSync).mockImplementation(command => {
    if (command.includes('--format')) return `${dockerArch}\n`;
    return '';
  });

  try {
    main();
  } finally {
    Object.defineProperty(process, 'arch', arch);
    Object.defineProperty(process, 'platform', platform);
  }
}

describe('Docker platform configuration selection', () => {
  beforeEach(() => {
    process.env.TESTING_MODE = 'true';
  });

  afterEach(() => {
    if (originalTestingMode === undefined) {
      delete process.env.TESTING_MODE;
    } else {
      process.env.TESTING_MODE = originalTestingMode;
    }
    vi.restoreAllMocks();
  });

  it('prefers native SQL Server on x64 even when Docker is unavailable', () => {
    const selected = chooseBestConfiguration(
      { arch: 'x64', isAppleSilicon: false },
      { hasDocker: false, supportsAMD64: false }
    );

    expect(selected).toMatchObject({
      reason: 'Native AMD64 architecture - optimal performance',
      performance: 'Excellent (native)',
      compatibility: 'Full SQL Server feature set',
      config: { platform: null, environment: { MSSQL_AGENT_ENABLED: 'true' } }
    });
    expect(generateDockerCompose(selected, 'GeneratedAa1!').services.sqlserver).toMatchObject({
      ports: ['127.0.0.1:14330:1433'],
      healthcheck: { interval: '10s', timeout: '5s', retries: 5, start_period: '30s' }
    });
  });

  it('uses the supplied local credential without copying it into the healthcheck command', () => {
    const selected = chooseBestConfiguration(
      { arch: 'x64', isAppleSilicon: false },
      { hasDocker: false, supportsAMD64: false }
    );
    const service = generateDockerCompose(selected, 'GeneratedAa1!').services.sqlserver;

    expect(service.environment.SA_PASSWORD).toBe('GeneratedAa1!');
    expect(service.healthcheck.test[1]).toContain('$$SA_PASSWORD');
    expect(service.healthcheck.test[1]).not.toContain('GeneratedAa1!');
  });

  it('publishes the local test database only on the host loopback interface', () => {
    const selected = chooseBestConfiguration(
      { arch: 'x64', isAppleSilicon: false },
      { hasDocker: false, supportsAMD64: false }
    );

    expect(generateDockerCompose(selected, 'GeneratedAa1!').services.sqlserver.ports).toEqual([
      '127.0.0.1:14330:1433'
    ]);
  });

  it('reuses the generated password across starts and keeps its file private', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-env-'));
    const envPath = path.join(dir, '.env.docker');
    const templatePath = path.join(dir, 'docker-env.template');
    try {
      fs.writeFileSync(templatePath, 'SQL_SERVER_HOST=localhost\nSQL_SERVER_PASSWORD=\n');
      const first = ensureDockerPassword(envPath, templatePath);
      const second = ensureDockerPassword(envPath, templatePath);

      expect(first).toMatch(/^[0-9a-f]{48}Aa1!$/);
      expect(second).toBe(first);
      expect(fs.readFileSync(envPath, 'utf8')).toBe(
        `SQL_SERVER_HOST=localhost\nSQL_SERVER_PASSWORD=${first}\n`
      );
      if (process.platform !== 'win32') {
        expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a weak existing Docker credential rather than reusing it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-env-'));
    const envPath = path.join(dir, '.env.docker');
    try {
      fs.writeFileSync(envPath, 'SQL_SERVER_PASSWORD=ShortAa1!\n');
      expect(() => ensureDockerPassword(envPath)).toThrow(
        'Docker test password is not strong enough'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'does not read a replacement path after opening the local credential',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-env-race-'));
      const envPath = path.join(dir, '.env.docker');
      const replacementPath = path.join(dir, 'replacement');
      const originalPassword = 'OriginalDockerPasswordAa1!2026';
      const replacementPassword = 'ReplacementDockerPasswordAa1!2026';
      const originalPath = path.join(dir, 'original');
      const realFstatSync = fs.fstatSync;
      let replaced = false;
      try {
        fs.writeFileSync(envPath, `SQL_SERVER_PASSWORD=${originalPassword}\n`);
        fs.writeFileSync(replacementPath, `SQL_SERVER_PASSWORD=${replacementPassword}\n`);
        fs.chmodSync(replacementPath, 0o644);
        vi.spyOn(fs, 'fstatSync').mockImplementation((descriptor, ...args) => {
          if (!replaced) {
            fs.renameSync(envPath, originalPath);
            fs.symlinkSync(replacementPath, envPath);
            replaced = true;
          }
          return realFstatSync(descriptor, ...args);
        });

        expect(ensureDockerPassword(envPath)).toBe(originalPassword);
        expect(replaced).toBe(true);
        expect(fs.statSync(originalPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(replacementPath).mode & 0o777).toBe(0o644);
      } finally {
        vi.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform === 'win32')('rejects a symlink as the Docker credential file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-env-link-'));
    const envPath = path.join(dir, '.env.docker');
    const targetPath = path.join(dir, 'target');
    try {
      fs.writeFileSync(targetPath, 'SQL_SERVER_PASSWORD=StrongDockerPasswordAa1!2026\n');
      fs.symlinkSync(targetPath, envPath);

      expect(() => ensureDockerPassword(envPath)).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')(
    'rejects a non-regular credential path without O_NOFOLLOW',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warp-docker-env-link-'));
      const envPath = path.join(dir, '.env.docker');
      const realLstatSync = fs.lstatSync;
      try {
        fs.writeFileSync(envPath, 'SQL_SERVER_PASSWORD=StrongDockerPasswordAa1!2026\n');
        vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...args) => {
          if (target === envPath) return { isFile: () => false };
          return realLstatSync(target, ...args);
        });

        expect(() => ensureDockerPassword(envPath)).toThrow(
          'Docker test environment must be a regular file'
        );
      } finally {
        vi.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );

  it('uses emulated SQL Server for Apple Silicon with AMD64 support', () => {
    const selected = chooseBestConfiguration(
      { arch: 'arm64', isAppleSilicon: true },
      { hasDocker: true, supportsAMD64: true }
    );

    expect(selected).toMatchObject({
      reason: 'Apple Silicon with Rosetta 2 emulation - full SQL Server compatibility',
      performance: 'Very Good (emulated via Rosetta 2)',
      compatibility: 'Full SQL Server feature set',
      config: { platform: 'linux/amd64', environment: { MSSQL_AGENT_ENABLED: 'true' } }
    });
    expect(generateDockerCompose(selected, 'GeneratedAa1!').services.sqlserver).toMatchObject({
      platform: 'linux/amd64',
      init: true,
      healthcheck: { interval: '15s', timeout: '10s', retries: 8, start_period: '45s' }
    });
  });

  it.each([
    [
      { arch: 'arm64', isAppleSilicon: true },
      { hasDocker: true, supportsAMD64: false }
    ],
    [
      { arch: 'arm64', isAppleSilicon: false },
      { hasDocker: true, supportsAMD64: true }
    ]
  ])('uses native SQL Edge when Rosetta is not available on the host', (hostInfo, dockerInfo) => {
    const selected = chooseBestConfiguration(hostInfo, dockerInfo);

    expect(selected).toMatchObject({
      reason: 'Native ARM64 architecture - best performance for ARM64',
      performance: 'Excellent (native ARM64)',
      compatibility: 'SQL Server core features (no SQL Agent)',
      config: { platform: null, environment: { MSSQL_AGENT_ENABLED: 'false' } }
    });
    expect(
      generateDockerCompose(selected, 'GeneratedAa1!').services.sqlserver.healthcheck
    ).toMatchObject({
      interval: '12s',
      timeout: '8s',
      retries: 6,
      start_period: '35s'
    });
  });

  it('rejects ARM64 when Docker is unavailable', () => {
    expect(() =>
      chooseBestConfiguration(
        { arch: 'arm64', isAppleSilicon: true },
        { hasDocker: false, supportsAMD64: true }
      )
    ).toThrow('Docker is not available or not running');
  });

  it('falls back to emulation on unknown architectures without requiring Docker', () => {
    const selected = chooseBestConfiguration(
      { arch: 'riscv64', isAppleSilicon: false },
      { hasDocker: false, supportsAMD64: false }
    );

    expect(selected).toMatchObject({
      reason: 'Unknown architecture - using emulation as fallback',
      performance: 'Unknown (emulated)',
      compatibility: 'Full SQL Server feature set',
      config: { platform: 'linux/amd64' }
    });
  });

  it('preserves the selection log order when not in test mode', () => {
    process.env.TESTING_MODE = 'false';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    chooseBestConfiguration(
      { arch: 'arm64', isAppleSilicon: true },
      { hasDocker: true, supportsAMD64: true }
    );

    expect(log.mock.calls).toEqual([
      ['\n🤔 Analyzing best configuration...'],
      ['✅ Apple Silicon with Rosetta 2 - using SQL Server 2022 (emulated)']
    ]);
  });

  it('writes YAML with unchanged quoting, indentation, array syntax, and file destinations', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const chmod = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runDetectionForHost('x64', 'linux', 'x86_64');

    expect(execSync).toHaveBeenCalledTimes(3);
    expect(log).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[0][0]).toMatch(/test\/docker\/\.env\.docker$/);
    expect(write.mock.calls[0][2]).toEqual({ flag: 'wx', mode: 0o600 });
    const password = write.mock.calls[0][1].match(/^SQL_SERVER_PASSWORD=([^\r\n]+)$/m)[1];
    expect(password).toMatch(/^[0-9a-f]{48}Aa1!$/);
    expect(write.mock.calls[1][0]).toMatch(/test\/docker\/docker-compose\.yml$/);
    expect(write.mock.calls[1][2]).toEqual({ mode: 0o600 });
    expect(chmod).toHaveBeenCalledWith(write.mock.calls[1][0], 0o600);
    expect(chmod.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[1]);
    expect(write.mock.calls[2][0]).toMatch(/test\/docker\/\.platform-config\.json$/);
    expect(write.mock.calls[1][1]).toBe(
      [
        'services:',
        '  sqlserver:',
        '    image: "mcr.microsoft.com/mssql/server:2022-latest@sha256:d1d2fa72786dd255f25ef85a4862510db1d4f9aa844519db565136311c0d7c7f"',
        '    container_name: warp-mcp-sqlserver',
        '    hostname: warp-mcp-sqlserver',
        '    environment:',
        '      ACCEPT_EULA: Y',
        `      SA_PASSWORD: ${password}`,
        '      MSSQL_PID: Developer',
        '      MSSQL_AGENT_ENABLED: "true"',
        '      MSSQL_COLLATION: SQL_Latin1_General_CP1_CI_AS',
        '    ports:',
        '      - 127.0.0.1:14330:1433',
        '    volumes:',
        '      - ./init-db.sql:/tmp/init-db.sql:ro',
        '      - sqlserver_data:/var/opt/mssql',
        '    healthcheck:',
        '      test:',
        '        - CMD-SHELL',
        '        - \'/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$$SA_PASSWORD" -C -Q "SELECT 1" || exit 1\'',
        '      interval: 10s',
        '      timeout: 5s',
        '      retries: 5',
        '      start_period: 30s',
        '    restart: unless-stopped',
        '    networks:',
        '      - warp-mcp-network',
        'volumes:',
        '  sqlserver_data:',
        '    driver: local',
        'networks:',
        '  warp-mcp-network:',
        '    driver: bridge',
        ''
      ].join('\n')
    );
    expect(JSON.parse(write.mock.calls[2][1])).toMatchObject({
      architecture: 'x64',
      platform: 'linux',
      selected: { reason: 'Native AMD64 architecture - optimal performance' },
      dockerCompose: 'docker-compose.yml'
    });
  });

  it('writes Apple Silicon overrides and string arrays to YAML', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    runDetectionForHost('arm64', 'darwin', 'aarch64');

    expect(execSync).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(3);
    const yaml = write.mock.calls[1][1];
    expect(yaml).toContain('    platform: linux/amd64\n');
    expect(yaml).toContain('      MSSQL_MEMORY_LIMIT_MB: 2048\n');
    expect(yaml).toContain('      start_period: 45s\n');
    expect(yaml).toContain('          memory: 2.5G\n');
    expect(yaml).toContain('    init: true\n');
    expect(yaml).toContain('    cap_add:\n      - SYS_PTRACE\n');
    expect(yaml).toContain('    security_opt:\n      - seccomp:unconfined\n');
    expect(yaml).toContain('    tmpfs:\n      - /tmp:noexec,nosuid,size=100m\n');
    expect(JSON.parse(write.mock.calls[2][1])).toMatchObject({
      architecture: 'arm64',
      platform: 'darwin',
      selected: { reason: 'Apple Silicon with Rosetta 2 emulation - full SQL Server compatibility' }
    });
  });

  it('escapes backslashes and double quotes in a special-character scalar', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    const selected = chooseBestConfiguration(
      { arch: 'x64', isAppleSilicon: false },
      { hasDocker: true, supportsAMD64: true }
    );
    const environment = selected.config.environment;
    const originalPid = environment.MSSQL_PID;
    environment.MSSQL_PID = 'Dev\\Tools "quoted" # tag';

    try {
      runDetectionForHost('x64', 'linux', 'x86_64');
    } finally {
      environment.MSSQL_PID = originalPid;
    }

    expect(write.mock.calls[1][1]).toContain(
      '      MSSQL_PID: "Dev\\\\Tools \\"quoted\\" # tag"\n'
    );
  });

  it('doubles every apostrophe in a quoted YAML array item', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    const selected = chooseBestConfiguration(
      { arch: 'x64', isAppleSilicon: false },
      { hasDocker: true, supportsAMD64: true }
    );
    const healthcheck = selected.config.healthcheck;
    const originalTest = healthcheck.test;
    healthcheck.test = ['CMD-SHELL', "O'Brien's 'quoted' setting"];

    try {
      runDetectionForHost('x64', 'linux', 'x86_64');
    } finally {
      healthcheck.test = originalTest;
    }

    expect(write.mock.calls[1][1]).toContain("        - 'O''Brien''s ''quoted'' setting'\n");
  });
});
