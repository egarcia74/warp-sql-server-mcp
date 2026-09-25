import { URL } from 'node:url';

// Exercise the real CLI, replacing only the external process it launches.
export function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'node:child_process' &&
    context.parentURL?.endsWith('/test/manual/warp-mcp-performance-test.js')
  ) {
    return {
      url: new URL('./warp-perf-child-stub.mjs', import.meta.url).href,
      shortCircuit: true
    };
  }

  return nextResolve(specifier, context);
}
