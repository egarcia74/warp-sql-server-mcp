import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

function expectCurrentNodeExecutable(source) {
  expect(source).toMatch(/spawn\(process\.execPath,\s*\[/);
  expect(source).not.toMatch(/spawn\(\s*['"]node['"]/);
}

describe('credential-bearing test server launchers', () => {
  test('the persistent performance test does not resolve Node through PATH', () => {
    expectCurrentNodeExecutable(readFileSync('test/manual/improved-performance-test.js', 'utf8'));
  });

  test('the Warp performance test does not resolve Node through PATH', () => {
    expectCurrentNodeExecutable(readFileSync('test/manual/warp-mcp-performance-test.js', 'utf8'));
  });

  test('the protocol startup test does not resolve Node through PATH', () => {
    expectCurrentNodeExecutable(readFileSync('test/protocol/mcp-server-startup-test.js', 'utf8'));
  });
});
