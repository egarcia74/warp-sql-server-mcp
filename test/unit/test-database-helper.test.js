import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { serverConfig } from '../../lib/config/server-config.js';
import { TestDatabaseHelper } from '../integration/manual/test-database-helper.js';

const permissions = () => ({
  readOnly: process.env.SQL_SERVER_READ_ONLY,
  destructive: process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS,
  schema: process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES
});

function setupPermissionEnvironment() {
  const originalEnv = { ...process.env };
  delete process.env.MCP_TESTING_MODE;
  process.env.SQL_SERVER_READ_ONLY = 'true';
  process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'false';
  process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
  const server = { executeQuery: vi.fn() };
  const reloadStates = [];
  const reload = serverConfig.reload.bind(serverConfig);
  vi.spyOn(serverConfig, 'reload').mockImplementation(() => {
    reloadStates.push(permissions());
    reload();
  });
  return { originalEnv, server, reloadStates };
}

function expectRestoredPermissions(reloadStates, expected) {
  expect(reloadStates).toEqual([
    { readOnly: 'false', destructive: 'true', schema: 'true' },
    expected
  ]);
  expect(permissions()).toEqual(expected);
  expect(serverConfig.readOnlyMode).toBe(true);
  expect(serverConfig.allowDestructiveOperations).toBe(false);
  expect(serverConfig.allowSchemaChanges).toBe(false);
}

describe('TestDatabaseHelper.createTestDatabase', () => {
  let originalEnv;
  let server;
  let reloadStates;
  let logs;
  let errors;

  beforeEach(() => {
    ({ originalEnv, server, reloadStates } = setupPermissionEnvironment());
    vi.spyOn(TestDatabaseHelper.prototype, 'loadDockerEnvironment').mockImplementation(() => {});
    logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    serverConfig.reload();
  });

  test('uses a predefined Docker database after verification without changing permissions', async () => {
    process.env.MCP_TESTING_MODE = 'docker';
    server.executeQuery.mockResolvedValue({ content: [{ text: 'TableCount: 12' }] });
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('Phase1ReadOnly')).resolves.toBe('Phase1ReadOnly');

    expect(server.executeQuery).toHaveBeenCalledTimes(1);
    expect(server.executeQuery.mock.calls[0][0]).toContain('USE [Phase1ReadOnly]');
    expect(server.executeQuery.mock.calls[0][0]).toContain('INFORMATION_SCHEMA.TABLES');
    expect(logs.mock.calls.map(call => call[0])).toEqual([
      '🔌 Connecting to database: Phase1ReadOnly (Docker mode)',
      '✅ Connected to Phase1ReadOnly - found 12 tables'
    ]);
    expect(reloadStates).toEqual([]);
    expect(permissions()).toEqual({ readOnly: 'true', destructive: 'false', schema: 'false' });
    expect(helper.getTestDatabases()).toEqual([]);
  });

  test('falls through to creation when Docker verification has no content', async () => {
    process.env.MCP_TESTING_MODE = 'docker';
    server.executeQuery
      .mockResolvedValueOnce({ content: [] })
      .mockResolvedValueOnce({ content: [{ text: 'DbCount: 0' }] })
      .mockResolvedValueOnce({ content: [{ text: 'created' }] });
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('ProtocolTest')).resolves.toBe('ProtocolTest');

    expect(server.executeQuery.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('USE [ProtocolTest]'),
      expect.stringContaining("WHERE name = 'ProtocolTest'"),
      'CREATE DATABASE [ProtocolTest]'
    ]);
    expect(helper.getTestDatabases()).toEqual(['ProtocolTest']);
    expect(reloadStates).toEqual([
      { readOnly: 'false', destructive: 'true', schema: 'true' },
      { readOnly: 'true', destructive: 'false', schema: 'false' }
    ]);
    expect(logs.mock.calls.map(call => call[0])).toEqual([
      '🔌 Connecting to database: ProtocolTest (Docker mode)',
      '🏗️  Creating empty database: ProtocolTest (schema should be initialized externally)',
      '✅ Empty database created: ProtocolTest (tables should be created by external initialization)'
    ]);
  });

  test('falls back to the existence probe when Docker verification is null', async () => {
    process.env.MCP_TESTING_MODE = 'docker';
    server.executeQuery
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: [{ text: 'DbCount: 1' }] });
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('Phase1ReadOnly')).resolves.toBe('Phase1ReadOnly');

    expect(server.executeQuery).toHaveBeenCalledTimes(2);
    expect(logs.mock.calls.map(call => call[0])).toContain(
      '✅ Database Phase1ReadOnly already exists'
    );
    expect(logs.mock.calls.map(call => call[0])).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Could not check database existence')])
    );
  });

  test('starts the fallback probe in the verification-query continuation', async () => {
    process.env.MCP_TESTING_MODE = 'docker';
    let resolveVerification;
    server.executeQuery
      .mockReturnValueOnce(new Promise(resolve => (resolveVerification = resolve)))
      .mockResolvedValueOnce({ content: [{ text: 'DbCount: 1' }] });
    const helper = new TestDatabaseHelper(server);

    const result = helper.createTestDatabase('ProtocolTest');
    resolveVerification({ content: [] });
    await Promise.resolve();
    const callsBeforeAnotherContinuation = server.executeQuery.mock.calls.map(call => call[0]);
    await expect(result).resolves.toBe('ProtocolTest');

    expect(callsBeforeAnotherContinuation).toHaveLength(2);
    expect(callsBeforeAnotherContinuation[1]).toContain("WHERE name = 'ProtocolTest'");
  });

  test('generates a name, ignores createTables, and restores permissions after creation', async () => {
    server.executeQuery
      .mockResolvedValueOnce({ content: [{ text: 'DbCount: 0' }] })
      .mockResolvedValueOnce({ content: [{ text: 'created' }] });
    const helper = new TestDatabaseHelper(server);
    vi.spyOn(helper, 'generateTestDatabaseName').mockReturnValue('Generated_Test');

    await expect(helper.createTestDatabase(null, false)).resolves.toBe('Generated_Test');

    expect(helper.generateTestDatabaseName).toHaveBeenCalledTimes(1);
    expect(server.executeQuery.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining("WHERE name = 'Generated_Test'"),
      'CREATE DATABASE [Generated_Test]'
    ]);
    expect(helper.getTestDatabases()).toEqual(['Generated_Test']);
    expect(reloadStates).toEqual([
      { readOnly: 'false', destructive: 'true', schema: 'true' },
      { readOnly: 'true', destructive: 'false', schema: 'false' }
    ]);
    expect(permissions()).toEqual({ readOnly: 'true', destructive: 'false', schema: 'false' });
    expect(logs.mock.calls.map(call => call[0])).toEqual([
      'ℹ️  Note: createTables parameter is ignored - Docker init script handles all schema creation',
      '🔌 Connecting to database: Generated_Test',
      '🏗️  Creating empty database: Generated_Test (schema should be initialized externally)',
      '✅ Empty database created: Generated_Test (tables should be created by external initialization)'
    ]);
  });

  test('restores permissions after finding an existing database', async () => {
    server.executeQuery.mockResolvedValue({ content: [{ text: 'DbCount: 1' }] });
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('ExistingDb')).resolves.toBe('ExistingDb');

    expect(server.executeQuery).toHaveBeenCalledTimes(1);
    expect(server.executeQuery.mock.calls[0][0]).toContain("WHERE name = 'ExistingDb'");
    expect(helper.getTestDatabases()).toEqual([]);
    expect(reloadStates).toEqual([
      { readOnly: 'false', destructive: 'true', schema: 'true' },
      { readOnly: 'true', destructive: 'false', schema: 'false' }
    ]);
    expect(permissions()).toEqual({ readOnly: 'true', destructive: 'false', schema: 'false' });
    expect(serverConfig.readOnlyMode).toBe(true);
    expect(serverConfig.allowDestructiveOperations).toBe(false);
    expect(serverConfig.allowSchemaChanges).toBe(false);
    expect(logs.mock.calls.at(-1)).toEqual(['✅ Database ExistingDb already exists']);
  });

  test('treats a zero-valued existence result as absent without a probe error', async () => {
    server.executeQuery
      .mockResolvedValueOnce({ content: [{ text: 0 }] })
      .mockResolvedValueOnce({ content: [{ text: 'created' }] });
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('ZeroDb')).resolves.toBe('ZeroDb');

    expect(server.executeQuery.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining("WHERE name = 'ZeroDb'"),
      'CREATE DATABASE [ZeroDb]'
    ]);
    expect(helper.getTestDatabases()).toEqual(['ZeroDb']);
    expect(logs.mock.calls.map(call => call[0])).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Could not check database existence')])
    );
  });

  test('restores absent permission variables after finding an existing database', async () => {
    delete process.env.SQL_SERVER_READ_ONLY;
    delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
    delete process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES;
    server.executeQuery.mockResolvedValue({ content: [{ text: 'DbCount: 1' }] });
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('ExistingDb')).resolves.toBe('ExistingDb');

    expectRestoredPermissions(reloadStates, {
      readOnly: undefined,
      destructive: undefined,
      schema: undefined
    });
  });

  test('reloads temporary permissions synchronously before its first database probe', async () => {
    server.executeQuery.mockResolvedValue({ content: [{ text: 'DbCount: 1' }] });
    const helper = new TestDatabaseHelper(server);

    const result = helper.createTestDatabase('ExistingDb');
    const immediateCalls = server.executeQuery.mock.calls.map(call => call[0]);
    const immediateReloadStates = [...reloadStates];
    const immediatePermissions = permissions();
    await expect(result).resolves.toBe('ExistingDb');

    expect(immediateCalls).toHaveLength(1);
    expect(immediateReloadStates).toEqual([
      { readOnly: 'false', destructive: 'true', schema: 'true' }
    ]);
    expect(immediatePermissions).toEqual({
      readOnly: 'false',
      destructive: 'true',
      schema: 'true'
    });
  });

  test('skips verification for a custom Docker database without an extra async yield', async () => {
    process.env.MCP_TESTING_MODE = 'docker';
    server.executeQuery.mockResolvedValue({ content: [{ text: 'DbCount: 1' }] });
    const helper = new TestDatabaseHelper(server);

    const result = helper.createTestDatabase('CustomDb');
    const immediateCalls = server.executeQuery.mock.calls.map(call => call[0]);
    const immediateReloadStates = [...reloadStates];
    const firstLog = logs.mock.calls[0];
    await expect(result).resolves.toBe('CustomDb');

    expect(immediateCalls).toHaveLength(1);
    expect(immediateCalls[0]).toContain("WHERE name = 'CustomDb'");
    expect(immediateReloadStates).toEqual([
      { readOnly: 'false', destructive: 'true', schema: 'true' }
    ]);
    expect(firstLog).toEqual(['🔌 Connecting to database: CustomDb (Docker mode)']);
  });

  test('logs an existence-probe failure and still creates the database', async () => {
    server.executeQuery
      .mockRejectedValueOnce(new Error('probe unavailable'))
      .mockResolvedValueOnce({ content: [{ text: 'created' }] });
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('ProbeDb')).resolves.toBe('ProbeDb');

    expect(server.executeQuery.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining("WHERE name = 'ProbeDb'"),
      'CREATE DATABASE [ProbeDb]'
    ]);
    expect(logs.mock.calls.map(call => call[0])).toContain(
      'ℹ️  Could not check database existence: probe unavailable'
    );
    expect(permissions()).toEqual({ readOnly: 'true', destructive: 'false', schema: 'false' });
    expect(helper.getTestDatabases()).toEqual(['ProbeDb']);
    expect(errors).not.toHaveBeenCalled();
  });

  test('starts database creation in the existence-query continuation', async () => {
    let resolveProbe;
    server.executeQuery
      .mockReturnValueOnce(new Promise(resolve => (resolveProbe = resolve)))
      .mockResolvedValueOnce({ content: [{ text: 'created' }] });
    const helper = new TestDatabaseHelper(server);

    const result = helper.createTestDatabase('NewDb');
    resolveProbe({ content: [{ text: 'DbCount: 0' }] });
    await Promise.resolve();
    const callsBeforeAnotherContinuation = server.executeQuery.mock.calls.map(call => call[0]);
    await expect(result).resolves.toBe('NewDb');

    expect(callsBeforeAnotherContinuation).toHaveLength(2);
    expect(callsBeforeAnotherContinuation[1]).toBe('CREATE DATABASE [NewDb]');
  });

  test('logs and rethrows a creation failure after restoring permissions', async () => {
    const failure = new Error('creation denied');
    server.executeQuery
      .mockResolvedValueOnce({ content: [{ text: 'DbCount: 0' }] })
      .mockRejectedValueOnce(failure);
    const helper = new TestDatabaseHelper(server);

    await expect(helper.createTestDatabase('DeniedDb')).rejects.toBe(failure);

    expect(server.executeQuery).toHaveBeenCalledTimes(2);
    expect(helper.getTestDatabases()).toEqual([]);
    expect(reloadStates).toEqual([
      { readOnly: 'false', destructive: 'true', schema: 'true' },
      { readOnly: 'true', destructive: 'false', schema: 'false' }
    ]);
    expect(permissions()).toEqual({ readOnly: 'true', destructive: 'false', schema: 'false' });
    expect(serverConfig.readOnlyMode).toBe(true);
    expect(serverConfig.allowDestructiveOperations).toBe(false);
    expect(serverConfig.allowSchemaChanges).toBe(false);
    expect(errors.mock.calls).toEqual([
      ['❌ Failed to connect to database DeniedDb:', 'creation denied']
    ]);
  });
});

describe('TestDatabaseHelper.cleanupDatabase', () => {
  let originalEnv;
  let server;
  let reloadStates;

  beforeEach(() => {
    ({ originalEnv, server, reloadStates } = setupPermissionEnvironment());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    serverConfig.reload();
  });

  test('restores permissions after a cleanup query is blocked', async () => {
    server.executeQuery.mockRejectedValueOnce(new Error('Query blocked by safety policy'));
    const helper = new TestDatabaseHelper(server);
    helper.testDatabases.push('ProtectedDb');

    await expect(helper.cleanupDatabase('ProtectedDb')).resolves.toBeUndefined();

    expect(server.executeQuery.mock.calls).toEqual([['USE master']]);
    expect(helper.getTestDatabases()).toEqual(['ProtectedDb']);
    expect(reloadStates).toEqual([
      { readOnly: 'false', destructive: 'true', schema: 'true' },
      { readOnly: 'true', destructive: 'false', schema: 'false' }
    ]);
    expect(permissions()).toEqual({ readOnly: 'true', destructive: 'false', schema: 'false' });
    expect(serverConfig.readOnlyMode).toBe(true);
    expect(serverConfig.allowDestructiveOperations).toBe(false);
    expect(serverConfig.allowSchemaChanges).toBe(false);
  });

  test('restores absent permission variables after successful cleanup', async () => {
    delete process.env.SQL_SERVER_READ_ONLY;
    delete process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS;
    delete process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES;
    server.executeQuery.mockResolvedValue({ content: [] });
    const helper = new TestDatabaseHelper(server);
    helper.testDatabases.push('OldDb');

    await expect(helper.cleanupDatabase('OldDb')).resolves.toBeUndefined();

    expect(server.executeQuery).toHaveBeenCalledTimes(2);
    expect(helper.getTestDatabases()).toEqual([]);
    expectRestoredPermissions(reloadStates, {
      readOnly: undefined,
      destructive: undefined,
      schema: undefined
    });
  });
});

describe('TestDatabaseHelper.cleanupAllDatabases', () => {
  let originalEnv;
  let server;

  beforeEach(() => {
    ({ originalEnv, server } = setupPermissionEnvironment());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    serverConfig.reload();
  });

  test('finishes each database cleanup before starting the next', async () => {
    let finishFirstQuery;
    server.executeQuery.mockImplementation(query => {
      if (query === 'USE master' && !finishFirstQuery) {
        return new Promise(resolve => {
          finishFirstQuery = resolve;
        });
      }
      return Promise.resolve({ content: [] });
    });
    const helper = new TestDatabaseHelper(server);
    helper.testDatabases.push('FirstDb', 'SecondDb');

    const cleanup = helper.cleanupAllDatabases();
    expect(server.executeQuery.mock.calls).toEqual([['USE master']]);

    finishFirstQuery({ content: [] });
    await cleanup;

    expect(server.executeQuery.mock.calls.map(([query]) => query)).toEqual([
      'USE master',
      expect.stringContaining('DROP DATABASE [FirstDb]'),
      'USE master',
      expect.stringContaining('DROP DATABASE [SecondDb]')
    ]);
    expect(helper.getTestDatabases()).toEqual([]);
  });

  test('leaves databases added during cleanup for a later pass', async () => {
    let finishFirstQuery;
    server.executeQuery.mockImplementation(query => {
      if (query === 'USE master' && !finishFirstQuery) {
        return new Promise(resolve => {
          finishFirstQuery = resolve;
        });
      }
      return Promise.resolve({ content: [] });
    });
    const helper = new TestDatabaseHelper(server);
    helper.testDatabases.push('FirstDb');

    const cleanup = helper.cleanupAllDatabases();
    helper.testDatabases.push('LaterDb');
    finishFirstQuery({ content: [] });
    await cleanup;

    expect(server.executeQuery.mock.calls.map(([query]) => query)).toEqual([
      'USE master',
      expect.stringContaining('DROP DATABASE [FirstDb]')
    ]);
    expect(helper.getTestDatabases()).toEqual(['LaterDb']);
  });
});
