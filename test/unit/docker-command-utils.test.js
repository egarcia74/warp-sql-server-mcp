import { afterEach, describe, expect, it } from 'vitest';

import { SAFE_PATH, buildMergedEnv, parseCommandArguments } from '../docker/command-utils.js';

const ORIGINAL_ENV = process.env;

describe('Docker command utils', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('parses quoted command arguments without splitting quoted sections', () => {
    const args = parseCommandArguments('docker ps --format "{{.Names}} {{.Status}}"');

    expect(args).toEqual(['docker', 'ps', '--format', '{{.Names}} {{.Status}}']);
  });

  it('preserves empty quoted arguments', () => {
    const args = parseCommandArguments('cmd "" arg');

    expect(args).toEqual(['cmd', '', 'arg']);
  });

  it('merges process env when no custom env is provided and forces SAFE_PATH', () => {
    process.env = {
      ...ORIGINAL_ENV,
      MCP_TEST_VALUE: 'from-process',
      PATH: '/opt/example-path'
    };

    const mergedEnv = buildMergedEnv();

    expect(mergedEnv.MCP_TEST_VALUE).toBe('from-process');
    expect(mergedEnv.PATH).toBe(SAFE_PATH);
  });

  it('preserves custom variables while overriding custom PATH with SAFE_PATH', () => {
    process.env = {
      ...ORIGINAL_ENV,
      MCP_BASE_VALUE: 'base'
    };

    const mergedEnv = buildMergedEnv({
      TESTING_MODE: 'true',
      PATH: '/opt/custom-path'
    });

    expect(mergedEnv.MCP_BASE_VALUE).toBe('base');
    expect(mergedEnv.TESTING_MODE).toBe('true');
    expect(mergedEnv.PATH).toBe(SAFE_PATH);
  });
});
