import { EventEmitter } from 'node:events';
import { ReadBuffer } from '@modelcontextprotocol/sdk/shared/stdio.js';

const scenario = process.env.WARP_PERF_SCENARIO;
let nextId = 1;

function trace(event, detail = {}) {
  process.stderr.write('WARP_PERF_TRACE:' + JSON.stringify({ event, ...detail }) + '\n');
}

function rpcResult(text, requestId) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: requestId,
    result: { content: [{ type: 'text', text }] }
  });
}

function healthText() {
  const activeConnections = { 'health-94': 94, 'health-95': 95 }[scenario] ?? 2;
  return JSON.stringify({
    success: true,
    data: {
      pool: {
        health: {
          status: 'healthy',
          score: 98,
          issues: activeConnections > 2 ? ['Connection pool near capacity'] : []
        },
        current: {
          activeConnections,
          totalConnections: activeConnections > 2 ? 100 : 10
        }
      }
    }
  });
}

function responseFor(id, requestId) {
  if (id === 1) {
    if (scenario === 'jsonrpc-error-first') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        error: { code: -32603, message: 'database unavailable' }
      });
    }
    if (scenario === 'tool-error-first') {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        result: { isError: true, content: [{ type: 'text', text: 'query blocked' }] }
      });
    }
    const response = rpcResult('Microsoft SQL Server 2022', requestId);
    return scenario === 'noisy-json' ? '{not-json}\n' + response : response;
  }
  if (id === 2) {
    return rpcResult(
      scenario === 'malformed-details'
        ? 'not-json'
        : JSON.stringify({ success: true, data: { enabled: true, overall: { totalQueries: 7 } } }),
      requestId
    );
  }
  if (id === 3) {
    return rpcResult(scenario === 'malformed-details' ? 'not-json' : healthText(), requestId);
  }
  return rpcResult('operation complete', requestId);
}

export function spawn(command, args, options) {
  const id = nextId++;
  trace('spawn', { id, command, args, stdio: options.stdio });

  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const input = new ReadBuffer();
  let request;
  child.stdin = {
    write(data) {
      trace('write', { id, data });
      if (scenario === 'send-fails-first' && id === 1) {
        throw new Error('stub write failure');
      }
      input.append(Buffer.from(data));
      request = input.readMessage();
      return true;
    },
    end() {
      trace('end', { id });
      if (scenario === 'timeout-first' && id === 1) {
        return;
      }
      if (scenario === 'process-failure' && id === 2) {
        child.stderr.emit('data', Buffer.from('stub failure'));
        child.emit('close', 2);
        return;
      }
      if (
        (scenario === 'stdio-framing' && !request) ||
        (scenario === 'no-response-first' && id === 1)
      ) {
        child.emit('close', 0);
        return;
      }
      if (scenario === 'response-before-close' && id === 1) {
        const response = responseFor(id, request.id) + '\n';
        const splitAt = Math.floor(response.length / 2);
        child.stdout.emit('data', Buffer.from(response.slice(0, splitAt)));
        child.stdout.emit('data', Buffer.from(response.slice(splitAt)));
        return;
      }
      if (scenario === 'wrong-id-first' && id === 1) {
        child.stdout.emit('data', Buffer.from(rpcResult('wrong response', request.id + 1) + '\n'));
      }
      child.stdout.emit('data', Buffer.from(responseFor(id, request.id) + '\n'));
      child.emit('close', 0);
    }
  };
  child.kill = () => trace('kill', { id });
  return child;
}
