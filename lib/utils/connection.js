/**
 * Shared connection helper for components that hold a ConnectionManager
 * directly (analysis classes) rather than extending BaseToolHandler.
 */

/**
 * Return an active connection pool, connecting lazily if one is not open yet.
 * Mirrors BaseToolHandler.getConnection: the pool is established at first use
 * so DMV-backed tools work even when they are the first database tool called
 * on a fresh server process.
 * @param {object} connectionManager - must expose getPool() and connect()
 * @returns {Promise<object>} an active mssql connection pool
 * @throws {Error} 'Not connected to any server' if no pool can be acquired
 */
export async function acquirePool(connectionManager) {
  let pool = connectionManager.getPool ? connectionManager.getPool() : null;
  if (!pool && connectionManager.connect) {
    pool = await connectionManager.connect();
  }
  if (!pool) {
    throw new Error('Not connected to any server');
  }
  return pool;
}
