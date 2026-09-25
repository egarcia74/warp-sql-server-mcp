import * as module from 'node:module';
import { URL } from 'node:url';
import { resolve } from './wait-db-loader.mjs';

if (module.registerHooks) {
  module.registerHooks({ resolve });
} else {
  // Node 22.12-22.14 predates the synchronous hook API.
  module.register(new URL('./wait-db-loader.mjs', import.meta.url), import.meta.url);
}

// Let the CLI execute its real retry loop without wall-clock delays. The trace
// records each requested timeout; only the external clock is substituted.
globalThis.setTimeout = (callback, delay, ...args) => {
  process.stderr.write(`WAIT_DB_TRACE:${JSON.stringify({ event: 'sleep', delay })}\n`);
  Promise.resolve().then(() => callback(...args));
  return 0;
};
