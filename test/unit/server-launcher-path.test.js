import { describe, expect, test } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

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
      const temporaryDirectory = mkdtempSync(join(tmpdir(), 'warp server launcher path-'));
      try {
        const preloadCopyPath = join(temporaryDirectory, 'node launch trace.mjs');
        copyFileSync(preloadPath, preloadCopyPath);
        writeFileSync(
          join(temporaryDirectory, 'node'),
          '#!/bin/sh\nprintf "PATH_NODE_EXECUTED\\n" >> "$NODE_LAUNCH_TRACE_FILE"\nexit 42\n',
          { mode: 0o755 }
        );
        // The manual launchers use a relative index.js. Give them a harmless
        // server module so the test proves Node actually loads it, without
        // connecting to SQL Server or depending on the launchers' error logs.
        writeFileSync(
          join(temporaryDirectory, 'index.js'),
          "require('node:fs').appendFileSync(process.env.NODE_LAUNCH_TRACE_FILE, 'SERVER_MODULE_LOADED\\n'); process.exit(42);\n"
        );
        const safeEnvironment = Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith('SQL_SERVER_') && key !== 'MCP_TESTING_MODE'
          )
        );

        for (const [index, launcher] of launchers.entries()) {
          const tracePath = join(temporaryDirectory, `launch-${index}.txt`);
          writeFileSync(tracePath, '');
          const result = spawnSync(process.execPath, [launcher], {
            cwd: temporaryDirectory,
            env: {
              ...safeEnvironment,
              PATH: `${temporaryDirectory}${delimiter}${process.env.PATH ?? ''}`,
              NODE_OPTIONS: `--import=${pathToFileURL(preloadCopyPath).href}`,
              NODE_LAUNCH_TRACE_FILE: tracePath
            },
            encoding: 'utf8',
            timeout: 7000
          });
          const trace = readFileSync(tracePath, 'utf8');
          expect(trace, launcher).toContain(`REAL_NODE_CHILD_EXECUTED:${process.execPath}\n`);
          expect(trace, launcher).not.toContain('PATH_NODE_EXECUTED');
          if (index < 2) {
            expect(trace, launcher).toContain('SERVER_MODULE_LOADED');
          } else {
            expect(result.error, launcher).toBeUndefined();
          }
        }
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
    25000
  );
});
