import { describe, test, expect, beforeEach, vi } from 'vitest';
import { BottleneckDetector } from '../../lib/analysis/bottleneck-detector.js';

describe('BottleneckDetector.detectBottlenecks (query-stats DMVs)', () => {
  let detector;
  let mockRequest;

  beforeEach(() => {
    mockRequest = { query: vi.fn() };
    const mockPool = { request: () => mockRequest, connected: true };
    detector = new BottleneckDetector({ getPool: () => mockPool, connect: async () => mockPool });
  });

  test('throws when not connected', async () => {
    const offline = new BottleneckDetector({ getPool: () => null });
    await expect(offline.detectBottlenecks('Db')).rejects.toThrow('Not connected to any server');
  });

  test('queries query-stats DMVs and categorizes severity', async () => {
    mockRequest.query.mockResolvedValue({
      recordset: [
        {
          query_text: 'SELECT * FROM Orders',
          execution_count: 500,
          avg_cpu_time_us: 8000000,
          avg_elapsed_time_us: 9000000,
          avg_logical_reads: 200000,
          total_logical_reads: 100000000
        },
        {
          query_text: 'SELECT 1',
          execution_count: 3,
          avg_cpu_time_us: 1000,
          avg_elapsed_time_us: 1200,
          avg_logical_reads: 4,
          total_logical_reads: 12
        }
      ]
    });

    const out = await detector.detectBottlenecks('McpToolingTestDb', { limit: 10 });

    const sqlText = mockRequest.query.mock.calls[0][0];
    expect(sqlText).toContain('sys.dm_exec_query_stats');
    expect(sqlText).toContain('sys.dm_exec_sql_text');
    expect(sqlText).toContain("DB_ID(N'McpToolingTestDb')");
    expect(out).toHaveLength(2);
    expect(out[0].severity).toBe('CRITICAL'); // 8s avg CPU
    expect(out[0].query).toContain('SELECT * FROM Orders');
    expect(out[1].severity).toBe('LOW');
  });

  test('applies severity_filter', async () => {
    mockRequest.query.mockResolvedValue({
      recordset: [
        {
          query_text: 'big',
          execution_count: 1,
          avg_cpu_time_us: 9000000,
          avg_elapsed_time_us: 9000000,
          avg_logical_reads: 1,
          total_logical_reads: 1
        },
        {
          query_text: 'small',
          execution_count: 1,
          avg_cpu_time_us: 100,
          avg_elapsed_time_us: 100,
          avg_logical_reads: 1,
          total_logical_reads: 1
        }
      ]
    });

    const out = await detector.detectBottlenecks('Db', { severityFilter: 'CRITICAL' });

    expect(out.every(b => b.severity === 'CRITICAL')).toBe(true);
    expect(out).toHaveLength(1);
  });
});
