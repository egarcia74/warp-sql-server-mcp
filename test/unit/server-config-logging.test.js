import os from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ServerConfig } from '../../lib/config/server-config.js';

// Keep release/dependency updates independent of this report-format contract.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal();
  const { fileURLToPath, URL } = await import('node:url');
  const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
  return {
    ...actual,
    default: {
      ...actual.default,
      readFileSync(file, ...args) {
        if (file === packagePath) {
          return JSON.stringify({
            name: 'example-mcp',
            version: '1.2.3',
            description: 'Example server',
            dependencies: { mssql: '^1.0.0', winston: '^2.0.0', dotenv: '^3.0.0' }
          });
        }
        return actual.default.readFileSync(file, ...args);
      }
    }
  };
});

describe('logConfiguration characterization', () => {
  let originalEnv;
  let processDescriptors;
  let config;
  let summary;
  let stderr;
  let stdout;
  let manager;
  let logger;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { NODE_ENV: 'production', SQL_SERVER_TRUST_CERT: 'false' };
    config = new ServerConfig();
    processDescriptors = {};
    for (const [key, value] of Object.entries({
      version: 'v22.0.0',
      platform: 'linux',
      arch: 'x64',
      pid: 123,
      ppid: 100,
      argv: ['node', 'server.js', '--example'],
      moduleLoadList: ['one', 'two']
    })) {
      processDescriptors[key] = Object.getOwnPropertyDescriptor(process, key);
      // Node 22's native ppid property ignores a value-only override.
      Object.defineProperty(process, key, { configurable: true, get: () => value });
    }
    vi.spyOn(process, 'cwd').mockReturnValue('/example');
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 10 * 1024 * 1024,
      heapUsed: 2 * 1024 * 1024
    });
    vi.spyOn(process, 'uptime').mockReturnValue(12.6);
    vi.spyOn(os, 'hostname').mockReturnValue('example-host');
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({ lo0: [], eth0: [], wlan0: [], extra: [] });
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    summary = {
      server: 'db.example:1433',
      database: 'example',
      authType: 'SQL Server Authentication',
      user: 'example-user',
      password: 'must-not-be-printed',
      domain: 'EXAMPLE',
      encrypt: true,
      trustCert: false,
      trustCertSource: 'explicit-false',
      securityDecision: { type: 'explicit', reason: 'example decision', securityLevel: 'high' },
      isDevEnvironment: false,
      poolMin: 0,
      poolMax: 10
    };
    vi.spyOn(config, 'getConnectionSummary').mockReturnValue(summary);
    vi.spyOn(config, 'getConnectionConfig').mockReturnValue({ connectionString: 'abc' });
    vi.spyOn(config, 'validate').mockReturnValue({
      warnings: ['first warning', 'second warning'],
      errors: ['first error']
    });
    manager = {
      getConnectionHealth: vi.fn().mockReturnValue({
        ssl: {
          connection_status: 'connected',
          protocol: 'TLS',
          server: 'db.example',
          encrypt: true,
          trust_server_certificate: false,
          note: 'example note'
        }
      })
    };
    logger = {
      config: { logFile: '/custom/main.log', securityLogFile: '/custom/security.log' },
      _getSmartLogDefaults: vi.fn().mockReturnValue({
        logFile: '/default/main.log',
        securityLogFile: '/default/security.log',
        errorLogFile: '/default/error.log'
      }),
      info: vi.fn()
    };
  });

  afterEach(() => {
    const stdoutCalls = stdout.mock.calls.length;
    vi.restoreAllMocks();
    for (const [key, descriptor] of Object.entries(processDescriptors)) {
      Object.defineProperty(process, key, descriptor);
    }
    process.env = originalEnv;
    expect(stdoutCalls).toBe(0);
  });

  function report() {
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]).toHaveLength(1);
    return stderr.mock.calls[0][0];
  }

  test('preserves the complete ordered report and one structured logger payload', () => {
    config.logConfiguration(manager, logger);
    expect(logger.info.mock.calls).toMatchSnapshot();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.contexts[0]).toBe(logger);
    expect(stderr).not.toHaveBeenCalled();
    expect(config.getConnectionSummary).toHaveBeenCalledTimes(1);
    expect(config.getConnectionConfig).toHaveBeenCalledTimes(1);
    expect(config.validate).toHaveBeenCalledTimes(1);
    expect(manager.getConnectionHealth).toHaveBeenCalledTimes(1);
    expect(manager.getConnectionHealth.mock.contexts[0]).toBe(manager);
    expect(logger._getSmartLogDefaults).toHaveBeenCalledTimes(1);
    expect(logger._getSmartLogDefaults.mock.contexts[0]).toBe(logger);
    expect(logger.info.mock.calls[0][1].configuration).not.toContain('must-not-be-printed');
  });

  test('emits exactly the same report as a single stderr message without an info function', () => {
    config.logConfiguration(manager, logger);
    const expected = logger.info.mock.calls[0][1].configuration;
    logger.info = 'not callable';
    config.logConfiguration(manager, logger);
    expect(report()).toBe(expected);
  });

  test('suppresses everything in test mode before any optional call or environment probe', () => {
    process.env.NODE_ENV = 'test';
    config.logConfiguration(manager, logger);
    expect(config.getConnectionSummary).not.toHaveBeenCalled();
    expect(config.getConnectionConfig).not.toHaveBeenCalled();
    expect(config.validate).not.toHaveBeenCalled();
    expect(process.memoryUsage).not.toHaveBeenCalled();
    expect(os.hostname).not.toHaveBeenCalled();
    expect(os.networkInterfaces).not.toHaveBeenCalled();
    expect(manager.getConnectionHealth).not.toHaveBeenCalled();
    expect(logger._getSmartLogDefaults).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  test('keeps real summary masking and validation lookups intact', () => {
    process.env.SQL_SERVER_USER = 'example-user';
    process.env.SQL_SERVER_PASSWORD = 'secret-not-for-output';
    config.getConnectionSummary.mockRestore();
    config.validate.mockRestore();
    const summarySpy = vi.spyOn(config, 'getConnectionSummary');
    const validationSpy = vi.spyOn(config, 'validate');
    config.logConfiguration();
    const output = report();
    expect(summarySpy).toHaveBeenCalledTimes(2);
    expect(validationSpy).toHaveBeenCalledTimes(1);
    expect(output).toContain('    User: example-user');
    expect(output).toContain('    Password: ***********');
    expect(output).not.toContain('secret-not-for-output');
    expect(output).not.toContain('SQL_SERVER_PASSWORD=');
  });

  test('propagates stderr failures without trying another output destination', () => {
    const failure = new Error('stderr failure');
    stderr.mockImplementation(() => {
      throw failure;
    });
    expect(() => config.logConfiguration()).toThrow(failure);
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['explicit-true', 'true (⚠️  explicitly enabled - use only in development)'],
    ['explicit-false', 'true (✅ explicitly disabled for security)'],
    ['auto-dev', 'true (🔧 auto-enabled for development convenience)'],
    ['auto-prod', 'true (🔒 auto-disabled for production security)'],
    ['unknown', 'true']
  ])('preserves certificate source display for %s', (source, expected) => {
    summary.trustCert = true;
    summary.trustCertSource = source;
    config.logConfiguration();
    expect(report()).toContain(`    Trust Cert: ${expected}\n`);
  });

  test.each([undefined, null, [], ['warning one', 'warning two']])(
    'preserves auto-detection warnings %j',
    warnings => {
      summary.securityDecision = {
        type: 'auto-detected',
        reason: 'detected',
        securityLevel: 'low',
        confidence: 'low',
        warnings
      };
      summary.isDevEnvironment = true;
      config.logConfiguration();
      const output = report();
      expect(output).toContain('    Detection Confidence: low\n');
      expect(output).toContain(
        '    Security Level: ⚠️  Low\n    Environment: 🔧 Development (auto-detected)'
      );
      expect(output.includes('    ⚠️  Warnings:')).toBe(Boolean(warnings?.length));
      if (warnings?.length) expect(output).toContain('    ⚠️  Warnings: warning one, warning two');
    }
  );

  test.each(['SQL Server Authentication', 'Windows Authentication'])(
    'preserves authentication display for %s',
    authType => {
      summary.authType = authType;
      config.logConfiguration();
      const output = report();
      expect(output).toContain(`    Auth Type: ${authType}`);
      expect(output).toContain('    Password: ***********');
      expect(output.includes('    Domain: EXAMPLE')).toBe(authType === 'Windows Authentication');
      expect(output).not.toContain('Detection Confidence:');
    }
  );

  test.each([false, true])('preserves optional health lookup with encryption=%s', encrypt => {
    summary.encrypt = encrypt;
    config.logConfiguration(manager);
    expect(manager.getConnectionHealth).toHaveBeenCalledTimes(encrypt ? 1 : 0);
    expect(report().includes('🔐 SSL Connection Information:')).toBe(encrypt);
  });

  test('omits SSL details for health without SSL', () => {
    manager.getConnectionHealth.mockReturnValue({ connected: false });
    config.logConfiguration(manager);
    expect(report()).not.toContain('🔐 SSL Connection Information:');
  });

  test('preserves disabled SSL flags and absent note', () => {
    manager.getConnectionHealth.mockReturnValue({
      ssl: { encrypt: false, trust_server_certificate: true }
    });
    config.logConfiguration(manager);
    const output = report();
    expect(output).toContain('    Encryption: Disabled\n    Trust Server Certificate: Yes');
    expect(output).not.toContain('    Note:');
  });

  test.each([false, true])('preserves feature and operation toggles=%s', enabled => {
    config.performanceMonitoring.enabled = enabled;
    config.streaming.enabled = enabled;
    config.readOnlyMode = enabled;
    config.allowDestructiveOperations = enabled;
    config.allowSchemaChanges = enabled;
    config.logConfiguration();
    const output = report();
    expect(output.includes('    Max History:')).toBe(enabled);
    expect(output.includes('    Batch Size:')).toBe(enabled);
    expect(output).toContain(`    Read-Only Mode: ${enabled ? '🔒 true' : '🔓 false'}`);
    expect(output).toContain(
      `    Allow Destructive Operations: ${enabled ? '⚠️ true' : '✅ false'}`
    );
    expect(output).toContain(`    Allow Schema Changes: ${enabled ? '⚠️ true' : '✅ false'}`);
  });

  test.each([false, true])('uses default log paths with audit=%s', enabled => {
    logger.config = {};
    config.logging.securityAudit = enabled;
    config.logConfiguration(null, logger);
    const output = logger.info.mock.calls[0][1].configuration;
    expect(output).toContain('    Main Log: /default/main.log');
    expect(output.includes('    Security Audit: /default/security.log')).toBe(enabled);
    expect(output).toContain('    Error Log: /default/error.log');
  });

  test('handles logger without path configuration and empty validation', () => {
    delete logger.config;
    config.validate.mockReturnValue({ warnings: [], errors: [] });
    config.logConfiguration(null, logger);
    const output = logger.info.mock.calls[0][1].configuration;
    expect(logger._getSmartLogDefaults).not.toHaveBeenCalled();
    expect(output).not.toContain('📁 Log File Locations:');
    expect(output).not.toContain('Configuration Warnings:');
    expect(output).not.toContain('Configuration Errors:');
    expect(output).toMatch(/====================================$/);
  });

  test('omits unset runtime details, network interfaces and empty paths', () => {
    process.env = {};
    Object.defineProperty(process, 'argv', { value: ['node', 'server.js'] });
    Object.defineProperty(process, 'ppid', { get: () => 0 });
    Object.defineProperty(process, 'moduleLoadList', { value: undefined });
    os.networkInterfaces.mockReturnValue({ lo0: [] });
    config.getConnectionConfig.mockReturnValue({});
    logger.config = {};
    logger._getSmartLogDefaults.mockReturnValue({});
    logger.info = null;
    config.logConfiguration(null, logger);
    const output = report();
    expect(output).toContain('    Parent Process ID: unknown');
    expect(output).toContain('    Environment: development');
    expect(output).toContain('    Connection String Length: 0 chars');
    expect(output).toContain('    Total Modules Loaded: 0');
    expect(output).not.toMatch(
      /Command Args:|Key Env Vars:|Network Interfaces:|Main Log:|Error Log:/
    );
  });

  test('swallows network-interface failures but continues in evaluation order', () => {
    const calls = [];
    config.getConnectionSummary.mockImplementation(function () {
      expect(this).toBe(config);
      calls.push('summary');
      return summary;
    });
    config.getConnectionConfig.mockImplementation(function () {
      expect(this).toBe(config);
      calls.push('config');
      return {};
    });
    os.hostname.mockImplementation(() => {
      calls.push('hostname');
      return 'host';
    });
    os.networkInterfaces.mockImplementation(() => {
      calls.push('interfaces');
      throw new Error('unavailable');
    });
    manager.getConnectionHealth.mockImplementation(() => {
      calls.push('health');
      return {};
    });
    logger._getSmartLogDefaults.mockImplementation(() => {
      calls.push('paths');
      return {};
    });
    config.validate.mockImplementation(function () {
      expect(this).toBe(config);
      calls.push('validation');
      return { warnings: [], errors: [] };
    });
    logger.info.mockImplementation(() => calls.push('output'));
    config.logConfiguration(manager, logger);
    expect(calls).toEqual([
      'summary',
      'config',
      'hostname',
      'interfaces',
      'health',
      'paths',
      'validation',
      'output'
    ]);
  });

  test.each(['summary', 'config', 'hostname', 'health', 'paths', 'validation', 'output'])(
    'preserves propagated exception from %s',
    stage => {
      const failure = new Error(stage);
      const methods = {
        summary: config.getConnectionSummary,
        config: config.getConnectionConfig,
        hostname: os.hostname,
        health: manager.getConnectionHealth,
        paths: logger._getSmartLogDefaults,
        validation: config.validate,
        output: logger.info
      };
      methods[stage].mockImplementation(() => {
        throw failure;
      });
      expect(() => config.logConfiguration(manager, logger)).toThrow(failure);
      expect(stderr).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledTimes(stage === 'output' ? 1 : 0);
    }
  );
});
