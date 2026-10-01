// Loaded by NODE_OPTIONS in the regression test. Only a real Node process
// launched as the MCP server can write this marker; the fake PATH binary cannot.
import { appendFileSync } from 'node:fs';

if (process.argv[1]?.endsWith('/index.js')) {
  appendFileSync(
    process.env.NODE_LAUNCH_TRACE_FILE,
    `REAL_NODE_CHILD_EXECUTED:${process.execPath}\n`
  );
}
