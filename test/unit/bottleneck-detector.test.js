import { describe, test, expect, beforeEach, vi } from 'vitest';
import { BottleneckDetector } from '../../lib/analysis/bottleneck-detector.js';

describe('BottleneckDetector.identifyBottleneckType', () => {
  const metrics = {
    avg_duration_ms: 100,
    avg_cpu_time_ms: 0,
    avg_logical_reads: 0,
    avg_physical_reads: 0,
    avg_wait_time_ms: 0
  };
  let detector;

  beforeEach(() => {
    detector = new BottleneckDetector(null);
  });

  test.each([
    ['PAGEIOLATCH_SH', 1001, 'IO_INTENSIVE'],
    ['PAGEIOLATCH_SH', 1000, 'IO_MODERATE'],
    ['PAGEIOLATCH_SH', 999, 'IO_MODERATE'],
    ['SOS_SCHEDULER_YIELD', 0, 'CPU_INTENSIVE'],
    ['RESOURCE_SEMAPHORE', 0, 'CPU_INTENSIVE'],
    ['MEMORY_ALLOCATION_EXT', 0, 'MEMORY_PRESSURE'],
    ['LCK_M_X', 0, 'BLOCKING_LOCKS'],
    ['ASYNC_NETWORK_IO', 0, 'NETWORK_BOTTLENECK']
  ])('classifies wait %s at %i physical reads as %s', (waitType, reads, expected) => {
    expect(
      detector.identifyBottleneckType({
        ...metrics,
        avg_cpu_time_ms: 100,
        avg_logical_reads: 20000,
        avg_physical_reads: reads,
        wait_stats: [{ wait_type: waitType, wait_time_ms: 10 }]
      })
    ).toBe(expected);
  });

  test.each([
    ['io', 'IO_MODERATE'],
    ['cpu', 'CPU_INTENSIVE'],
    ['memory', 'MEMORY_PRESSURE'],
    ['locking', 'BLOCKING_LOCKS'],
    ['network', 'NETWORK_BOTTLENECK']
  ])('preserves %s precedence over later overlapping wait categories', (category, expected) => {
    const categories = ['io', 'cpu', 'memory', 'locking', 'network'];
    const first = categories.indexOf(category);
    detector = new BottleneckDetector(null, {
      waitTypes: Object.fromEntries(
        categories.map((name, index) => [name, index >= first ? ['SHARED'] : []])
      )
    });
    const checked = [];
    const originalIsWaitType = detector.isWaitType;
    detector.isWaitType = function (waitType, name) {
      expect(this).toBe(detector);
      checked.push(name);
      return originalIsWaitType.call(this, waitType, name);
    };

    expect(
      detector.identifyBottleneckType({
        ...metrics,
        wait_stats: [{ wait_type: 'SHARED', wait_time_ms: 10 }]
      })
    ).toBe(expected);
    expect(checked).toEqual(categories.slice(0, first + 1));
  });

  test('uses the longest wait and preserves in-place sorting and stable ties', () => {
    const waits = [
      { wait_type: 'PAGEIOLATCH_SH', wait_time_ms: 1 },
      { wait_type: 'LCK_M_X', wait_time_ms: 20 },
      { wait_type: 'SOS_SCHEDULER_YIELD', wait_time_ms: 20 }
    ];
    const [short, firstLong, secondLong] = waits;

    expect(detector.identifyBottleneckType({ ...metrics, wait_stats: waits })).toBe(
      'BLOCKING_LOCKS'
    );
    expect(waits).toEqual([firstLong, secondLong, short]);
    expect(waits[0]).toBe(firstLong);
  });

  test.each([
    ['absent', undefined],
    ['empty', []],
    ['unrecognized', [{ wait_type: 'UNKNOWN_WAIT', wait_time_ms: 20 }]],
    ['missing type', [{ wait_time_ms: 20 }]]
  ])('falls back to metrics for %s waits', (_label, waits) => {
    expect(
      detector.identifyBottleneckType({
        ...metrics,
        avg_cpu_time_ms: 71,
        wait_stats: waits
      })
    ).toBe('CPU_INTENSIVE');
  });

  test('does not substitute a recognized shorter wait for an unknown primary wait', () => {
    expect(
      detector.identifyBottleneckType({
        ...metrics,
        avg_cpu_time_ms: 71,
        wait_stats: [
          { wait_type: 'PAGEIOLATCH_SH', wait_time_ms: 1 },
          { wait_type: 'UNKNOWN_WAIT', wait_time_ms: 20 }
        ]
      })
    ).toBe('CPU_INTENSIVE');
  });

  test.each([
    [
      'physical reads win',
      {
        avg_physical_reads: 1001,
        avg_cpu_time_ms: 71,
        avg_wait_time_ms: 51,
        avg_logical_reads: 10001
      },
      'IO_INTENSIVE'
    ],
    [
      'CPU wins over waits and logical reads',
      {
        avg_physical_reads: 1000,
        avg_cpu_time_ms: 71,
        avg_wait_time_ms: 51,
        avg_logical_reads: 10001
      },
      'CPU_INTENSIVE'
    ],
    [
      'waits win over logical reads',
      { avg_cpu_time_ms: 70, avg_wait_time_ms: 51, avg_logical_reads: 10001 },
      'WAIT_INTENSIVE'
    ],
    [
      'logical reads above threshold',
      { avg_wait_time_ms: 50, avg_logical_reads: 10001 },
      'MEMORY_INTENSIVE'
    ],
    [
      'exact thresholds do not match',
      {
        avg_physical_reads: 1000,
        avg_cpu_time_ms: 70,
        avg_wait_time_ms: 50,
        avg_logical_reads: 10000
      },
      'GENERAL_SLOW'
    ],
    [
      'below thresholds',
      {
        avg_physical_reads: 999,
        avg_cpu_time_ms: 69,
        avg_wait_time_ms: 49,
        avg_logical_reads: 9999
      },
      'GENERAL_SLOW'
    ],
    [
      'positive CPU over zero duration',
      { avg_duration_ms: 0, avg_cpu_time_ms: 1 },
      'CPU_INTENSIVE'
    ],
    [
      'positive wait over zero duration',
      { avg_duration_ms: 0, avg_wait_time_ms: 1 },
      'WAIT_INTENSIVE'
    ],
    ['zero over zero', { avg_duration_ms: 0 }, 'GENERAL_SLOW'],
    [
      'missing duration',
      { avg_duration_ms: undefined, avg_cpu_time_ms: 100, avg_wait_time_ms: 100 },
      'GENERAL_SLOW'
    ]
  ])('preserves metric fallback: %s', (_label, overrides, expected) => {
    expect(detector.identifyBottleneckType({ ...metrics, ...overrides })).toBe(expected);
  });

  test('missing metrics retain the general fallback', () => {
    expect(detector.identifyBottleneckType({})).toBe('GENERAL_SLOW');
  });

  test('uses configured read thresholds for both wait and metric classification', () => {
    detector = new BottleneckDetector(null, {
      thresholds: { highPhysicalReads: 4, highLogicalReads: 8 }
    });
    expect(detector.identifyBottleneckType({ ...metrics, avg_physical_reads: 5 })).toBe(
      'IO_INTENSIVE'
    );
    expect(detector.identifyBottleneckType({ ...metrics, avg_logical_reads: 9 })).toBe(
      'MEMORY_INTENSIVE'
    );
    expect(
      detector.identifyBottleneckType({
        ...metrics,
        avg_physical_reads: 4,
        wait_stats: [{ wait_type: 'PAGEIOLATCH_SH', wait_time_ms: 1 }]
      })
    ).toBe('IO_MODERATE');
  });

  test('reads each input once before selecting the primary wait', () => {
    const reads = [];
    const values = {
      ...metrics,
      wait_stats: [{ wait_type: 'LCK_M_X', wait_time_ms: 1 }]
    };
    const input = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          {
            get() {
              reads.push(name);
              return value;
            }
          }
        ])
      )
    );
    const originalGetPrimaryWaitType = detector.getPrimaryWaitType;
    detector.getPrimaryWaitType = function (waits) {
      expect(this).toBe(detector);
      reads.push('select wait');
      return originalGetPrimaryWaitType.call(this, waits);
    };

    expect(detector.identifyBottleneckType(input)).toBe('BLOCKING_LOCKS');
    expect(reads).toEqual([...Object.keys(values), 'select wait']);
  });

  test('does not turn an explicit null wait list into an empty list', () => {
    expect(() => detector.identifyBottleneckType({ ...metrics, wait_stats: null })).toThrow(
      TypeError
    );
  });
});

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
