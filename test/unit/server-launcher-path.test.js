import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const preloadPath = fileURLToPath(new URL('./fixtures/node-launch-trace.mjs', import.meta.url));
const launchers = [
  fileURLToPath(new URL('../manual/improved-performance-test.js', import.meta.url)),
  fileURLToPath(new URL('../manual/warp-mcp-performance-test.js', import.meta.url)),
  fileURLToPath(new URL('../protocol/mcp-server-startup-test.js', import.meta.url))
];

describe('credential-bearing test server launchers', () => {
  test.skipIf(process.platform === 'win32')(
    'use the running Node executable even when PATH starts with a malicious node',
    () => {
      const temporaryDirectory = mkdtempSync(join(tmpdir(), 'warp-server-launcher-path-'));
      try {
        writeFileSync(
          join(temporaryDirectory, 'node'),
          '#!/bin/sh\nprintf "PATH_NODE_EXECUTED\\n" >&2\nexit 42\n',
          { mode: 0o755 }
        );
        const safeEnvironment = Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith('SQL_SERVER_') && key !== 'MCP_TESTING_MODE'
          )
        );

        for (const launcher of launchers) {
          const result = spawnSync(process.execPath, [launcher], {
            cwd: temporaryDirectory,
            env: {
              ...safeEnvironment,
              PATH: `${temporaryDirectory}${delimiter}${process.env.PATH ?? ''}`,
              NODE_OPTIONS: `--import=${preloadPath}`
            },
            encoding: 'utf8',
            timeout: 7000
          });
          const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
          expect(output, launcher).toContain('REAL_NODE_CHILD_EXECUTED');
          expect(output, launcher).not.toContain('PATH_NODE_EXECUTED');
        }
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
    25000
  );
});
