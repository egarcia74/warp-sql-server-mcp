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

  test('severity_filter is case-insensitive', async () => {
    mockRequest.query.mockResolvedValue({
      recordset: [
        {
          query_text: 'big',
          execution_count: 1,
          avg_cpu_time_us: 9000000,
          avg_elapsed_time_us: 9000000,
          avg_logical_reads: 1,
          total_logical_reads: 1
        }
      ]
    });

    const out = await detector.detectBottlenecks('Db', { severityFilter: 'critical' });

    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('CRITICAL');
  });

  test('categorizes severity at exact thresholds (µs→ms boundaries)', async () => {
    mockRequest.query.mockResolvedValue({
      recordset: [
        { query_text: 'a', avg_cpu_time_us: 5000000, avg_logical_reads: 0 }, // 5000ms -> CRITICAL
        { query_text: 'b', avg_cpu_time_us: 4999999, avg_logical_reads: 0 }, // <5000ms -> HIGH
        { query_text: 'c', avg_cpu_time_us: 1000000, avg_logical_reads: 0 }, // 1000ms -> HIGH
        { query_text: 'd', avg_cpu_time_us: 100000, avg_logical_reads: 0 }, // 100ms -> MEDIUM
        { query_text: 'e', avg_cpu_time_us: 99999, avg_logical_reads: 0 } // <100ms -> LOW
      ]
    });

    const out = await detector.detectBottlenecks('Db');

    expect(out.map(b => b.severity)).toEqual(['CRITICAL', 'HIGH', 'HIGH', 'MEDIUM', 'LOW']);
  });

  test('classifies type as IO_BOUND / CPU_BOUND / NORMAL', async () => {
    mockRequest.query.mockResolvedValue({
      recordset: [
        { query_text: 'io', avg_cpu_time_us: 10, avg_logical_reads: 100000 }, // IO_BOUND
        { query_text: 'cpu', avg_cpu_time_us: 1000000, avg_logical_reads: 10 }, // CPU_BOUND
        { query_text: 'norm', avg_cpu_time_us: 10, avg_logical_reads: 10 } // NORMAL
      ]
    });

    const out = await detector.detectBottlenecks('Db');

    expect(out.map(b => b.type)).toEqual(['IO_BOUND', 'CPU_BOUND', 'NORMAL']);
  });

  test('embeds the sanitized database name in the DMV filter (injection defense wired)', async () => {
    mockRequest.query.mockResolvedValue({ recordset: [] });

    await detector.detectBottlenecks("My'Db");

    expect(mockRequest.query.mock.calls[0][0]).toContain("DB_ID(N'My''Db')");
  });

  test('lazily connects when no pool is open yet', async () => {
    const lazyRequest = { query: vi.fn().mockResolvedValue({ recordset: [] }) };
    const lazyPool = { request: () => lazyRequest, connected: true };
    const connect = vi.fn().mockResolvedValue(lazyPool);
    const lazyDetector = new BottleneckDetector({ getPool: () => null, connect });

    await lazyDetector.detectBottlenecks('Db');

    expect(connect).toHaveBeenCalled();
    expect(lazyRequest.query).toHaveBeenCalled();
  });

  test('returns empty array when the DMV result has no recordset', async () => {
    mockRequest.query.mockResolvedValue({});
    const out = await detector.detectBottlenecks('Db');
    expect(out).toEqual([]);
  });
});
