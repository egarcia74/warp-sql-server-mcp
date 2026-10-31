import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const lifecycle = await import('../../scripts/ci/sql-test-lifecycle.mjs').catch(() => ({}));
const roots = [];
const root = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-lifecycle-unit-'));
  roots.push(directory);
  return directory;
};
afterEach(() => roots.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true })));

function onDarwin(callback) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { ...original, value: 'darwin' });
    return callback();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

function fixture(options = {}) {
  const cwd = fs.realpathSync(options.cwd ?? root());
  const dockerDir = path.join(cwd, 'test/docker');
  fs.mkdirSync(dockerDir, { recursive: true });
  fs.copyFileSync(
    path.resolve('test/docker/docker-env.template'),
    path.join(dockerDir, 'docker-env.template')
  );
  const compose = path.join(dockerDir, 'docker-compose.yml');
  let project = 'docker';
  let volume = 'docker_sqlserver_data';
  let network = 'docker_warp-mcp-network';
  const id = 'a'.repeat(64);
  const created = new Date().toISOString();
  const container = {
    Id: id,
    State: { Running: true, Status: 'running', Pid: 123 },
    Name: '/warp-mcp-sqlserver',
    Created: created,
    Config: {
      Labels: {
        'com.docker.compose.project': project,
        'com.docker.compose.service': 'sqlserver',
        'com.docker.compose.project.working_dir': dockerDir,
        'com.docker.compose.project.config_files': compose
      },
      Env: ['SA_PASSWORD=private-fixture-value']
    },
    HostConfig: {
      NetworkMode: network,
      PortBindings: { '1433/tcp': [{ HostIp: '127.0.0.1', HostPort: '14330' }] }
    },
    Mounts: [
      {
        Type: 'volume',
        Name: volume,
        Source: '/var/lib/docker/volumes/docker_sqlserver_data/_data',
        Destination: '/var/opt/mssql',
        RW: true
      },
      {
        Type: 'bind',
        Source: path.join(dockerDir, 'init-db.sql'),
        Destination: '/tmp/init-db.sql',
        RW: false
      }
    ],
    NetworkSettings: { Networks: { [network]: { NetworkID: 'b'.repeat(64) } } }
  };
  const volumeData = {
    Name: volume,
    Driver: 'local',
    Mountpoint: '/var/lib/docker/volumes/docker_sqlserver_data/_data',
    CreatedAt: created,
    Labels: { 'com.docker.compose.project': project, 'com.docker.compose.volume': 'sqlserver_data' }
  };
  const networkData = {
    Name: network,
    Id: 'b'.repeat(64),
    Driver: 'bridge',
    Labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.network': 'warp-mcp-network'
    }
  };
  const calls = [];
  const kills = [];
  let started = false;
  let retainedVolume = false;
  let pid = 900000;
  let active;
  let checks = 0;
  const spawn = (command, args, spawnOptions) => {
    const chosen = spawnOptions.env.COMPOSE_PROJECT_NAME;
    if (chosen && chosen !== project) {
      project = chosen;
      volume = `${project}_sqlserver_data`;
      network = `${project}_warp-mcp-network`;
      container.Config.Labels['com.docker.compose.project'] = project;
      container.HostConfig.NetworkMode = network;
      container.Mounts[0].Name = volume;
      container.Mounts[0].Source = `/var/lib/docker/volumes/${volume}/_data`;
      container.NetworkSettings.Networks = { [network]: { NetworkID: 'b'.repeat(64) } };
      volumeData.Name = volume;
      volumeData.Mountpoint = container.Mounts[0].Source;
      volumeData.Labels['com.docker.compose.project'] = project;
      networkData.Name = network;
      networkData.Labels['com.docker.compose.project'] = project;
    }
    const child = new EventEmitter();
    child.pid = ++pid;
    child.stdin = { end() {} };
    active = child;
    calls.push({ command, args, options: spawnOptions });
    let stdout,
      stderr = '',
      status = 0;
    if (args.includes('docker:start:init')) {
      started = true;
      container.State = { Running: true, Status: 'running', Pid: 123 };
      container.Created = new Date(settings.now?.() ?? Date.now()).toISOString();
      if (!retainedVolume) volumeData.CreatedAt = container.Created;
      retainedVolume = true;
      const credential = path.join(dockerDir, '.env.docker');
      if (!fs.existsSync(credential))
        fs.writeFileSync(
          credential,
          'MCP_TESTING_MODE=docker\nSQL_SERVER_HOST=127.0.0.1\nSQL_SERVER_PORT=14330\nSQL_SERVER_USER=sa\nSQL_SERVER_PASSWORD=OfflineFixturePassword123!Long\n',
          { mode: 0o600 }
        );
      fs.writeFileSync(compose, 'generated private compose fixture', { mode: 0o600 });
      stdout = 'start stdout\n';
      stderr = 'start private stderr\n';
      status = options.startStatus ?? 0;
    } else if (args.includes('scripts/ci/run-docker-integration.mjs')) {
      stdout = options.integrationOutput ?? 'suite stdout\n';
      stderr = 'suite stderr\n';
      status = options.testStatus ?? 0;
    } else if (args.includes('docker:stop')) {
      // The existing cleanup must be the first destructive Docker action.
      const evidence = spawnOptions.cwd === cwd ? fs.readdirSync(options.evidenceRoot) : [];
      const run = evidence
        .filter(name => name.startsWith('sql-test-'))
        .find(name => fs.existsSync(path.join(options.evidenceRoot, name, 'pre-removal.json')));
      expect(run).toBeTruthy();
      const pre = path.join(options.evidenceRoot, run, 'pre-removal.json');
      expect(fs.existsSync(pre)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(pre, 'utf8'));
      expect(manifest.files.some(file => file.label === 'engine-archive.stdout')).toBe(true);
      stdout = 'down stdout\n';
      stderr = 'down stderr\n';
      status = options.cleanupStatus ?? 0;
      if (status === 0) started = false;
    } else if (command === 'docker') {
      if (args[0] === 'context' && args[1] === 'show') stdout = 'selected-context\n';
      else if (args[0] === 'context' && args[1] === 'inspect')
        stdout = JSON.stringify([
          {
            Name: args[2],
            Endpoints: {
              docker: {
                Host: options.endpoint ?? 'unix:///fixture/docker.sock',
                SkipTLSVerify: options.skipTLSVerify ?? false
              }
            },
            TLSMaterial: options.tlsMaterial ?? {},
            Storage: { TLSPath: options.tlsPath ?? '<IN MEMORY>' }
          }
        ]);
      else if (args[0] === 'info')
        stdout = JSON.stringify(options.getDaemonID?.() ?? 'daemon-fixture-1');
      else if (args[0] === 'compose') stdout = JSON.stringify({ name: project });
      else if (args[0] === 'container' && args[1] === 'ls') {
        const row = {
          ID: id,
          Names: 'warp-mcp-sqlserver',
          Ports: '127.0.0.1:14330->1433/tcp',
          Labels: `com.docker.compose.project=${project}`
        };
        stdout = started
          ? JSON.stringify(row)
          : options.collision === 'name'
            ? JSON.stringify(row)
            : options.collision === 'port'
              ? JSON.stringify({ ...row, Names: 'other', Labels: '' })
              : options.collision === 'project'
                ? JSON.stringify({ ...row, Names: 'other', Ports: '' })
                : '';
      } else if (args[0] === 'volume' && args[1] === 'ls')
        stdout =
          started || retainedVolume || options.collision === 'volume'
            ? JSON.stringify({ Name: volume, Labels: `com.docker.compose.project=${project}` })
            : '';
      else if (args[0] === 'network' && args[1] === 'ls')
        stdout =
          started || options.collision === 'network'
            ? JSON.stringify({
                Name: network,
                ID: 'b'.repeat(64),
                Labels: `com.docker.compose.project=${project}`
              })
            : '';
      else if (args[0] === 'container' && args[1] === 'inspect') {
        checks++;
        if (options.drift && checks >= (options.driftAt ?? 2))
          options.drift(container, volumeData, networkData);
        stdout = JSON.stringify([container]);
      } else if (args[0] === 'volume' && args[1] === 'inspect')
        stdout = JSON.stringify([volumeData]);
      else if (args[0] === 'network' && args[1] === 'inspect')
        stdout = JSON.stringify([networkData]);
      else if (args[0] === 'stop') {
        status = options.stopStatus ?? 0;
        stdout = id + '\n';
        stderr = 'stop stderr\n';
        if (status === 0 && !options.keepRunning) {
          container.State = { Running: false, Status: 'exited', Pid: 0 };
          if (options.detachNetworkOnStop) container.NetworkSettings.Networks = {};
        }
      } else if (args[0] === 'logs') {
        stdout = options.emptyLogs
          ? ''
          : 'complete docker logs\n' + (container.State.Running ? '' : 'final shutdown bytes\n');
        stderr = options.emptyLogs ? '' : 'docker log stderr\n';
        status = options.logStatus ?? 0;
      } else if (args[0] === 'cp') {
        stdout = options.archiveOutput ?? 'complete engine archive fixture';
        stderr = 'cp stderr\n';
        status = options.archiveStatus ?? 0;
      } else throw new Error(`Unexpected Docker command ${args.join(' ')}`);
    } else throw new Error(`Unexpected command ${command}`);
    fs.writeSync(spawnOptions.stdio[1], stdout);
    fs.writeSync(spawnOptions.stdio[2], stderr);
    globalThis.queueMicrotask(() => child.emit('close', status, null));
    return child;
  };
  const kill = (target, signal) => {
    kills.push([target, signal]);
    if (signal === 0) throw Object.assign(new Error('absent'), { code: 'ESRCH' });
    globalThis.queueMicrotask(() => active.emit('close', null, signal));
  };
  options.evidenceRoot ??= root();
  options.lockRoot ??= root();
  const settings = {
    cwd,
    evidenceRoot: options.evidenceRoot,
    spawn,
    kill,
    probePort: async () => {},
    environment: { npm_execpath: '/private/test/npm-cli.js' },
    fs: { ...fs, inspectAcl: () => '', fsyncSync() {} },
    ...options
  };
  return { settings, calls, kills, container, volumeData, networkData, compose };
}

const stages = calls =>
  calls.filter(call => call.command !== 'docker').map(call => call.args.at(-1));
const raw = (result, name) => fs.readFileSync(path.join(result.directory, name), 'utf8');

describe('durable SQL lifecycle (offline)', () => {
  it('preserves complete private evidence and the pre-removal manifest before existing down', async () => {
    const test = fixture();
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).toBe(0);
    expect(stages(test.calls)).toEqual([
      'docker:start:init',
      'scripts/ci/run-docker-integration.mjs',
      'docker:stop'
    ]);
    expect(raw(result, 'start.stderr')).toBe('start private stderr\n');
    expect(raw(result, 'integration.stderr')).toBe('suite stderr\n');
    expect(raw(result, 'docker-logs.stdout')).toBe('complete docker logs\nfinal shutdown bytes\n');
    expect(raw(result, 'engine-archive.stdout')).toBe('complete engine archive fixture');
    expect(fs.statSync(result.directory).mode & 0o777).toBe(0o700);
    for (const name of fs.readdirSync(result.directory))
      expect(fs.statSync(path.join(result.directory, name)).mode & 0o777).toBe(0o600);
    const report = JSON.parse(raw(result, 'result.json'));
    expect(JSON.stringify(report)).not.toContain('private-fixture-value');
    expect(report.files.every(file => file.sha256.length === 64 && file.bytes >= 0)).toBe(true);
    const before = test.calls.findIndex(call => call.args[0] === 'logs');
    expect(test.calls.slice(0, before).some(call => call.args[1] === 'inspect')).toBe(true);
    expect(test.calls.filter(call => call.args[0] === 'cp')[0].args).toEqual([
      'cp',
      `${'a'.repeat(64)}:/var/opt/mssql/log`,
      '-'
    ]);
  });

  it('stops only the verified exact ID before complete shutdown logs and existing down', async () => {
    const test = fixture();
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).toBe(0);
    const order = test.calls.filter(
      call => call.command !== 'docker' || ['stop', 'logs', 'cp'].includes(call.args[0])
    );
    expect(
      order.map(call => (call.command === 'docker' ? call.args[0] : call.args.at(-1)))
    ).toEqual([
      'docker:start:init',
      'scripts/ci/run-docker-integration.mjs',
      'stop',
      'logs',
      'cp',
      'docker:stop'
    ]);
    expect(test.calls.filter(call => call.args[0] === 'stop').map(call => call.args)).toEqual([
      ['stop', 'a'.repeat(64)]
    ]);
    expect(raw(result, 'docker-logs.stdout')).toContain('final shutdown bytes');
    expect(raw(result, 'owned-stop.stderr')).toBe('stop stderr\n');
  });

  it.each([
    ['stopStatus', 7],
    ['keepRunning', true]
  ])('retains resources without down when %s prevents verified stop', async (key, value) => {
    const test = fixture({ [key]: value });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(test.calls.filter(call => call.args[0] === 'stop')).toHaveLength(1);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });

  it.each([
    ['emptyLogs', true],
    ['archiveOutput', '']
  ])('refuses down when stopped capture is missing: %s', async (key, value) => {
    const test = fixture({ [key]: value });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });

  it('accepts stopped runtime network detachment while keeping immutable resource ownership', async () => {
    const test = fixture({ detachNetworkOnStop: true });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).toBe(0);
    expect(raw(result, 'docker-logs.stdout')).toContain('final shutdown bytes');
  });

  it('refuses down and log capture when immutable ownership drifts after stop', async () => {
    const test = fixture({
      driftAt: 3,
      drift: c => {
        c.Mounts[0].Name = 'regular-data';
      }
    });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(test.calls.filter(call => call.args[0] === 'stop')).toHaveLength(1);
    expect(test.calls.some(call => ['logs', 'cp'].includes(call.args[0]))).toBe(false);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });

  it('retains resources when the exact-ID stop exceeds its reserved deadline', async () => {
    const test = fixture();
    let time = Date.now();
    const original = test.settings.spawn;
    test.settings.now = () => time;
    test.settings.spawn = (command, args, options) => {
      const child = original(command, args, options);
      if (command === 'docker' && args[0] === 'stop') time += 1_190_000;
      return child;
    };
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(test.calls.filter(call => call.args[0] === 'stop')).toHaveLength(1);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });

  it.each([
    ['startStatus', 17],
    ['testStatus', 23]
  ])('preserves logs and retains resources when %s fails', async (key, code) => {
    const test = fixture({ [key]: code });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).toBe(code);
    expect(stages(test.calls)).not.toContain('docker:stop');
    expect(test.calls.some(call => call.args[0] === 'stop')).toBe(false);
    expect(raw(result, 'engine-archive.stdout')).toContain('complete engine archive');
    expect(stages(test.calls)).toEqual(
      key === 'startStatus'
        ? ['docker:start:init']
        : ['docker:start:init', 'scripts/ci/run-docker-integration.mjs']
    );
  });

  it.each(['name', 'port', 'project', 'volume', 'network'])(
    'rejects a preexisting %s before generation/startup',
    async collision => {
      const test = fixture({ collision });
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).not.toBe(0);
      expect(stages(test.calls)).toEqual([]);
      expect(test.calls.some(call => ['logs', 'cp', 'inspect'].includes(call.args[0]))).toBe(false);
    }
  );

  it.each([
    [
      'ID',
      c => {
        c.Id = 'c'.repeat(64);
      }
    ],
    [
      'name',
      c => {
        c.Name = '/mssql-2025';
      }
    ],
    [
      'project',
      c => {
        c.Config.Labels['com.docker.compose.project'] = 'other';
      }
    ],
    [
      'service',
      c => {
        c.Config.Labels['com.docker.compose.service'] = 'other';
      }
    ],
    [
      'working directory',
      c => {
        c.Config.Labels['com.docker.compose.project.working_dir'] = '/other';
      }
    ],
    [
      'port',
      c => {
        c.HostConfig.PortBindings['1433/tcp'][0].HostPort = '14331';
      }
    ],
    [
      'mount',
      c => {
        c.Mounts[0].Name = 'regular-data';
      }
    ],
    [
      'configured network',
      c => {
        c.HostConfig.NetworkMode = 'regular-network';
      }
    ],
    [
      'network ID',
      (c, v, n) => {
        n.Id = 'c'.repeat(64);
      }
    ],
    [
      'volume label',
      (c, v) => {
        v.Labels['com.docker.compose.volume'] = 'other';
      }
    ]
  ])('fails closed on %s drift before log capture', async (name, drift) => {
    const test = fixture({ drift });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(test.calls.some(call => ['logs', 'cp'].includes(call.args[0]))).toBe(false);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });

  it('rechecks pinned ownership immediately before cleanup', async () => {
    const test = fixture({
      driftAt: 5,
      drift: c => {
        c.Id = 'd'.repeat(64);
      }
    });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(raw(result, 'engine-archive.stdout')).toContain('complete engine archive');
    expect(result.code).not.toBe(0);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });

  it.each(['logStatus', 'archiveStatus'])(
    'retains partial capture and refuses cleanup on %s failure',
    async key => {
      const test = fixture({ [key]: 1 });
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).not.toBe(0);
      expect(
        raw(result, key === 'logStatus' ? 'docker-logs.stdout' : 'engine-archive.stdout')
      ).toBeTruthy();
      expect(stages(test.calls)).not.toContain('docker:stop');
    }
  );

  it('retains complete oversized SQL output and refuses cleanup after the capture bound', async () => {
    const test = fixture({
      integrationOutput: 'X'.repeat(32768),
      limits: { ...lifecycle.DEFAULT_LIMITS, maxBytes: 4096 }
    });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(raw(result, 'integration.stdout').length).toBe(32768);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });

  it.each(['fsync', 'readback'])(
    'retains resources when the pre-removal manifest %s fails',
    async operation => {
      const test = fixture();
      const paths = new Map();
      const baseFs = test.settings.fs;
      const injected = {
        ...baseFs,
        openSync(file, ...args) {
          const fd = fs.openSync(file, ...args);
          paths.set(fd, file);
          return fd;
        }
      };
      const method = operation === 'fsync' ? 'fsyncSync' : 'readSync';
      injected[method] = (fd, ...args) => {
        if (paths.get(fd)?.endsWith('pre-removal.json'))
          throw new Error('injected manifest verification failure');
        return baseFs[method](fd, ...args);
      };
      test.settings.fs = injected;
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).not.toBe(0);
      expect(raw(result, 'engine-archive.stdout')).toBeTruthy();
      expect(stages(test.calls)).not.toContain('docker:stop');
    }
  );

  it('reports existing cleanup failure separately after verified preservation', async () => {
    const test = fixture({ cleanupStatus: 9 });
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).toBe(9);
    expect(raw(result, 'pre-removal.json')).toContain('engine-archive.stdout');
    expect(raw(result, 'cleanup.stderr')).toBe('down stderr\n');
  });

  it.each(['1200000', '1300000', '1410000'])(
    'rejects an outer watchdog that could preempt the internal preservation reserve: %s',
    async outerTimeout => {
      const test = fixture({
        environment: {
          npm_execpath: '/private/test/npm-cli.js',
          SQL_TEST_OUTER_TIMEOUT_MS: outerTimeout
        }
      });
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).not.toBe(0);
      expect(test.calls).toEqual([]);
    }
  );

  it('keeps a preservation reserve after a work deadline and does not run cleanup', async () => {
    const test = fixture();
    let time = Date.now();
    const spawn = test.settings.spawn;
    test.settings.now = () => time;
    test.settings.spawn = (command, args, options) => {
      const child = spawn(command, args, options);
      if (args.includes('docker:start:init')) time += 1_030_000;
      return child;
    };
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(stages(test.calls)).not.toContain('scripts/ci/run-docker-integration.mjs');
    expect(stages(test.calls)).not.toContain('docker:stop');
    expect(raw(result, 'engine-archive.stdout')).toBeTruthy();
  });

  it('refuses cleanup on fsync/readback failure even when child commands succeeded', async () => {
    const test = fixture();
    test.settings.fs = {
      ...fs,
      inspectAcl: () => '',
      fsyncSync() {
        throw new Error('injected fsync failure');
      }
    };
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(stages(test.calls)).not.toContain('docker:stop');
  });
});

describe('owned bounded child capture', () => {
  it('captures lossless stdout/stderr despite the parent shell redirecting stderr', () => {
    const evidence = root();
    const modulePath = path.resolve('scripts/ci/sql-test-lifecycle.mjs');
    const harness = path.join(evidence, 'harness.mjs');
    fs.writeFileSync(
      harness,
      `import { EvidenceStore, runCaptured } from ${JSON.stringify('file://' + modulePath)};\nconst store = new EvidenceStore({ root: ${JSON.stringify(evidence)} });\nconst captured = await runCaptured({ store, label: 'redirect', command: process.execPath, args: ['-e', 'process.stdout.write("A".repeat(2097152));process.stderr.write("B".repeat(2097152))'], deadline: Date.now()+10000 });\nstore.write('capture.json', captured);\nprocess.stdout.write(store.directory);\n`
    );
    const run = spawnSync(
      '/bin/sh',
      ['-c', '"$1" "$2" 2>/dev/null', 'capture', process.execPath, harness],
      { encoding: 'utf8', timeout: 15000 }
    );
    expect(run.status).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(run.stdout, 'capture.json'), 'utf8'))
    ).toMatchObject({ status: 0, bounded: true, terminated: true, preserved: true });
    expect(
      fs.readFileSync(path.join(run.stdout, 'redirect.stdout')).equals(Buffer.alloc(2097152, 'A'))
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(run.stdout, 'redirect.stderr')).equals(Buffer.alloc(2097152, 'B'))
    ).toBe(true);
  });

  it('signals only its recorded process group on deadline and preserves partial output', async () => {
    const store = new lifecycle.EvidenceStore({ root: root() });
    const result = await lifecycle.runCaptured({
      store,
      label: 'deadline',
      command: process.execPath,
      args: ['-e', 'process.stderr.write("partial");setInterval(()=>{},1000)'],
      deadline: Date.now() + 1000
    });
    expect(result.bounded).toBe(false);
    expect(result.signal).toBe('SIGTERM');
    expect(result.pid).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(store.directory, 'deadline.stderr'), 'utf8')).toBe('partial');
  });

  it('retains all bytes already written when a size bound is exceeded', async () => {
    const store = new lifecycle.EvidenceStore({ root: root() });
    const result = await lifecycle.runCaptured({
      store,
      label: 'size',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("X".repeat(32768));setInterval(()=>{},1000)'],
      deadline: Date.now() + 5000,
      maxBytes: 1024
    });
    expect(result.bounded).toBe(false);
    expect(fs.statSync(path.join(store.directory, 'size.stdout')).size).toBe(32768);
  });

  it('retains evidence on an abort signal and never signals an unrelated PID', async () => {
    const store = new lifecycle.EvidenceStore({ root: root() });
    const controller = new globalThis.AbortController();
    const pending = lifecycle.runCaptured({
      store,
      label: 'abort',
      command: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'],
      deadline: Date.now() + 5000,
      abortSignal: controller.signal
    });
    setTimeout(() => controller.abort('SIGINT'), 100);
    const result = await pending;
    expect(result.bounded).toBe(false);
    expect(result.signal).toBe('SIGINT');
    expect(result.terminated).toBe(true);
  });

  it('bounds evidence readback by the internal total deadline', () => {
    let time = Date.now();
    const store = new lifecycle.EvidenceStore({
      root: root(),
      now: () => time,
      deadline: time + 100
    });
    store.write('bounded.json', { value: 1 });
    time += 101;
    expect(() => store.verifyAll()).toThrow();
  });

  it('refuses successful capture when process group termination is uncertain', async () => {
    const store = new lifecycle.EvidenceStore({ root: root() });
    const child = new EventEmitter();
    child.pid = 900001;
    child.stdin = { end() {} };
    const signals = [];
    const result = await lifecycle.runCaptured({
      store,
      label: 'uncertain',
      command: 'fake',
      deadline: Date.now() + 100,
      killGraceMs: 10,
      spawn() {
        globalThis.queueMicrotask(() => child.emit('close', 0, null));
        return child;
      },
      kill(pid, signal) {
        signals.push([pid, signal]);
        throw Object.assign(new Error('denied'), { code: 'EPERM' });
      }
    });
    expect(result.bounded).toBe(false);
    expect(result.terminated).toBe(false);
    expect(result.preserved).toBe(false);
    expect(signals.every(([pid]) => pid === -900001)).toBe(true);
  });

  it('verifies immutable readback and rejects evidence tampering', () => {
    const store = new lifecycle.EvidenceStore({ root: root() });
    store.write('example.json', { value: 1 });
    fs.writeFileSync(path.join(store.directory, 'example.json'), 'changed');
    expect(() => store.verifyAll()).toThrow();
  });
});

describe('review corrections (offline)', () => {
  it('admits only one concurrent checkout invocation through the shared daemon/name/port lock', async () => {
    const shared = root();
    const first = fixture({ lockRoot: shared });
    const second = fixture({ cwd: first.settings.cwd, lockRoot: shared });
    const results = await Promise.all([
      lifecycle.runSqlLifecycle(first.settings),
      lifecycle.runSqlLifecycle(second.settings)
    ]);
    expect(results.filter(result => result.code === 0)).toHaveLength(1);
    expect(
      [...first.calls, ...second.calls].filter(call => call.args.includes('docker:start:init'))
    ).toHaveLength(1);
    expect(results.some(result => result.reason === 'existing-or-stale-lifecycle-lock')).toBe(true);
  });

  it('shares the same daemon/name/port lock across distinct checkout paths', async () => {
    const shared = root();
    const getDaemonID = () => 'daemon-fixture-1';
    let reachAdmission, releaseAdmission;
    const reached = new Promise(resolve => {
      reachAdmission = resolve;
    });
    const release = new Promise(resolve => {
      releaseAdmission = resolve;
    });
    const first = fixture({
      lockRoot: shared,
      getDaemonID,
      probePort: async () => {
        reachAdmission();
        await release;
        throw Object.assign(new Error('intentional pre-start stop'), {
          safeReason: 'unit-pre-start-stop'
        });
      }
    });
    let secondProbeReached = false;
    const second = fixture({
      lockRoot: shared,
      getDaemonID,
      probePort: async () => {
        secondProbeReached = true;
        throw Object.assign(new Error('unexpected contender admission'), {
          safeReason: 'unit-unexpected-admission'
        });
      }
    });
    expect(first.settings.cwd).not.toBe(second.settings.cwd);
    const firstRun = lifecycle.runSqlLifecycle(first.settings);
    const pending = [firstRun];
    try {
      await Promise.race([
        reached,
        firstRun.then(result => {
          throw new Error(`first admission ended before barrier: ${result.reason}`);
        })
      ]);
      const secondRun = lifecycle.runSqlLifecycle(second.settings);
      pending.push(secondRun);
      const denied = await secondRun;
      expect(denied.code).not.toBe(0);
      expect(denied.reason).toBe('existing-or-stale-lifecycle-lock');
      expect(secondProbeReached).toBe(false);
    } finally {
      releaseAdmission();
      await Promise.allSettled(pending);
    }
    const firstResult = await firstRun;
    expect(firstResult.code).not.toBe(0);
    expect(firstResult.reason).toBe('unit-pre-start-stop');
    expect(firstResult.lockRetained).toBe(false);
    expect(fs.existsSync(firstResult.lock)).toBe(false);
    const commands = stages([...first.calls, ...second.calls]);
    for (const command of [
      'docker:start:init',
      'scripts/ci/run-docker-integration.mjs',
      'docker:stop'
    ])
      expect(commands).not.toContain(command);
  });

  it('retains a failed-run lock and refuses stale-lock reuse without another startup', async () => {
    const test = fixture({ startStatus: 17 });
    const first = await lifecycle.runSqlLifecycle(test.settings);
    expect(first.lockRetained).toBe(true);
    expect(fs.existsSync(first.lock)).toBe(true);
    const second = await lifecycle.runSqlLifecycle(test.settings);
    expect(second.reason).toBe('existing-or-stale-lifecycle-lock');
    expect(test.calls.filter(call => call.args.includes('docker:start:init'))).toHaveLength(1);
  });

  it('reuses one stable checkout project and exact retained volume on a second clean run', async () => {
    const test = fixture();
    const first = await lifecycle.runSqlLifecycle(test.settings);
    const second = await lifecycle.runSqlLifecycle(test.settings);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const a = JSON.parse(raw(first, 'admission.json'));
    const b = JSON.parse(raw(second, 'admission.json'));
    expect(a.project).toMatch(/^warp_sql_[a-f0-9]+$/);
    expect(b.project).toBe(a.project);
    expect(b.reusedVolume).toBe(true);
    expect(JSON.parse(raw(second, 'result.json')).identity.volume).toEqual(
      JSON.parse(raw(first, 'result.json')).identity.volume
    );
    expect(first.lockRetained).toBe(false);
    expect(second.lockRetained).toBe(false);
  });

  it('assigns distinct stable projects to distinct canonical checkout paths', async () => {
    const first = fixture(),
      second = fixture();
    const a = await lifecycle.runSqlLifecycle(first.settings);
    const b = await lifecycle.runSqlLifecycle(second.settings);
    expect(JSON.parse(raw(a, 'admission.json')).project).not.toBe(
      JSON.parse(raw(b, 'admission.json')).project
    );
  });

  it.each(['credential', 'volume'])(
    'refuses retained volume reuse after %s identity changes',
    async kind => {
      const test = fixture();
      const first = await lifecycle.runSqlLifecycle(test.settings);
      expect(first.code).toBe(0);
      if (kind === 'credential')
        fs.writeFileSync(
          path.join(test.settings.cwd, 'test/docker/.env.docker'),
          'SQL_SERVER_PASSWORD=changed\n'
        );
      else test.volumeData.CreatedAt = '2000-01-01T00:00:00.000Z';
      const second = await lifecycle.runSqlLifecycle(test.settings);
      expect(second.code).not.toBe(0);
      expect(test.calls.filter(call => call.args.includes('docker:start:init'))).toHaveLength(1);
    }
  );

  it.each([
    'unix:///fixture/docker.sock',
    'ssh://tester@remote.example:22',
    'tcp://remote.example:2375'
  ])('pins %s for direct and nested children despite selected-context changes', async endpoint => {
    const test = fixture({
      endpoint,
      environment: {
        npm_execpath: '/private/test/npm-cli.js',
        DOCKER_CONTEXT: 'mutable',
        DOCKER_HOST: 'tcp://wrong.example:2375'
      }
    });
    const original = test.settings.spawn;
    test.settings.spawn = (command, args, options) => {
      if (args.includes('docker:start:init')) test.settings.environment.DOCKER_CONTEXT = 'switched';
      return original(command, args, options);
    };
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).toBe(0);
    const pinned = test.calls.filter(call => call.args[0] !== 'context');
    expect(pinned.length).toBeGreaterThan(3);
    expect(
      pinned.every(
        call => call.options.env.DOCKER_HOST === endpoint && !call.options.env.DOCKER_CONTEXT
      )
    ).toBe(true);
    expect(
      pinned.every(
        call =>
          call.options.env.COMPOSE_PROJECT_NAME ===
          JSON.parse(raw(result, 'admission.json')).project
      )
    ).toBe(true);
  });

  it('restores the exact platform descriptor after success and throw', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    expect(onDarwin(() => process.platform)).toBe('darwin');
    expect(Object.getOwnPropertyDescriptor(process, 'platform')).toEqual(original);
    expect(() =>
      onDarwin(() => {
        throw new Error('fixture throw');
      })
    ).toThrow('fixture throw');
    expect(Object.getOwnPropertyDescriptor(process, 'platform')).toEqual(original);
  });

  it.each(['growth', 'replacement', 'nonregular', 'oversize', 'valid-large'])(
    'binds compose reads to a validated bounded descriptor: %s',
    async kind => {
      const test = fixture();
      const paths = new Map();
      let consumed = 0;
      let opened = 0;
      let closed = 0;
      let replaced = false;
      const bound = 8 * 1024 * 1024;
      test.settings.fs = {
        ...test.settings.fs,
        openSync(file, ...args) {
          if (file === test.compose && !replaced) {
            replaced = true;
            if (kind === 'oversize') fs.writeFileSync(file, Buffer.alloc(bound + 1));
            if (kind === 'valid-large') fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));
          }
          const fd = fs.openSync(file, ...args);
          paths.set(fd, file);
          if (file === test.compose) {
            opened++;
            expect(args[0] & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
            expect(args[0] & fs.constants.O_NONBLOCK).toBe(fs.constants.O_NONBLOCK);
          }
          return fd;
        },
        fstatSync(fd) {
          const stat = fs.fstatSync(fd);
          if (paths.get(fd) === test.compose && kind === 'nonregular')
            return { ...stat, isFile: () => false };
          if (paths.get(fd) === test.compose && kind === 'replacement' && opened === 1) {
            fs.renameSync(test.compose, test.compose + '.old');
            fs.writeFileSync(test.compose, 'replacement', { mode: 0o600 });
          }
          return stat;
        },
        readSync(fd, buffer, offset, length, position) {
          if (paths.get(fd) === test.compose) {
            if (kind === 'growth') {
              buffer.fill(65, offset, offset + length);
              consumed += length;
              return length;
            }
            const count = fs.readSync(fd, buffer, offset, length, position);
            consumed += count;
            return count;
          }
          return fs.readSync(fd, buffer, offset, length, position);
        },
        closeSync(fd) {
          if (paths.get(fd) === test.compose) closed++;
          paths.delete(fd);
          return fs.closeSync(fd);
        }
      };
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(opened).toBeGreaterThan(0);
      expect(closed).toBe(opened);
      if (kind === 'valid-large') {
        expect(result.code, result.reason).toBe(0);
        expect(consumed).toBeGreaterThan(1024 * 1024);
      } else {
        expect(result.code).not.toBe(0);
        expect(stages(test.calls)).not.toContain('docker:stop');
        expect(consumed).toBe(kind === 'growth' ? bound + 1 : 0);
      }
    }
  );

  it.each([false, true])(
    'snapshots TCP/TLS context material with verification skipped: %s',
    async skipTLSVerify => {
      const tls = root();
      fs.mkdirSync(path.join(tls, 'docker'), { mode: 0o700 });
      for (const name of ['ca.pem', 'cert.pem', 'key.pem'])
        fs.writeFileSync(path.join(tls, 'docker', name), `offline ${name}`, { mode: 0o600 });
      const test = fixture({
        endpoint: 'tcp://remote.example:2376',
        tlsPath: tls,
        skipTLSVerify,
        tlsMaterial: { docker: ['ca.pem', 'cert.pem', 'key.pem'] }
      });
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).toBe(0);
      const child = test.calls.find(call => call.args.includes('docker:start:init'));
      expect(child.options.env.DOCKER_TLS).toBe('1');
      expect(child.options.env.DOCKER_TLS_VERIFY).toBe(skipTLSVerify ? undefined : '1');
      expect(
        test.calls
          .filter(call => call.args[0] !== 'context')
          .every(
            call =>
              call.options.env.DOCKER_TLS === '1' &&
              call.options.env.DOCKER_TLS_VERIFY === (skipTLSVerify ? undefined : '1')
          )
      ).toBe(true);
      expect(child.options.env.DOCKER_CERT_PATH).not.toBe(path.join(tls, 'docker'));
      for (const name of ['ca.pem', 'cert.pem', 'key.pem']) {
        const copied = path.join(child.options.env.DOCKER_CERT_PATH, name);
        expect(fs.statSync(copied).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(copied, 'utf8')).toBe(`offline ${name}`);
      }
    }
  );

  it.each([
    [false, {}],
    [false, { docker: [] }],
    [true, {}],
    [true, { docker: [] }]
  ])(
    'refuses skip-verification TCP TLS without material before any daemon contact (explicit context: %s, material: %j)',
    async (explicit, tlsMaterial) => {
      const test = fixture({
        endpoint: 'tcp://remote.example:2376',
        skipTLSVerify: true,
        tlsMaterial,
        environment: {
          npm_execpath: '/private/test/npm-cli.js',
          ...(explicit ? { DOCKER_CONTEXT: 'selected-context' } : {})
        }
      });
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).not.toBe(0);
      expect(result.reason).toBe('unsupported-context');
      expect(stages(test.calls)).toEqual([]);
      expect(test.calls.length).toBeGreaterThan(0);
      expect(
        test.calls.every(call => call.command === 'docker' && call.args[0] === 'context')
      ).toBe(true);
      expect(test.calls.some(call => call.args[0] === 'info')).toBe(false);
      expect(result.lock).toBeUndefined();
    }
  );

  it.each(['npipe:////./pipe/docker_engine', 'tcp://missing.example:2376'])(
    'refuses an unpinnable route/material before mutation: %s',
    async endpoint => {
      const test = fixture({
        endpoint,
        tlsMaterial: { docker: ['ca.pem', 'cert.pem', 'key.pem'] },
        tlsPath: '/nonexistent/offline-tls'
      });
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).not.toBe(0);
      expect(result.reason).toBe('unsupported-context');
      expect(stages(test.calls)).toEqual([]);
    }
  );

  it.each(['daemon', 'resource'])(
    'rejects %s drift during manifest readback before project-wide down',
    async kind => {
      let changed = false;
      const test = fixture({
        getDaemonID: () => (changed && kind === 'daemon' ? 'daemon-other-2' : 'daemon-fixture-1')
      });
      const paths = new Map();
      test.settings.fs = {
        ...test.settings.fs,
        inspectAcl: () => '',
        openSync(file, ...args) {
          const fd = fs.openSync(file, ...args);
          paths.set(fd, file);
          return fd;
        },
        readSync(fd, ...args) {
          if (paths.get(fd)?.endsWith('pre-removal.json')) {
            changed = true;
            if (kind === 'resource') test.container.Id = 'e'.repeat(64);
          }
          return fs.readSync(fd, ...args);
        }
      };
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(changed, JSON.stringify({ code: result.code, reason: result.reason })).toBe(true);
      expect(result.code).not.toBe(0);
      expect(stages(test.calls)).not.toContain('docker:stop');
      expect(result.lockRetained).toBe(true);
    }
  );

  it('rejects a user symlink ancestor and a real evidence path resolving into source', () => {
    const source = root(),
      outside = root();
    const link = path.join(outside, 'alias');
    fs.symlinkSync(source, link);
    expect(
      () => new lifecycle.EvidenceStore({ root: path.join(link, 'evidence'), sourceRoot: source })
    ).toThrow();
  });

  it.each([false, true])(
    'rechecks ctime-only ancestor churn and rejects new ACL grants: %s',
    grant =>
      onDarwin(() => {
        const parent = fs.realpathSync(root());
        let reads = 0;
        const injected = {
          ...fs,
          inspectAcl(filename) {
            if (filename !== parent) return '';
            reads++;
            if (reads === 1)
              fs.mkdirSync(path.join(parent, 'concurrent-private-child'), { mode: 0o700 });
            return grant && reads > 1 ? ' 0: group:everyone allow delete_child\n' : '';
          }
        };
        const create = () =>
          new lifecycle.EvidenceStore({ root: path.join(parent, 'evidence'), fs: injected });
        if (grant) expect(create).toThrow('replaceable-evidence-acl');
        else expect(create).not.toThrow();
        expect(reads).toBeGreaterThan(1);
      })
  );

  it('rejects an ancestor ACL that grants replacement access', () =>
    onDarwin(() => {
      const parent = root();
      const injected = {
        ...fs,
        inspectAcl: filename =>
          filename === parent ? ' 0: group:everyone allow delete_child\n' : ''
      };
      expect(
        () => new lifecycle.EvidenceStore({ root: path.join(parent, 'evidence'), fs: injected })
      ).toThrow();
    }));

  it('rejects an evidence root beneath a replaceable ancestor', () => {
    const parent = root();
    fs.chmodSync(parent, 0o777);
    expect(() => new lifecycle.EvidenceStore({ root: path.join(parent, 'evidence') })).toThrow();
  });

  it.each(['parent', 'root'])(
    'requires fsync of the newly created evidence %s directory link',
    async target => {
      const parent = root();
      const evidence = path.join(parent, 'new-evidence');
      const paths = new Map();
      const injected = {
        ...fs,
        openSync(file, ...args) {
          const fd = fs.openSync(file, ...args);
          paths.set(fd, file);
          return fd;
        },
        fsyncSync(fd) {
          if (
            paths.get(fd) &&
            fs.realpathSync(paths.get(fd)) ===
              fs.realpathSync(target === 'parent' ? parent : evidence)
          )
            throw new Error('offline directory fsync failure');
          return fs.fsyncSync(fd);
        }
      };
      expect(() => new lifecycle.EvidenceStore({ root: evidence, fs: injected })).toThrow();
    }
  );
});

describe('credential target preflight (offline)', () => {
  const credential = (host = 'localhost', port = '14330') =>
    `MCP_TESTING_MODE=docker\nSQL_SERVER_HOST=${host}\nSQL_SERVER_PORT=${port}\nSQL_SERVER_USER=sa\nSQL_SERVER_PASSWORD=OfflineFixturePassword123!Long\n`;
  it.each(['host', 'port', 'template'])('rejects invalid %s before Docker startup', async kind => {
    const test = fixture();
    const directory = path.join(test.settings.cwd, 'test/docker');
    if (kind === 'template')
      fs.appendFileSync(path.join(directory, 'docker-env.template'), '\nSQL_SERVER_PORT=1433\n');
    else
      fs.writeFileSync(
        path.join(directory, '.env.docker'),
        credential(
          kind === 'host' ? '192.0.2.10' : 'localhost',
          kind === 'port' ? '1433' : '14330'
        ),
        { mode: 0o600 }
      );
    const result = await lifecycle.runSqlLifecycle(test.settings);
    expect(result.code).not.toBe(0);
    expect(stages(test.calls)).toEqual([]);
  });
  it.each(['target', 'identity'])(
    'rejects generated credential %s changes after preflight before integration',
    async kind => {
      const test = fixture();
      const filename = path.join(test.settings.cwd, 'test/docker/.env.docker');
      fs.writeFileSync(filename, credential(), { mode: 0o600 });
      const spawn = test.settings.spawn;
      test.settings.spawn = (command, args, options) => {
        const child = spawn(command, args, options);
        if (args.includes('docker:start:init'))
          fs.writeFileSync(
            filename,
            kind === 'target'
              ? credential('localhost', '1433')
              : credential().replace('123!Long', '456!Long')
          );
        return child;
      };
      const result = await lifecycle.runSqlLifecycle(test.settings);
      expect(result.code).not.toBe(0);
      expect(stages(test.calls)).not.toContain('scripts/ci/run-docker-integration.mjs');
      expect(stages(test.calls)).not.toContain('docker:stop');
      expect(result.lockRetained).toBe(true);
    }
  );
});
