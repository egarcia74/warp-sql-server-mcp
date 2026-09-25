// Replace only the server import made by the connectivity CLI. The CLI itself
// runs unchanged in a child process, so its exit codes and output remain real.
import { URL } from 'node:url';

export function resolve(specifier, context, nextResolve) {
  if (
    specifier === '../../index.js' &&
    context.parentURL?.endsWith('/test/docker/test-connectivity.js')
  ) {
    return {
      url: new URL('./connectivity-server-stub.js', import.meta.url).href,
      shortCircuit: true
    };
  }

  return nextResolve(specifier, context);
}
