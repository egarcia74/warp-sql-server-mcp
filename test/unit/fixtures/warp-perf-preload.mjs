import * as module from 'node:module';
import { URL } from 'node:url';
import { resolve } from './warp-perf-loader.mjs';

if (module.registerHooks) {
  module.registerHooks({ resolve });
} else {
  // Node 22.12-22.14 predates synchronous registration.
  module.register(new URL('./warp-perf-loader.mjs', import.meta.url), import.meta.url);
}

// Preserve the real timeout callbacks while avoiding wall-clock waits.
globalThis.setTimeout = (callback, delay) => {
  process.stderr.write('WARP_PERF_TRACE:' + JSON.stringify({ event: 'timer', delay }) + '\n');
  globalThis.queueMicrotask(callback);
  return 0;
};
globalThis.clearTimeout = () => {};
