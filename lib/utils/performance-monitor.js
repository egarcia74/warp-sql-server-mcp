/**
 * Performance Monitoring System
 * Provides comprehensive performance metrics for query execution and connection pool management
 */
export class PerformanceMonitor {
  constructor(config = {}) {
    this.config = {
      // Whether to enable performance monitoring
      enabled: config.enabled ?? true,
      // Maximum number of metrics to keep in memory
      maxMetricsHistory: config.maxMetricsHistory || 1000,
      // Slow query threshold in milliseconds
      slowQueryThreshold: config.slowQueryThreshold || 5000,
      // Whether to track detailed connection pool metrics
      trackPoolMetrics: config.trackPoolMetrics ?? true,
      // Sampling rate for performance metrics (0.0 to 1.0)
      samplingRate: config.samplingRate || 1.0,
      ...config
    };

    this.metrics = {
      queries: [],
      connections: [],
      poolStats: {
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        pendingRequests: 0,
        errors: 0
      },
      aggregates: {
        totalQueries: 0,
        slowQueries: 0,
        avgQueryTime: 0,
        maxQueryTime: 0,
        minQueryTime: Number.MAX_SAFE_INTEGER,
        totalQueryTime: 0,
        errorRate: 0
      }
    };

    this.startTime = Date.now();
  }

  /**
   * Records the start of a query execution
   * @param {string} toolName - Name of the MCP tool
   * @param {string} query - SQL query (truncated for performance)
   * @param {object} context - Execution context
   * @returns {string} Query ID for tracking
   */
  startQuery(toolName, query, context = {}) {
    if (!this.config.enabled || !this.shouldSample()) {
      return null;
    }

    const queryId = this.generateQueryId();
    const truncatedQuery = query.length > 200 ? `${query.substring(0, 200)}...` : query;

    const queryMetric = {
      id: queryId,
      tool: toolName,
      query: truncatedQuery,
      database: context.database || 'default',
      startTime: Date.now(),
      startMemory: this.getMemoryUsage(),
      status: 'running'
    };

    this.metrics.queries.push(queryMetric);
    this.trimMetricsHistory();

    return queryId;
  }

  /**
   * Records the completion of a query execution
   * @param {string} queryId - Query ID from startQuery
   * @param {object} result - Query execution result
   * @param {Error} error - Error if query failed
   */
  endQuery(queryId, result = {}, error = null) {
    if (!this.config.enabled || !queryId) {
      return;
    }

    const queryMetric = this.metrics.queries.find(q => q.id === queryId);
    if (!queryMetric) {
      return;
    }

    const endTime = Date.now();
    const duration = endTime - queryMetric.startTime;
    const endMemory = this.getMemoryUsage();

    // Update query metric
    queryMetric.endTime = endTime;
    queryMetric.duration = duration;
    queryMetric.endMemory = endMemory;
    queryMetric.memoryDelta = endMemory - queryMetric.startMemory;
    queryMetric.status = error ? 'error' : 'completed';
    queryMetric.error = error ? error.message : null;
    queryMetric.rowsAffected = result?.rowsAffected || 0;
    queryMetric.rowCount = result?.recordset ? result.recordset.length : 0;
    queryMetric.streaming = result?.streaming || false;

    // Update aggregates
    this.updateAggregates(queryMetric);

    // Log slow queries
    if (duration > this.config.slowQueryThreshold) {
      this.logSlowQuery(queryMetric);
    }
  }

  /**
   * Records connection pool metrics
   * @param {object} poolStats - Current pool statistics
   */
  recordPoolMetrics(poolStats) {
    if (!this.config.enabled || !this.config.trackPoolMetrics) {
      return;
    }

    const timestamp = Date.now();

    // Update current pool stats
    this.metrics.poolStats = {
      ...poolStats,
      timestamp,
      uptime: timestamp - this.startTime
    };

    // Record historical connection data
    this.metrics.connections.push({
      timestamp,
      ...poolStats
    });

    this.trimConnectionHistory();
  }

  /**
   * Records connection events (connect, disconnect, error)
   * @param {string} event - Event type ('connect', 'disconnect', 'error', 'retry')
   * @param {object} details - Event details
   */
  recordConnectionEvent(event, details = {}) {
    if (!this.config.enabled) {
      return;
    }

    const connectionEvent = {
      id: this.generateEventId(),
      event,
      timestamp: Date.now(),
      ...details
    };

    this.metrics.connections.push(connectionEvent);
    this.trimConnectionHistory();

    // Update pool stats based on event
    switch (event) {
      case 'connect':
        this.metrics.poolStats.totalConnections++;
        this.metrics.poolStats.activeConnections++;
        break;
      case 'disconnect':
        this.metrics.poolStats.activeConnections--;
        break;
      case 'error':
        this.metrics.poolStats.errors++;
        break;
    }
  }

  /**
   * Gets current performance statistics
   * @returns {object} Performance statistics
   */
  getStats() {
    if (!this.config.enabled) {
      return { enabled: false };
    }

    const now = Date.now();
    const uptime = now - this.startTime;

    // Calculate recent performance (last 5 minutes)
    const recentThreshold = now - 5 * 60 * 1000;
    const recentQueries = this.metrics.queries.filter(
      q => q.startTime > recentThreshold && q.status === 'completed'
    );

    const recentStats = this.calculateQueryStats(recentQueries);

    return {
      enabled: true,
      uptime,
      overall: this.metrics.aggregates,
      recent: recentStats,
      pool: this.metrics.poolStats,
      monitoring: {
        totalQueriesTracked: this.metrics.queries.length,
        totalConnectionEvents: this.metrics.connections.length,
        samplingRate: this.config.samplingRate,
        slowQueryThreshold: this.config.slowQueryThreshold
      }
    };
  }

  /**
   * Gets detailed query performance breakdown
   * @param {number} limit - Maximum number of queries to return
   * @returns {object} Query performance details
   */
  getQueryStats(limit = 50) {
    if (!this.config.enabled) {
      return { enabled: false };
    }

    const completedQueries = this.metrics.queries
      .filter(q => q.status === 'completed' || q.status === 'error')
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);

    // Group by tool
    const byTool = {};
    completedQueries.forEach(query => {
      if (!byTool[query.tool]) {
        byTool[query.tool] = {
          count: 0,
          totalTime: 0,
          errors: 0,
          slowQueries: 0
        };
      }

      byTool[query.tool].count++;
      byTool[query.tool].totalTime += query.duration;

      if (query.status === 'error') {
        byTool[query.tool].errors++;
      }

      if (query.duration > this.config.slowQueryThreshold) {
        byTool[query.tool].slowQueries++;
      }
    });

    // Calculate averages
    Object.keys(byTool).forEach(tool => {
      const stats = byTool[tool];
      stats.avgTime = stats.totalTime / stats.count;
      stats.errorRate = (stats.errors / stats.count) * 100;
      stats.slowQueryRate = (stats.slowQueries / stats.count) * 100;
    });

    return {
      enabled: true,
      queries: completedQueries.map(q => ({
        tool: q.tool,
        duration: q.duration,
        status: q.status,
        rowCount: q.rowCount,
        streaming: q.streaming,
        timestamp: q.startTime
      })),
      byTool,
      slowQueries: completedQueries.filter(q => q.duration > this.config.slowQueryThreshold)
    };
  }

  /**
   * Gets connection pool performance metrics
   * @returns {object} Connection pool metrics
   */
  getPoolStats() {
    if (!this.config.enabled || !this.config.trackPoolMetrics) {
      return { enabled: false };
    }

    const now = Date.now();
    const recentThreshold = now - 10 * 60 * 1000; // Last 10 minutes

    const recentConnections = this.metrics.connections.filter(
      conn => conn.timestamp > recentThreshold
    );

    // Calculate connection event rates
    const connectEvents = recentConnections.filter(c => c.event === 'connect').length;
    const errorEvents = recentConnections.filter(c => c.event === 'error').length;
    const retryEvents = recentConnections.filter(c => c.event === 'retry').length;

    return {
      enabled: true,
      current: this.metrics.poolStats,
      recent: {
        connectionRate: connectEvents / 10, // per minute
        errorRate: errorEvents / 10, // per minute
        retryRate: retryEvents / 10, // per minute
        totalEvents: recentConnections.length
      },
      health: this.assessPoolHealth()
    };
  }

  /**
   * Assesses connection pool health
   * @returns {object} Health assessment
   */
  assessPoolHealth() {
    const stats = this.metrics.poolStats;
    const issues = [];
    let status = 'healthy';

    // Check for high error rate
    if (stats.errors > 10) {
      issues.push('High error count detected');
      status = 'warning';
    }

    // Check for connection exhaustion
    if (stats.activeConnections >= stats.totalConnections * 0.9) {
      issues.push('Connection pool near capacity');
      status = 'warning';
    }

    // Check for pending requests
    if (stats.pendingRequests > 5) {
      issues.push('High number of pending requests');
      if (status === 'healthy') status = 'warning';
    }

    // Critical issues
    if (stats.activeConnections === 0 && stats.totalConnections > 0) {
      issues.push('No active connections available');
      status = 'critical';
    }

    return {
      status,
      issues,
      score: this.calculateHealthScore(stats, issues)
    };
  }

  /**
   * Calculates a health score (0-100)
   * @param {object} stats - Pool statistics
   * @param {array} issues - Identified issues
   * @returns {number} Health score
   */
  calculateHealthScore(stats, issues) {
    let score = 100;

    // Deduct points for issues
    score -= issues.length * 20;

    // Deduct points for high utilization
    if (stats.totalConnections > 0) {
      const utilization = stats.activeConnections / stats.totalConnections;
      if (utilization > 0.8) score -= 10;
      if (utilization > 0.9) score -= 10;
    }

    // Deduct points for errors
    if (stats.errors > 0) {
      score -= Math.min(stats.errors * 2, 30);
    }

    return Math.max(0, score);
  }

  /**
   * Updates aggregate statistics
   * @param {object} queryMetric - Completed query metric
   */
  updateAggregates(queryMetric) {
    const agg = this.metrics.aggregates;

    agg.totalQueries++;

    if (queryMetric.status === 'error') {
      agg.errorRate = (agg.errorRate * (agg.totalQueries - 1) + 1) / agg.totalQueries;
    } else {
      agg.errorRate = (agg.errorRate * (agg.totalQueries - 1)) / agg.totalQueries;
    }

    if (queryMetric.duration) {
      agg.totalQueryTime += queryMetric.duration;
      agg.avgQueryTime = agg.totalQueryTime / agg.totalQueries;
      agg.maxQueryTime = Math.max(agg.maxQueryTime, queryMetric.duration);
      agg.minQueryTime = Math.min(agg.minQueryTime, queryMetric.duration);

      if (queryMetric.duration > this.config.slowQueryThreshold) {
        agg.slowQueries++;
      }
    }
  }

  /**
   * Calculates statistics for a set of queries
   * @param {array} queries - Array of query metrics
   * @returns {object} Calculated statistics
   */
  calculateQueryStats(queries) {
    if (queries.length === 0) {
      return {
        count: 0,
        avgDuration: 0,
        maxDuration: 0,
        minDuration: 0,
        errorRate: 0,
        slowQueryRate: 0
      };
    }

    const durations = queries.map(q => q.duration).filter(d => d != null);
    const errors = queries.filter(q => q.status === 'error').length;
    const slowQueries = queries.filter(q => q.duration > this.config.slowQueryThreshold).length;

    return {
      count: queries.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length || 0,
      maxDuration: Math.max(...durations) || 0,
      minDuration: Math.min(...durations) || 0,
      errorRate: (errors / queries.length) * 100,
      slowQueryRate: (slowQueries / queries.length) * 100
    };
  }

  /**
   * Logs a slow query for investigation
   * @param {object} queryMetric - Slow query metric
   */
  logSlowQuery(queryMetric) {
    console.warn(`Slow query detected: ${queryMetric.duration}ms`, {
      tool: queryMetric.tool,
      query: queryMetric.query,
      database: queryMetric.database,
      duration: queryMetric.duration,
      rowCount: queryMetric.rowCount
    });
  }

  /**
   * Determines if this operation should be sampled
   * @returns {boolean} Whether to sample
   */
  shouldSample() {
    return Math.random() < this.config.samplingRate;
  }

  /**
   * Generates a unique query ID
   * @returns {string} Unique query ID
   */
  generateQueryId() {
    return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique event ID
   * @returns {string} Unique event ID
   */
  generateEventId() {
    return `e_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets current memory usage
   * @returns {number} Memory usage in MB
   */
  getMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed / (1024 * 1024);
    }
    return 0;
  }

  /**
   * Trims metrics history to prevent memory leaks
   */
  trimMetricsHistory() {
    if (this.metrics.queries.length > this.config.maxMetricsHistory) {
      // Keep the most recent metrics and some slow queries for analysis
      const recentQueries = this.metrics.queries.slice(
        -Math.floor(this.config.maxMetricsHistory * 0.8)
      );
      const slowQueries = this.metrics.queries
        .filter(q => q.duration > this.config.slowQueryThreshold)
        .slice(-Math.floor(this.config.maxMetricsHistory * 0.2));

      this.metrics.queries = [...recentQueries, ...slowQueries]
        .sort((a, b) => a.startTime - b.startTime)
        .slice(-this.config.maxMetricsHistory);
    }
  }

  /**
   * Trims connection history to prevent memory leaks
   */
  trimConnectionHistory() {
    if (this.metrics.connections.length > this.config.maxMetricsHistory) {
      this.metrics.connections = this.metrics.connections.slice(-this.config.maxMetricsHistory);
    }
  }

  /**
   * Resets all performance metrics
   */
  reset() {
    this.metrics = {
      queries: [],
      connections: [],
      poolStats: {
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        pendingRequests: 0,
        errors: 0
      },
      aggregates: {
        totalQueries: 0,
        slowQueries: 0,
        avgQueryTime: 0,
        maxQueryTime: 0,
        minQueryTime: Number.MAX_SAFE_INTEGER,
        totalQueryTime: 0,
        errorRate: 0
      }
    };
    this.startTime = Date.now();
  }

  /**
   * Updates performance monitoring configuration
   * @param {object} newConfig - New configuration options
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Gets current configuration
   * @returns {object} Current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Generates a performance report
   * @returns {object} Comprehensive performance report
   */
  generateReport() {
    const stats = this.getStats();
    const queryStats = this.getQueryStats();
    const poolStats = this.getPoolStats();

    return {
      timestamp: Date.now(),
      uptime: stats.uptime,
      summary: {
        totalQueries: stats.overall.totalQueries,
        avgQueryTime: Math.round(stats.overall.avgQueryTime),
        slowQueries: stats.overall.slowQueries,
        errorRate: Math.round(stats.overall.errorRate * 100) / 100,
        poolHealth: poolStats.health?.status || 'unknown'
      },
      detailed: {
        overall: stats.overall,
        recent: stats.recent,
        pool: poolStats,
        queries: queryStats
      },
      recommendations: this.generateRecommendations(stats, queryStats, poolStats)
    };
  }

  /**
   * Generates performance recommendations
   * @param {object} stats - Overall stats
   * @param {object} queryStats - Query statistics
   * @param {object} poolStats - Pool statistics
   * @returns {array} Array of recommendations
   */
  generateRecommendations(stats, queryStats, poolStats) {
    const recommendations = [];

    // Query performance recommendations
    if (stats.overall.avgQueryTime > 1000) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Average query time is high. Consider query optimization or indexing.',
        metric: 'avgQueryTime',
        value: stats.overall.avgQueryTime
      });
    }

    if (stats.overall.errorRate > 5) {
      recommendations.push({
        type: 'reliability',
        priority: 'critical',
        message: 'High error rate detected. Check query validation and database connectivity.',
        metric: 'errorRate',
        value: stats.overall.errorRate
      });
    }

    // Pool recommendations
    if (poolStats.enabled && poolStats.health?.status === 'warning') {
      recommendations.push({
        type: 'infrastructure',
        priority: 'medium',
        message: 'Connection pool health issues detected.',
        issues: poolStats.health.issues
      });
    }

    // Tool-specific recommendations
    if (queryStats.enabled && queryStats.byTool) {
      Object.entries(queryStats.byTool).forEach(([tool, toolStats]) => {
        if (toolStats.avgTime > 2000) {
          recommendations.push({
            type: 'optimization',
            priority: 'medium',
            message: `Tool '${tool}' has high average execution time.`,
            metric: 'toolAvgTime',
            tool,
            value: toolStats.avgTime
          });
        }
      });
    }

    return recommendations;
  }
}
