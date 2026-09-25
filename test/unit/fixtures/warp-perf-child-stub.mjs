import { EventEmitter } from 'node:events';

const scenario = process.env.WARP_PERF_SCENARIO;
let nextId = 1;

function trace(event, detail = {}) {
  process.stderr.write('WARP_PERF_TRACE:' + JSON.stringify({ event, ...detail }) + '\n');
}

function rpcResult(text) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
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

function responseFor(id) {
  if (id === 1) {
    const response = rpcResult('Microsoft SQL Server 2022');
    return scenario === 'noisy-json'
      ? '{not-json}' + String.fromCodePoint(92) + 'n' + response
      : response;
  }
  if (id === 2) {
    return rpcResult(
      scenario === 'malformed-details'
        ? 'not-json'
        : JSON.stringify({ success: true, data: { enabled: true, overall: { totalQueries: 7 } } })
    );
  }
  if (id === 3) {
    return rpcResult(scenario === 'malformed-details' ? 'not-json' : healthText());
  }
  return rpcResult('operation complete');
}

export function spawn(command, args, options) {
  const id = nextId++;
  trace('spawn', { id, command, args, stdio: options.stdio });

  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(data) {
      trace('write', { id, data });
      if (scenario === 'send-fails-first' && id === 1) {
        throw new Error('stub write failure');
      }
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
      child.stdout.emit('data', Buffer.from(responseFor(id)));
      child.emit('close', 0);
    }
  };
  child.kill = () => trace('kill', { id });
  return child;
}
