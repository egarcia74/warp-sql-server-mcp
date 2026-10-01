// Loaded by NODE_OPTIONS in the regression test. Only a real Node process
// launched as the MCP server can emit this marker; the fake PATH binary cannot.
if (process.argv[1]?.endsWith('/index.js')) {
  process.stderr.write('REAL_NODE_CHILD_EXECUTED\n');
}
