import { URL } from 'node:url';

// Keep the real readiness CLI and replace only its external SQL Server client.
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'mssql' && context.parentURL?.endsWith('/test/docker/wait-for-db.js')) {
    return {
      url: new URL('./wait-db-sql-stub.js', import.meta.url).href,
      shortCircuit: true
    };
  }

  return nextResolve(specifier, context);
}
