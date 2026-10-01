import { describe, expect, it, vi } from 'vitest';

import { loadPerformanceTestEnvironment } from '../manual/improved-performance-test.js';

describe('manual performance test environment', () => {
  it('does not load Docker credentials for an external Windows-authentication run', () => {
    const config = vi.fn();
    loadPerformanceTestEnvironment({ SQL_SERVER_HOST: 'external-host' }, config);
    expect(config).not.toHaveBeenCalled();
  });

  it('loads the generated credential only in Docker mode', () => {
    const loadDockerEnvironment = vi.fn();
    const environment = { MCP_TESTING_MODE: 'docker' };
    loadPerformanceTestEnvironment(environment, loadDockerEnvironment);
    expect(loadDockerEnvironment).toHaveBeenCalledWith(environment);
  });

  it('propagates a missing Docker credential failure', () => {
    const loadDockerEnvironment = vi.fn(() => {
      throw new Error('Generated Docker environment is required');
    });
    expect(() =>
      loadPerformanceTestEnvironment({ MCP_TESTING_MODE: 'docker' }, loadDockerEnvironment)
    ).toThrow('Generated Docker environment is required');
  });
});
