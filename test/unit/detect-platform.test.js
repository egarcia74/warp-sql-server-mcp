import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseBestConfiguration, generateDockerCompose, main } from '../docker/detect-platform.js';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

const originalTestingMode = process.env.TESTING_MODE;

function runDetectionForHost(hostArch, hostPlatform, dockerArch) {
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
    expect(generateDockerCompose(selected).services.sqlserver).toMatchObject({
      ports: ['14330:1433'],
      healthcheck: { interval: '10s', timeout: '5s', retries: 5, start_period: '30s' }
    });
  });

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
    expect(generateDockerCompose(selected).services.sqlserver).toMatchObject({
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
    expect(generateDockerCompose(selected).services.sqlserver.healthcheck).toMatchObject({
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
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runDetectionForHost('x64', 'linux', 'x86_64');

    expect(execSync).toHaveBeenCalledTimes(3);
    expect(log).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0][0]).toMatch(/test\/docker\/docker-compose\.yml$/);
    expect(write.mock.calls[1][0]).toMatch(/test\/docker\/\.platform-config\.json$/);
    expect(write.mock.calls[0][1]).toBe(
      [
        'services:',
        '  sqlserver:',
        '    image: "mcr.microsoft.com/mssql/server:2022-latest@sha256:d1d2fa72786dd255f25ef85a4862510db1d4f9aa844519db565136311c0d7c7f"',
        '    container_name: warp-mcp-sqlserver',
        '    hostname: warp-mcp-sqlserver',
        '    environment:',
        '      ACCEPT_EULA: Y',
        '      SA_PASSWORD: WarpMCP123!',
        '      MSSQL_PID: Developer',
        '      MSSQL_AGENT_ENABLED: "true"',
        '      MSSQL_COLLATION: SQL_Latin1_General_CP1_CI_AS',
        '    ports:',
        '      - 14330:1433',
        '    volumes:',
        '      - ./init-db.sql:/tmp/init-db.sql:ro',
        '      - sqlserver_data:/var/opt/mssql',
        '    healthcheck:',
        '      test:',
        '        - CMD-SHELL',
        '        - \'/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P WarpMCP123! -C -Q "SELECT 1" || exit 1\'',
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
    expect(JSON.parse(write.mock.calls[1][1])).toMatchObject({
      architecture: 'x64',
      platform: 'linux',
      selected: { reason: 'Native AMD64 architecture - optimal performance' },
      dockerCompose: 'docker-compose.yml'
    });
  });

  it('writes Apple Silicon overrides and string arrays to YAML', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    runDetectionForHost('arm64', 'darwin', 'aarch64');

    expect(execSync).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(2);
    const yaml = write.mock.calls[0][1];
    expect(yaml).toContain('    platform: linux/amd64\n');
    expect(yaml).toContain('      MSSQL_MEMORY_LIMIT_MB: 2048\n');
    expect(yaml).toContain('      start_period: 45s\n');
    expect(yaml).toContain('          memory: 2.5G\n');
    expect(yaml).toContain('    init: true\n');
    expect(yaml).toContain('    cap_add:\n      - SYS_PTRACE\n');
    expect(yaml).toContain('    security_opt:\n      - seccomp:unconfined\n');
    expect(yaml).toContain('    tmpfs:\n      - /tmp:noexec,nosuid,size=100m\n');
    expect(JSON.parse(write.mock.calls[1][1])).toMatchObject({
      architecture: 'arm64',
      platform: 'darwin',
      selected: { reason: 'Apple Silicon with Rosetta 2 emulation - full SQL Server compatibility' }
    });
  });
});
