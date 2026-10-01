import { describe, expect, it, vi } from 'vitest';

import { loadPerformanceTestEnvironment } from '../manual/improved-performance-test.js';

describe('manual performance test environment', () => {
  it('does not load Docker credentials for an external Windows-authentication run', () => {
    const config = vi.fn();
    loadPerformanceTestEnvironment({ SQL_SERVER_HOST: 'external-host' }, config);
    expect(config).not.toHaveBeenCalled();
  });

  it('loads the generated credential only in Docker mode', () => {
    const config = vi.fn();
    loadPerformanceTestEnvironment({ MCP_TESTING_MODE: 'docker' }, config);
    expect(config).toHaveBeenCalledWith({
      path: './test/docker/.env.docker',
      override: true
    });
  });
});
