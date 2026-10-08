import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

const entrypoint = fileURLToPath(new URL('../../index.js', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

// Captured from the unmodified stdio server on main@4626e7c. This hashes the
// complete ordered tool definitions, including descriptions and input schemas.
const baselineToolsSha256 = '964e3de37161c7ddb70d4b6003f56b8fc177e4deb6b8cc9a5a5ca945d12bfd0c';
const baselineToolNames = [
  'execute_query',
  'list_databases',
  'list_tables',
  'describe_table',
  'list_foreign_keys',
  'get_table_data',
  'export_table_csv',
  'get_performance_stats',
  'get_query_performance',
  'get_connection_health',
  'explain_query',
  'analyze_query_performance',
  'get_index_recommendations',
  'detect_query_bottlenecks',
  'get_optimization_insights',
  'get_server_info'
];

function startServer() {
  const child = spawn(process.execPath, [entrypoint], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test', SQL_SERVER_READ_ONLY: 'true' }
  });
  const reader = new ReadBuffer();
  const pending = new Map();
  const stdoutChunks = [];
  let protocolError;

  function fail(error) {
    protocolError = error;
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    pending.clear();
  }

  child.stdout.on('data', chunk => {
    try {
      stdoutChunks.push(chunk);
      reader.append(chunk);
      let message;
      while ((message = reader.readMessage()) !== null) {
        const waiter = pending.get(message.id);
        if (!waiter) {
          throw new Error(`Unexpected stdout protocol frame: ${JSON.stringify(message)}`);
        }
        pending.delete(message.id);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
      }
    } catch (error) {
      fail(error);
    }
  });
  child.on('error', fail);
  child.on('exit', (code, signal) => {
    if (pending.size) {
      fail(new Error(`Server exited before replying: ${code ?? signal}`));
    }
  });

  function request(id, method, params = {}) {
    if (protocolError) {
      return Promise.reject(protocolError);
    }
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
    });
    child.stdin.write(serializeMessage({ jsonrpc: '2.0', id, method, params }));
    return response;
  }

  return {
    request,
    notify(method) {
      child.stdin.write(serializeMessage({ jsonrpc: '2.0', method }));
    },
    get protocolError() {
      return protocolError;
    },
    get rawStdout() {
      return Buffer.concat(stdoutChunks);
    },
    async close() {
      if (child.exitCode === null && !child.killed) {
        const closed = new Promise(resolve => child.once('close', resolve));
        child.kill('SIGTERM');
        await closed;
      }
    }
  };
}

describe('MCP SDK stdio wire contract', () => {
  let wire;
  let initialize;

  beforeAll(async () => {
    wire = startServer();
    initialize = await wire.request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'wire-contract-test', version: '1.0.0' }
    });
    wire.notify('notifications/initialized');
  });

  afterAll(async () => {
    await wire?.close();
  });

  it('retains exact initialization metadata and capabilities', () => {
    expect(initialize).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {}, logging: {} },
        serverInfo: {
          name: 'warp-sql-server-mcp',
          version: packageJson.version,
          description:
            'Secure MCP server for connecting Warp to SQL Server with graduated safety levels and comprehensive database operations'
        },
        instructions:
          "🗄️ SQL Server MCP Server - Enterprise-grade database operations with graduated safety levels\n\n📊 Available Operations:\n• Database exploration: list_databases, list_tables, describe_table\n• Data operations: execute_query, get_table_data, export_table_csv\n• Performance analysis: get_performance_stats, analyze_query_performance\n• Query optimization: get_index_recommendations, detect_query_bottlenecks\n• Server diagnostics: get_server_info, get_connection_health\n\n🔒 Security Features:\n• Three-tier safety system with read-only, DML, and DDL restrictions\n• Query validation and SQL injection protection\n• Comprehensive audit logging and performance monitoring\n\n⚙️ Configuration:\n• Use 'get_server_info' tool to view current security settings\n• Supports both SQL Server and Windows authentication\n\n🚀 Quick Start: Try 'list_databases' to explore available databases"
      }
    });
  });

  it('retains all 16 ordered tool definitions and input schemas', async () => {
    const response = await wire.request(2, 'tools/list');
    expect(response.result.tools.map(tool => tool.name)).toEqual(baselineToolNames);
    expect(createHash('sha256').update(JSON.stringify(response.result.tools)).digest('hex')).toBe(
      baselineToolsSha256
    );
  });

  it('continues to expose an empty resource list', async () => {
    expect(await wire.request(3, 'resources/list')).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { resources: [] }
    });
  });

  it('retains the non-database performance result shape', async () => {
    expect(
      await wire.request(4, 'tools/call', { name: 'get_query_performance', arguments: {} })
    ).toEqual({
      jsonrpc: '2.0',
      id: 4,
      result: {
        content: [
          {
            type: 'text',
            text: '{\n  "success": true,\n  "data": {\n    "enabled": true,\n    "queries": [],\n    "byTool": {},\n    "slowQueries": []\n  },\n  "filters": {\n    "slowOnly": false,\n    "toolFilter": null\n  }\n}'
          }
        ]
      }
    });
  });

  it('retains the unknown-tool error frame', async () => {
    expect(await wire.request(5, 'tools/call', { name: 'not_a_tool', arguments: {} })).toEqual({
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32601, message: 'MCP error -32601: Unknown tool: not_a_tool' }
    });
  });

  it('retains the safety-policy error frame', async () => {
    expect(
      await wire.request(6, 'tools/call', {
        name: 'execute_query',
        arguments: { query: 'not SQL' }
      })
    ).toEqual({
      jsonrpc: '2.0',
      id: 6,
      error: {
        code: -32603,
        message:
          'MCP error -32603: Tool execution failed: Query blocked by safety policy: Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.'
      }
    });
  });

  it('writes only complete JSON-RPC frames to stdout', async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(wire.protocolError).toBeUndefined();
    expect(wire.rawStdout.at(-1)).toBe(10);
  });
});
