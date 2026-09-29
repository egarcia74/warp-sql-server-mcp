import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImprovedPerformanceTest } from '../manual/improved-performance-test.js';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

describe('ImprovedPerformanceTest.printPerformanceSummary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the maximum observed response time after sorting samples', () => {
    const runner = new ImprovedPerformanceTest();
    Object.assign(runner.stats, {
      responseTimes: [19, 7, 31],
      totalRequests: 3,
      successfulRequests: 3,
      failedRequests: 0,
      startTime: 1000,
      endTime: 2500
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    runner.printPerformanceSummary();

    const output = log.mock.calls.map(([message]) => String(message)).join('\n');
    expect(output).toContain('  Min:          7');
    expect(output).toContain('  Max:          31');
  });

  it('reports an empty sample set without printing response-time values', () => {
    const runner = new ImprovedPerformanceTest();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    runner.printPerformanceSummary();

    expect(log).toHaveBeenCalledExactlyOnceWith('❌ No successful requests to analyze');
  });
});
