#!/usr/bin/env node
import { createPlatformAdapter, readSystemStatus } from './cleanup-process-platform.js';
import { inspect } from './cleanup-process-inspector.js';

const code = await inspect({
  args: process.argv.slice(2),
  adapter: createPlatformAdapter(),
  selfPid: process.pid,
  write: line => console.log(line),
  status: readSystemStatus
});
process.exitCode = code;
