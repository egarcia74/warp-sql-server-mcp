/**
 * Query Optimization and Analysis Engine
 * Provides intelligent query analysis, bottleneck detection, and optimization recommendations
 */
import { sanitizeDbName } from '../utils/sql-identifier.js';
import { acquirePool } from '../utils/connection.js';

/**
 * Map a missing-index avg_user_impact (0-100) to a priority bucket.
 * @param {number} impact - average user impact percentage
 * @returns {'high'|'medium'|'low'}
 */
function indexPriority(impact) {
  if (impact >= 75) return 'high';
  if (impact >= 40) return 'medium';
  return 'low';
}

export class QueryOptimizer {
  constructor(connectionManager, config = {}) {
    this.connectionManager = connectionManager;
    this.config = {
      // Complexity score weights
      complexityWeights: {
        joins: 2.0,
        subqueries: 1.5,
        aggregates: 1.2,
        unions: 1.8,
        ctes: 1.3,
        windowFunctions: 2.5,
        ...config.complexityWeights
      },
      // Performance thresholds
      thresholds: {
        slowQueryMs: config.slowQueryMs || 5000,
        highIoReads: config.highIoReads || 10000,
        highCpuMs: config.highCpuMs || 3000,
        lowImpactThreshold: config.lowImpactThreshold || 20,
        mediumImpactThreshold: config.mediumImpactThreshold || 50,
        highImpactThreshold: config.highImpactThreshold || 80,
        ...config.thresholds
      },
      // Feature flags
      features: {
        enableAdvancedAnalysis: config.enableAdvancedAnalysis ?? true,
        enableIndexRecommendations: config.enableIndexRecommendations ?? true,
        enableQueryRewriting: config.enableQueryRewriting ?? true,
        ...config.features
      }
    };
  }

  /**
   * Analyzes a SQL query and provides comprehensive optimization insights
   * @param {string} query - SQL query to analyze
   * @param {object} executionStats - Execution statistics from SQL Server
   * @param {object} planData - Execution plan data
   * @returns {object} Complete query analysis
   */
  analyzeQuery(query, executionStats = {}, planData = {}) {
    // Input validation to prevent null pointer exceptions
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    try {
      const analysis = {
        query: query.trim(),
        query_type: this.determineQueryType(query),
        complexity_score: this.calculateComplexityScore(query),
        estimated_cost: planData.TotalSubtreeCost || 0,
        table_access_methods: this.extractTableAccessMethods(planData),
        join_algorithms: this.extractJoinAlgorithms(planData),
        operators: this.extractOperators(planData),
        bottlenecks: this.identifyBottlenecks(query, executionStats, planData),
        performance_warnings: this.generatePerformanceWarnings(query, executionStats),
        optimization_suggestions: this.generateOptimizationSuggestions(
          query,
          executionStats,
          planData
        ),
        is_modification_query: this.isModificationQuery(query)
      };

      return analysis;
    } catch (error) {
      // Log the error and return a safe fallback analysis
      console.error('Error during query analysis:', error.message);
      return {
        query: query.trim(),
        query_type: 'UNKNOWN',
        complexity_score: 0,
        estimated_cost: 0,
        table_access_methods: [],
        join_algorithms: [],
        operators: [],
        bottlenecks: [],
        performance_warnings: ['Query analysis failed due to parsing error'],
        optimization_suggestions: [],
        is_modification_query: false,
        error: 'Query analysis failed'
      };
    }
  }

  /**
   * Determines the type of SQL query
   * @param {string} query - SQL query
   * @returns {string} Query type classification
   */
  determineQueryType(query) {
    // Null safety check to prevent runtime errors
    if (!query || typeof query !== 'string') {
      return 'UNKNOWN';
    }

    const trimmed = query.trim().toUpperCase();

    if (trimmed.startsWith('SELECT')) {
      if (this.containsJoins(query) && this.containsAggregation(query)) {
        return 'SELECT_WITH_JOIN_AND_AGGREGATION';
      } else if (this.containsJoins(query)) {
        return 'SELECT_WITH_JOIN';
      } else if (this.containsAggregation(query)) {
        return 'SELECT_WITH_AGGREGATION';
      } else if (this.containsSubqueries(query)) {
        return 'SELECT_WITH_SUBQUERY';
      }
      return 'SELECT_SIMPLE';
    } else if (trimmed.startsWith('INSERT')) {
      return 'INSERT';
    } else if (trimmed.startsWith('UPDATE')) {
      return 'UPDATE';
    } else if (trimmed.startsWith('DELETE')) {
      return 'DELETE';
    } else if (trimmed.startsWith('WITH')) {
      return 'CTE_QUERY';
    } else if (trimmed.startsWith('MERGE')) {
      return 'MERGE';
    }

    return 'UNKNOWN';
  }

  /**
   * Calculates query complexity score based on various factors
   * @param {string} query - SQL query
   * @returns {number} Complexity score (0-100)
   */
  calculateComplexityScore(query) {
    // Null safety check to prevent runtime errors
    if (!query || typeof query !== 'string') {
      return 0;
    }

    let score = 1; // Base score
    const upperQuery = query.toUpperCase();

    // Count joins
    const joinCount = (
      upperQuery.match(/\b(INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|JOIN)\b/g) || []
    ).length;
    score += joinCount * this.config.complexityWeights.joins;

    // Count subqueries
    const subqueryCount = this.countSubqueries(query);
    score += subqueryCount * this.config.complexityWeights.subqueries;

    // Count aggregates
    const aggregateCount = (upperQuery.match(/\b(COUNT|SUM|AVG|MIN|MAX|GROUP BY|HAVING)\b/g) || [])
      .length;
    score += aggregateCount * this.config.complexityWeights.aggregates;

    // Count unions
    const unionCount = (upperQuery.match(/\bUNION\b/g) || []).length;
    score += unionCount * this.config.complexityWeights.unions;

    // Count CTEs
    const cteCount = (upperQuery.match(/\bWITH\b/g) || []).length;
    score += cteCount * this.config.complexityWeights.ctes;

    // Count window functions
    const windowFunctionCount = (upperQuery.match(/\bOVER\s*\(/g) || []).length;
    score += windowFunctionCount * this.config.complexityWeights.windowFunctions;

    // Normalize to 0-100 scale (capped at 100)
    return Math.min(Math.round(score), 100);
  }

  /**
   * Identifies potential bottlenecks in query execution
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} List of identified bottlenecks
   */
  identifyBottlenecks(query, stats, planData) {
    const bottlenecks = [];

    // High I/O bottleneck
    if (stats.avg_logical_reads > this.config.thresholds.highIoReads) {
      bottlenecks.push({
        type: 'HIGH_IO',
        severity: 'HIGH',
        description: `High logical reads detected (${stats.avg_logical_reads})`,
        recommendation: 'Consider adding indexes or optimizing WHERE clauses'
      });
    }

    // CPU intensive operations
    if (stats.avg_cpu_time > this.config.thresholds.highCpuMs) {
      bottlenecks.push({
        type: 'CPU_INTENSIVE',
        severity: 'MEDIUM',
        description: `High CPU usage detected (${stats.avg_cpu_time}ms)`,
        recommendation: 'Review query logic and consider indexing strategies'
      });
    }

    // Large table scans
    if (this.hasTableScans(query, planData)) {
      bottlenecks.push({
        type: 'LARGE_TABLE_SCAN',
        severity: 'MEDIUM',
        description: 'Full table scan detected',
        recommendation: 'Consider adding index on frequently queried columns'
      });
    }

    // Inefficient joins
    if (this.hasInfficientJoins(query, planData)) {
      bottlenecks.push({
        type: 'INEFFICIENT_JOIN',
        severity: 'HIGH',
        description: 'Inefficient join algorithm detected',
        recommendation: 'Review join conditions and ensure proper indexing'
      });
    }

    return bottlenecks;
  }

  /**
   * Generates performance warnings based on query analysis
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @returns {array} List of performance warnings
   */
  generatePerformanceWarnings(query, _stats) {
    if (!query || typeof query !== 'string') {
      return [];
    }

    const warnings = [];
    const upperQuery = query.toUpperCase();

    // SELECT * warnings
    if (upperQuery.includes('SELECT *')) {
      warnings.push('SELECT * can impact performance - specify only needed columns');
    }

    // Missing WHERE clause
    if (
      upperQuery.includes('SELECT') &&
      !upperQuery.includes('WHERE') &&
      !upperQuery.includes('JOIN')
    ) {
      warnings.push('Query without WHERE clause may return large result sets');
    }

    // LEFT JOIN with large tables
    if (upperQuery.includes('LEFT JOIN') && this.containsLargeTables(query)) {
      warnings.push('LEFT JOIN with large table may cause performance issues');
    }

    // GROUP BY without covering index
    if (upperQuery.includes('GROUP BY')) {
      warnings.push('GROUP BY operation requires sorting - consider covering index');
    }

    // ORDER BY without index
    if (upperQuery.includes('ORDER BY') && !this.hasOrderByIndex(query)) {
      warnings.push('ORDER BY without supporting index may cause slow sorting');
    }

    // High execution count with slow performance
    if (_stats && _stats.execution_count > 100 && _stats.avg_duration > 1000) {
      warnings.push('Frequently executed slow query - high optimization priority');
    }

    return warnings;
  }

  /**
   * Generates specific optimization suggestions
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} List of optimization suggestions
   */
  generateOptimizationSuggestions(query, stats, _planData) {
    const suggestions = [];

    // Index recommendations
    if (this.config.features.enableIndexRecommendations) {
      const indexSuggestions = this.generateIndexRecommendations(query, stats, _planData);
      suggestions.push(...indexSuggestions);
    }

    // Query rewriting suggestions
    if (this.config.features.enableQueryRewriting) {
      const rewritingSuggestions = this.generateQueryRewritingSuggestions(query, stats);
      suggestions.push(...rewritingSuggestions);
    }

    // Performance tuning suggestions
    const tuningSuggestions = this.generateTuningSuggestions(query, stats, _planData);
    suggestions.push(...tuningSuggestions);

    return suggestions.sort(
      (a, b) => this.prioritySortOrder(a.priority) - this.prioritySortOrder(b.priority)
    );
  }

  /**
   * Generates index optimization recommendations
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} Index recommendations
   */
  generateIndexRecommendations(query, stats, _planData) {
    const suggestions = [];
    const upperQuery = query.toUpperCase();

    // Analyze WHERE clauses for index opportunities
    const whereColumns = this.extractWhereColumns(query);
    if (whereColumns.length > 0) {
      const impact = this.calculateIndexImpact(stats, 'WHERE');
      suggestions.push({
        type: 'INDEX_RECOMMENDATION',
        priority: impact > 70 ? 'HIGH' : 'MEDIUM',
        suggestion: `CREATE INDEX IX_${whereColumns.join('_')} ON [table](${whereColumns.join(', ')})`,
        estimated_improvement: `${Math.round(impact)}% performance gain`,
        reason: 'Optimize WHERE clause filtering'
      });
    }

    // Analyze JOIN conditions
    const joinColumns = this.extractJoinColumns(query);
    if (joinColumns.length > 0) {
      const impact = this.calculateIndexImpact(stats, 'JOIN');
      suggestions.push({
        type: 'INDEX_RECOMMENDATION',
        priority: impact > 60 ? 'HIGH' : 'MEDIUM',
        suggestion: `Consider covering index for JOIN operations on columns: ${joinColumns.join(', ')}`,
        estimated_improvement: `${Math.round(impact)}% performance gain`,
        reason: 'Optimize JOIN performance'
      });
    }

    // Analyze ORDER BY clauses
    if (upperQuery.includes('ORDER BY')) {
      const orderByColumns = this.extractOrderByColumns(query);
      if (orderByColumns.length > 0) {
        suggestions.push({
          type: 'INDEX_RECOMMENDATION',
          priority: 'MEDIUM',
          suggestion: `CREATE INDEX IX_OrderBy ON [table](${orderByColumns.join(', ')})`,
          estimated_improvement: '40% performance gain',
          reason: 'Eliminate sorting overhead for ORDER BY'
        });
      }
    }

    return suggestions;
  }

  /**
   * Generates query rewriting suggestions
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @returns {array} Query rewriting suggestions
   */
  generateQueryRewritingSuggestions(query, _stats) {
    const suggestions = [];
    const upperQuery = query.toUpperCase();

    // EXISTS vs LEFT JOIN optimization
    if (upperQuery.includes('LEFT JOIN') && this.canUseExists(query)) {
      suggestions.push({
        type: 'QUERY_REWRITE',
        priority: 'MEDIUM',
        suggestion: 'Consider EXISTS instead of LEFT JOIN if you only need users with orders',
        estimated_improvement: '25% performance gain',
        reason: 'EXISTS can be more efficient than LEFT JOIN for existence checks'
      });
    }

    // IN vs EXISTS optimization
    if (upperQuery.includes(' IN (SELECT')) {
      suggestions.push({
        type: 'QUERY_REWRITE',
        priority: 'MEDIUM',
        suggestion: 'Consider replacing IN (SELECT...) with EXISTS for better performance',
        estimated_improvement: '30% performance gain',
        reason: 'EXISTS often performs better than IN with subqueries'
      });
    }

    // DISTINCT optimization
    if (upperQuery.includes('SELECT DISTINCT') && upperQuery.includes('JOIN')) {
      suggestions.push({
        type: 'QUERY_REWRITE',
        priority: 'LOW',
        suggestion: 'Review if DISTINCT is necessary with proper JOIN conditions',
        estimated_improvement: '15% performance gain',
        reason: 'Unnecessary DISTINCT adds overhead'
      });
    }

    return suggestions;
  }

  /**
   * Generates general performance tuning suggestions
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} Tuning suggestions
   */
  generateTuningSuggestions(query, stats, _planData) {
    const suggestions = [];

    // High execution count optimization
    if (stats.execution_count > 500 && stats.avg_duration > 100) {
      suggestions.push({
        type: 'PERFORMANCE_TUNING',
        priority: 'CRITICAL',
        suggestion: 'This frequently executed query needs immediate optimization',
        estimated_improvement: '50% average system performance gain',
        reason: `Query executed ${stats.execution_count} times with ${stats.avg_duration}ms average`
      });
    }

    // Memory optimization
    if (stats.avg_logical_reads > 50000) {
      suggestions.push({
        type: 'MEMORY_OPTIMIZATION',
        priority: 'HIGH',
        suggestion: 'Consider query optimization to reduce memory pressure',
        estimated_improvement: '35% memory usage reduction',
        reason: `High logical reads detected (${stats.avg_logical_reads})`
      });
    }

    // Parameterization suggestion
    if (this.hasLiterals(query)) {
      suggestions.push({
        type: 'PARAMETERIZATION',
        priority: 'MEDIUM',
        suggestion: 'Consider parameterizing literal values for better plan reuse',
        estimated_improvement: '20% compilation overhead reduction',
        reason: 'Hard-coded values prevent plan reuse'
      });
    }

    return suggestions;
  }

  /**
   * Calculates estimated impact of an index recommendation
   * @param {object} stats - Execution statistics
   * @param {string} type - Type of index (WHERE, JOIN, ORDER)
   * @returns {number} Impact percentage (0-100)
   */
  calculateIndexImpact(stats, type) {
    let baseImpact = 30; // Base improvement for any index

    // Factor in current performance metrics
    if (stats.avg_duration > this.config.thresholds.slowQueryMs) {
      baseImpact += 30;
    }

    if (stats.avg_logical_reads > this.config.thresholds.highIoReads) {
      baseImpact += 25;
    }

    if (stats.execution_count > 100) {
      baseImpact += 15; // High-frequency queries benefit more
    }

    // Type-specific adjustments
    switch (type) {
      case 'WHERE':
        baseImpact += 20; // WHERE clause indexes are very effective
        break;
      case 'JOIN':
        baseImpact += 15; // JOIN indexes are moderately effective
        break;
      case 'ORDER':
        baseImpact += 10; // ORDER BY indexes help but less critical
        break;
    }

    return Math.min(baseImpact, 95); // Cap at 95%
  }

  // ==================== HELPER METHODS ====================

  /**
   * Checks if query contains joins
   */
  containsJoins(query) {
    return /\b(INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|JOIN)\b/i.test(query);
  }

  /**
   * Checks if query contains aggregation
   */
  containsAggregation(query, _planData) {
    return /\b(COUNT|SUM|AVG|MIN|MAX|GROUP BY|HAVING)\b/i.test(query);
  }

  /**
   * Checks if query contains subqueries
   */
  containsSubqueries(query, _planData) {
    return /\(\s*SELECT\b/i.test(query);
  }

  /**
   * Counts number of subqueries
   */
  countSubqueries(query) {
    const matches = query.match(/\(\s*SELECT\b/gi);
    return matches ? matches.length : 0;
  }

  /**
   * Checks if query is a modification query
   */
  isModificationQuery(query) {
    return /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(query);
  }

  /**
   * Checks for table scans in execution plan
   */
  hasTableScans(query, _planData) {
    // This would analyze actual execution plan data
    // For now, we'll use heuristics
    if (!query || typeof query !== 'string') {
      return false;
    }
    return !query.toUpperCase().includes('WHERE') && query.toUpperCase().includes('SELECT');
  }

  /**
   * Checks for inefficient joins
   */
  hasInfficientJoins(_query, _planData) {
    // This would analyze execution plan for nested loop joins on large tables
    // For now, return false as placeholder
    return false;
  }

  /**
   * Checks if query contains large tables
   */
  containsLargeTables(_query) {
    // This would require table statistics
    // For now, assume any table could be large
    return true;
  }

  /**
   * Checks if ORDER BY has supporting index
   */
  hasOrderByIndex(_query) {
    // This would require index information
    // For now, assume no supporting index
    return false;
  }

  /**
   * Extracts columns from WHERE clauses
   */
  extractWhereColumns(query) {
    // Input validation and size limit to prevent ReDoS attacks
    if (!query || typeof query !== 'string') {
      return [];
    }

    // Limit query size to prevent ReDoS attacks
    if (query.length > 10000) {
      // Only log warning in production, suppress during testing
      if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        console.warn('Query too large for WHERE clause analysis, skipping');
      }
      return [];
    }

    const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+HAVING|$)/i);
    if (!whereMatch) return [];

    // Simple extraction - would need more sophisticated parsing for production
    const whereClause = whereMatch[1];
    const columns = [];

    // Extract column names using a safer approach without sanitization
    // Match column names that appear before comparison operators
    const patterns = [
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*>=/g, // >= operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*<=/g, // <= operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*!=/g, // != operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*<>/g, // <> operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g, // = operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*>/g, // > operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*</g, // < operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*!/g // ! operator (for NOT patterns)
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(whereClause)) !== null) {
        const columnName = match[1].trim();
        if (columnName && !columns.includes(columnName)) {
          columns.push(columnName);
        }
      }
    });

    return columns;
  }

  /**
   * Extracts columns from JOIN conditions
   */
  extractJoinColumns(query) {
    // Input validation and size limit to prevent ReDoS attacks
    if (!query || typeof query !== 'string') {
      return [];
    }

    // Limit query size to prevent ReDoS attacks
    if (query.length > 10000) {
      // Only log warning in production, suppress during testing
      if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        console.warn('Query too large for JOIN analysis, skipping');
      }
      return [];
    }

    const joinMatches = query.match(
      /JOIN\s+\w+\s+\w+\s+ON\s+(.+?)(?:\s+WHERE|\s+GROUP|\s+ORDER|$)/gi
    );
    const columns = [];

    if (joinMatches) {
      joinMatches.forEach(joinMatch => {
        const onClause = joinMatch.replace(/.*ON\s+/i, '');
        const columnMatches = onClause.match(
          /\b([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\b/g
        );
        if (columnMatches) {
          columns.push(...columnMatches);
        }
      });
    }

    return [...new Set(columns)]; // Remove duplicates
  }

  /**
   * Extracts columns from ORDER BY clause
   */
  extractOrderByColumns(query) {
    const orderByMatch = query.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|$)/i);
    if (!orderByMatch) return [];

    const orderByClause = orderByMatch[1];
    const columns = orderByClause
      .split(',')
      .map(col => col.trim().replace(/\s+(ASC|DESC)$/i, ''))
      .filter(col => col.length > 0);

    return columns;
  }

  /**
   * Checks if LEFT JOIN can be replaced with EXISTS
   */
  canUseExists(query) {
    // Simple heuristic: if LEFT JOIN is used just for existence check
    if (!query || typeof query !== 'string') {
      return false;
    }
    return (
      query.toUpperCase().includes('LEFT JOIN') &&
      !query.toUpperCase().includes('SELECT') &&
      query.toUpperCase().match(/\.\*/)
    );
  }

  /**
   * Checks if query has hard-coded literals
   */
  hasLiterals(query) {
    // Check for string literals and numeric literals
    return /'[^']*'/.test(query) || /\b\d+\b/.test(query);
  }

  /**
   * Extracts table access methods from execution plan
   */
  extractTableAccessMethods(_planData) {
    // This would parse actual execution plan XML/JSON
    // For now, return mock data structure
    return [];
  }

  /**
   * Extracts join algorithms from execution plan
   */
  extractJoinAlgorithms(_planData) {
    // This would parse actual execution plan data
    return [];
  }

  /**
   * Extracts operators from execution plan
   */
  extractOperators(_planData) {
    // This would parse execution plan operators
    return [];
  }

  /**
   * Gets priority sort order for suggestions
   */
  prioritySortOrder(priority) {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return order[priority] || 999;
  }

  /**
   * Analyzes index usage patterns and provides recommendations
   * @param {string} database - Database name to analyze
   * @returns {object} Index analysis and recommendations
   */
  async analyzeIndexUsage(database, { limit = 10, impactThreshold = 0 } = {}) {
    const pool = await acquirePool(this.connectionManager);

    const safeDb = sanitizeDbName(database);
    const dbPredicate = safeDb ? `DB_ID(N'${safeDb}')` : 'DB_ID()';
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 10));

    const result = await pool.request().query(`
      SELECT TOP (${safeLimit})
        OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
        mid.equality_columns,
        mid.inequality_columns,
        mid.included_columns,
        migs.user_seeks,
        migs.user_scans,
        migs.avg_user_impact,
        CONVERT(decimal(18,2),
          migs.avg_total_user_cost * migs.avg_user_impact
          * (migs.user_seeks + migs.user_scans)) AS impact_score
      FROM sys.dm_db_missing_index_group_stats migs
      INNER JOIN sys.dm_db_missing_index_groups mig
        ON migs.group_handle = mig.index_group_handle
      INNER JOIN sys.dm_db_missing_index_details mid
        ON mig.index_handle = mid.index_handle
      WHERE mid.database_id = ${dbPredicate}
      ORDER BY impact_score DESC
    `);

    const parseCols = csv =>
      csv
        ? csv
            .split(',')
            .map(c => c.trim().replaceAll(/^\[|\]$/g, ''))
            .filter(Boolean)
        : [];

    const recommendations = (result.recordset || [])
      .filter(r => (r.avg_user_impact ?? 0) >= impactThreshold)
      .map(r => {
        const keyColumns = [...parseCols(r.equality_columns), ...parseCols(r.inequality_columns)];
        const includedColumns = parseCols(r.included_columns);
        const includeClause = includedColumns.length
          ? ` INCLUDE (${includedColumns.join(', ')})`
          : '';
        return {
          type: 'missing_index',
          priority: indexPriority(r.avg_user_impact),
          table: r.table_name,
          columns: keyColumns,
          includedColumns,
          avgUserImpact: r.avg_user_impact,
          userSeeks: r.user_seeks,
          userScans: r.user_scans,
          impactScore: r.impact_score,
          suggestion: `CREATE INDEX IX_${r.table_name}_missing ON [${r.table_name}] (${keyColumns.join(
            ', '
          )})${includeClause}`
        };
      });

    // Only return what we actually computed. Missing-index recommendations come
    // from the DMVs above; unused/duplicate/fragmented-index analysis is not yet
    // implemented and is intentionally omitted rather than reported as empty
    // (which would read as "analyzed, none found").
    return {
      database: database || null,
      timestamp: new Date().toISOString(),
      recommendations
    };
  }

  /**
   * Provides aggregate optimization insights for a database: missing-index
   * summary plus a count of expensive queries, with a prioritized roadmap.
   * @param {string} database - Database name
   * @returns {object} Optimization insights
   */
  async getOptimizationInsights(database) {
    const pool = await acquirePool(this.connectionManager);

    const indexAnalysis = await this.analyzeIndexUsage(database, { limit: 100 });

    const safeDb = sanitizeDbName(database);
    const dbFilter = safeDb ? `WHERE qt.dbid = DB_ID(N'${safeDb}')` : '';
    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS expensive_query_count
      FROM sys.dm_exec_query_stats qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
      ${dbFilter ? `${dbFilter} AND` : 'WHERE'}
        qs.total_worker_time / qs.execution_count >= 1000000
    `);

    const missingIndexCount = indexAnalysis.recommendations.length;
    const highImpactIndexCount = indexAnalysis.recommendations.filter(
      r => r.priority === 'high'
    ).length;
    const expensiveQueryCount = countResult.recordset?.[0]?.expensive_query_count ?? 0;

    const roadmap = [];
    if (highImpactIndexCount > 0) {
      roadmap.push({
        priority: 'high',
        action: `Add ${highImpactIndexCount} high-impact missing index(es)`
      });
    }
    if (expensiveQueryCount > 0) {
      roadmap.push({
        priority: 'medium',
        action: `Review ${expensiveQueryCount} expensive query(ies) (>1s avg CPU)`
      });
    }
    if (roadmap.length === 0) {
      // These DMVs are populated from cache and reset on restart/recompile/
      // memory pressure, so an empty result is "nothing in cache", which is not
      // the same as "the database is healthy". Say so honestly.
      roadmap.push({
        priority: 'info',
        action:
          'No missing-index or expensive-query signals found in the DMV cache. ' +
          'This may indicate a healthy workload or simply a cold/recently-cleared cache.'
      });
    }

    return {
      database: database || null,
      timestamp: new Date().toISOString(),
      summary: { missingIndexCount, highImpactIndexCount, expensiveQueryCount },
      recommendations: indexAnalysis.recommendations.slice(0, 10),
      roadmap
    };
  }
}
