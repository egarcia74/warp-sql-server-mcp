import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, test } from 'vitest';

const cliPath = fileURLToPath(new URL('../docker/test-connectivity.js', import.meta.url));
const loaderPath = fileURLToPath(new URL('./fixtures/connectivity-loader.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function runConnectivity(scenario) {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', '--experimental-loader', loaderPath, cliPath],
    {
      cwd: repoRoot,
      env: { ...process.env, CONNECTIVITY_TEST_CASE: scenario },
      encoding: 'utf8',
      timeout: 10000
    }
  );
  expect(result.error).toBeUndefined();
  return result;
}

describe('Docker connectivity CLI', () => {
  test('reports counted databases, SQL Server year and counted tables in order', () => {
    const result = runConnectivity('counted-lists');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const messages = [
      'MCP server initialized successfully',
      '1️⃣ Testing Database Connection...',
      'Connection successful - found 2 databases',
      '2️⃣ Testing Query Execution...',
      'Query successful - SQL Server 2022 detected',
      '3️⃣ Testing Table Operations...',
      'Table listing successful - found 2 tables',
      '🎉 All connectivity tests passed!'
    ];
    let lastPosition = -1;
    for (const message of messages) {
      const position = result.stdout.indexOf(message);
      expect(position).toBeGreaterThan(lastPosition);
      lastPosition = position;
    }
    expect(result.stdout).toContain(
      '✅ MCP server successfully communicates with Docker SQL Server container'
    );
    expect(result.stdout).toContain('💡 Ready for full testing with: npm run test:integration');
  });

  test('reports empty lists and the generic version when the year is absent', () => {
    const empty = runConnectivity('empty-lists');
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain('Connection successful - no user databases found');
    expect(empty.stdout).toContain('Table listing successful - no tables found');

    const version = runConnectivity('query-no-year');
    expect(version.status).toBe(0);
    expect(version.stdout).toContain('Query successful - SQL Server detected');
    expect(version.stdout).not.toContain('Query successful - SQL Server 2022 detected');
  });

  test.each([
    ['initialization-error', 'Failed to initialize MCP server: stub initialization error', '1️⃣'],
    ['database-error', 'Connection failed: stub database error', '2️⃣'],
    ['database-invalid', 'Connection failed: Invalid response format', '2️⃣'],
    ['query-error', 'Query execution failed: stub query error', '3️⃣'],
    ['query-invalid', 'Query execution failed: Invalid query result format', '3️⃣'],
    ['query-no-version', 'Query execution failed: No version data in query result', '3️⃣'],
    ['table-error', 'Table operations failed: stub table error', '🎉'],
    ['table-invalid', 'Table operations failed: Invalid response format', '🎉']
  ])('exits after %s without proceeding to the next phase', (scenario, message, nextPhase) => {
    const result = runConnectivity(scenario);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(message);
    expect(result.stdout).not.toContain(nextPhase);
  });
});
