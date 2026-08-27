/**
 * Query-safety policy for execute_query / explain_query / table-scoped tools.
 *
 * These are pure functions extracted from SqlServerMCP so the policy can be
 * unit-tested in isolation and reused without a live server instance. They take
 * the resolved safety-mode flags and security config as parameters rather than
 * reading `this`; SqlServerMCP keeps thin `validateQuery` / `validateWhereClause`
 * delegators that supply those inputs from its getters and config.
 *
 * The classification here is deliberately regex/prefix based and is backed by
 * the fail-closed lexical batch guard (`findForbiddenBatchStatement`) so that a
 * batch such as `SELECT 1 DELETE FROM t` cannot slip through on its SELECT
 * prefix alone (GHSA-qhf4-jmhq-73c8).
 */

import { findForbiddenBatchStatement } from './sql-batch-guard.js';

/**
 * Determine the type of a single SQL statement.
 *
 * @param {string} query
 * @param {object} securityConfig - result of ServerConfig.getSecurityConfig()
 * @param {{warn?: Function}} [logger] - optional logger for corrupted-config warnings
 * @returns {'select'|'schema'|'destructive'|'unknown'}
 */
export function getSingleQueryType(query, securityConfig, logger) {
  const trimmedQuery = query.trim();

  // Safety check for corrupted security patterns
  if (!securityConfig?.patterns) {
    logger?.warn?.('Security patterns are corrupted, falling back to default behavior');
    return 'unknown';
  }

  // Check for read-only queries
  if (securityConfig.patterns.readOnly?.some?.(pattern => pattern.test(trimmedQuery))) {
    return 'select';
  }

  // Check for schema changes
  if (securityConfig.patterns.schemaChanges?.some?.(pattern => pattern.test(trimmedQuery))) {
    return 'schema';
  }

  // Check for destructive operations
  if (securityConfig.patterns.destructive?.some?.(pattern => pattern.test(trimmedQuery))) {
    return 'destructive';
  }

  return 'unknown';
}

/**
 * Determine the type of a SQL query, handling ';'-separated multi-statement
 * batches by taking the most restrictive type.
 *
 * @param {string} query
 * @param {object} securityConfig
 * @param {{warn?: Function}} [logger]
 * @returns {'select'|'schema'|'destructive'|'unknown'}
 */
export function getQueryType(query, securityConfig, logger) {
  // Check for multi-statement queries first (semicolon separated)
  const statements = query
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (statements.length > 1) {
    // For multi-statement, find the most restrictive type
    const types = new Set(statements.map(stmt => getSingleQueryType(stmt, securityConfig, logger)));

    if (types.has('schema')) return 'schema';
    if (types.has('destructive')) return 'destructive';
    if (types.has('select')) return 'select';
    return 'unknown';
  }

  return getSingleQueryType(query, securityConfig, logger);
}

/**
 * Final backstop for a query the regex classification would allow.
 *
 * getQueryType only looks at how each ';'-separated statement *starts*, but
 * T-SQL does not require ';' between statements, so "SELECT 1 DELETE FROM t"
 * classifies as 'select'. Scan the whole batch for statements the active
 * safety tier forbids before allowing it (GHSA-qhf4-jmhq-73c8). The guard is
 * also what rejects a batch that opens with an unrecognised statement, since
 * getQueryType classifies "<unknown>; SELECT 1" as 'select'.
 *
 * @param {string} query
 * @param {string} queryType
 * @param {{readOnlyMode: boolean, allowDestructiveOperations: boolean, allowSchemaChanges: boolean}} modes
 * @returns {{allowed: boolean, reason: string, queryType: string, keyword?: string}}
 */
export function allowUnlessBatchViolation(query, queryType, modes) {
  const violation = findForbiddenBatchStatement(query, modes);
  if (violation) {
    return {
      allowed: false,
      reason: violation.reason,
      queryType: violation.queryType,
      keyword: violation.keyword
    };
  }
  return { allowed: true, reason: 'Query validation passed', queryType };
}

/**
 * Validates a SQL query against the active safety policy.
 *
 * @param {string} query
 * @param {{readOnlyMode: boolean, allowDestructiveOperations: boolean, allowSchemaChanges: boolean}} modes
 * @param {object} securityConfig - result of ServerConfig.getSecurityConfig()
 * @param {{warn?: Function}} [logger] - optional logger for corrupted-config warnings
 * @returns {{allowed: boolean, reason: string, queryType?: string, keyword?: string, optimized?: boolean}}
 */
export function validateQuery(query, modes, securityConfig, logger) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { allowed: true, reason: 'Empty query' };
  }

  const { readOnlyMode, allowDestructiveOperations, allowSchemaChanges } = modes;

  // 🚀 OPTIMIZATION: Skip all parsing when in "full destruction mode"
  // When all safety restrictions are disabled, bypass expensive parsing
  if (!readOnlyMode && allowDestructiveOperations && allowSchemaChanges) {
    return {
      allowed: true,
      reason: 'Full destruction mode - all restrictions disabled, query validation bypassed',
      queryType: 'unrestricted',
      optimized: true
    };
  }

  // First, determine the query type
  const queryType = getQueryType(trimmedQuery, securityConfig, logger);

  // Check read-only mode first (most restrictive)
  if (readOnlyMode) {
    if (queryType !== 'select') {
      return {
        allowed: false,
        reason:
          'Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.',
        queryType: queryType === 'select' ? 'select' : 'non-select' // Keep original type for read-only violations
      };
    }
    return allowUnlessBatchViolation(trimmedQuery, queryType, modes);
  }

  // If not in read-only mode, check specific operation restrictions

  // Check for destructive operations
  if (queryType === 'destructive' && !allowDestructiveOperations) {
    return {
      allowed: false,
      reason:
        'Destructive operations (INSERT/UPDATE/DELETE) are disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.',
      queryType: 'destructive'
    };
  }

  // Check for schema changes
  if (queryType === 'schema' && !allowSchemaChanges) {
    return {
      allowed: false,
      reason:
        'Schema changes (CREATE/DROP/ALTER) are disabled. Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=true to enable.',
      queryType: 'schema'
    };
  }

  return allowUnlessBatchViolation(trimmedQuery, queryType, modes);
}
