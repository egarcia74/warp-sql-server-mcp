import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, test } from 'vitest';

const cliPath = fileURLToPath(new URL('../manual/warp-mcp-performance-test.js', import.meta.url));
const preloadPath = fileURLToPath(new URL('./fixtures/warp-perf-preload.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function runPerformanceCli(scenario) {
  const result = spawnSync(process.execPath, ['--import', preloadPath, cliPath], {
    cwd: repoRoot,
    env: { ...process.env, WARP_PERF_SCENARIO: scenario },
    encoding: 'utf8',
    timeout: 10000
  });
  expect(result.error).toBeUndefined();

  const trace = [];
  const otherStderr = [];
  for (const line of result.stderr.split('\n')) {
    if (line.startsWith('WARP_PERF_TRACE:')) {
      trace.push(JSON.parse(line.slice('WARP_PERF_TRACE:'.length)));
    } else {
      otherStderr.push(line);
    }
  }
  return { status: result.status, stdout: result.stdout, stderr: otherStderr.join('\n'), trace };
}

function events(trace, event) {
  return trace.filter(item => item.event === event);
}

function requests(trace) {
  return events(trace, 'write').map(item => {
    const jsonEnd = item.data.lastIndexOf('}');
    return JSON.parse(item.data.slice(0, jsonEnd + 1));
  });
}

describe('Warp MCP performance CLI', () => {
  test('runs the five MCP calls in order and reports a successful assessment', () => {
    const result = runPerformanceCli('all-success');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(events(result.trace, 'spawn')).toHaveLength(5);
    expect(events(result.trace, 'spawn').map(item => [item.command, item.args])).toEqual([
      ['node', ['index.js']],
      ['node', ['index.js']],
      ['node', ['index.js']],
      ['node', ['index.js']],
      ['node', ['index.js']]
    ]);
    expect(events(result.trace, 'timer').map(item => item.delay)).toEqual([
      20000, 15000, 15000, 25000, 25000
    ]);
    expect(requests(result.trace).map(item => [item.method, item.params.name])).toEqual([
      ['tools/call', 'execute_query'],
      ['tools/call', 'get_performance_stats'],
      ['tools/call', 'get_connection_health'],
      ['tools/call', 'list_databases'],
      ['tools/call', 'execute_query']
    ]);
    expect(requests(result.trace)[0].params.arguments.query).toBe('SELECT @@VERSION as Version');
    expect(requests(result.trace)[4].params.arguments.query).toBe(
      'SELECT COUNT(*) as TableCount FROM INFORMATION_SCHEMA.TABLES'
    );
    expect(result.stdout).toContain('📊 Connected to SQL Server successfully');
    expect(result.stdout).toContain('📈 Monitoring enabled: Yes');
    expect(result.stdout).toContain('📈 Total queries tracked: 7');
    expect(result.stdout).toContain('🔌 Pool status: healthy');
    expect(result.stdout).toContain('🔌 Health score: 98/100');
    expect(result.stdout).toContain('✅ 95% threshold working correctly');
    expect(result.stdout).toContain('• Total Requests: 5');
    expect(result.stdout).toContain('• Successful: 5 (100%)');
    expect(result.stdout).toContain('🌟 EXCELLENT - MCP server performing well with Warp');
    expect(result.stdout).toContain('🎉 Warp MCP performance test completed!');
    expect(events(result.trace, 'kill')).toHaveLength(0);
  });

  test('skips a malformed JSON-RPC line and parses the later response', () => {
    const result = runPerformanceCli('noisy-json');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('📊 Connected to SQL Server successfully');
    expect(result.stdout).toContain('• Successful: 5 (100%)');
  });

  test('warns on malformed monitoring and health payloads without failing requests', () => {
    const result = runPerformanceCli('malformed-details');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('⚠️  Could not parse performance data');
    expect(result.stdout).toContain('⚠️  Could not parse health data');
    expect(result.stdout).toContain('• Successful: 5 (100%)');
  });

  test('reports a false-positive pool warning below 95 percent', () => {
    const result = runPerformanceCli('health-94');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('❌ THRESHOLD ISSUE: False positive warning at 94.0%');
    expect(result.stdout).not.toContain('✅ 95% threshold working correctly');
  });

  test('does not report a false-positive pool warning at exactly 95 percent', () => {
    const result = runPerformanceCli('health-95');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✅ 95% threshold working correctly');
    expect(result.stdout).not.toContain('❌ THRESHOLD ISSUE');
  });

  test('records a nonzero child exit and completes the remaining requests', () => {
    const result = runPerformanceCli('process-failure');

    expect(result.status).toBe(1);
    expect(events(result.trace, 'spawn')).toHaveLength(5);
    expect(result.stdout).toContain('❌ Error: Process failed with code 2: stub failure');
    expect(result.stdout).toContain('• Successful: 4 (80%)');
    expect(result.stdout).toContain('• Failed: 1');
    expect(result.stderr).toContain(
      'Performance test failed: 1 failed requests (20.00% error rate)'
    );
  });

  test('kills a timed-out child and continues to the report', () => {
    const result = runPerformanceCli('timeout-first');

    expect(result.status).toBe(1);
    expect(events(result.trace, 'kill')).toEqual([{ event: 'kill', id: 1 }]);
    expect(result.stdout).toContain('❌ Error: Request timed out after 20000ms');
    expect(result.stdout).toContain('• Total Requests: 5');
    expect(result.stderr).toContain(
      'Performance test failed: 1 failed requests (20.00% error rate)'
    );
  });

  test('records a synchronous write failure without ending or killing that child', () => {
    const result = runPerformanceCli('send-fails-first');

    expect(result.status).toBe(1);
    expect(events(result.trace, 'end').map(item => item.id)).toEqual([2, 3, 4, 5]);
    expect(events(result.trace, 'kill')).toHaveLength(0);
    expect(result.stdout).toContain('❌ Error: Send failed: stub write failure');
    expect(result.stdout).toContain('• Failed: 1');
  });
});
