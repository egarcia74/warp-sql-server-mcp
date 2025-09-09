/**
 * Query Bottleneck Detection System
 * Identifies and categorizes performance bottlenecks in SQL queries
 */
export class BottleneckDetector {
  constructor(connectionManager, config = {}) {
    this.connectionManager = connectionManager;
    this.config = {
      // Bottleneck thresholds
      thresholds: {
        // Duration thresholds (milliseconds)
        slowQuery: config.slowQuery || 5000,
        mediumQuery: config.mediumQuery || 1000,

        // I/O thresholds
        highLogicalReads: config.highLogicalReads || 10000,
        mediumLogicalReads: config.mediumLogicalReads || 5000,
        highPhysicalReads: config.highPhysicalReads || 1000,

        // CPU thresholds (milliseconds)
        highCpu: config.highCpu || 3000,
        mediumCpu: config.mediumCpu || 1000,

        // Wait time thresholds (milliseconds)
        highWaitTime: config.highWaitTime || 2000,
        mediumWaitTime: config.mediumWaitTime || 500,

        // Execution frequency thresholds
        highFrequency: config.highFrequency || 1000,
        mediumFrequency: config.mediumFrequency || 100,

        ...config.thresholds
      },

      // Wait type categorization
      waitTypes: {
        io: [
          'PAGEIOLATCH_SH',
          'PAGEIOLATCH_EX',
          'PAGEIOLATCH_UP',
          'PAGEIOLATCH_DT',
          'PAGEIOLATCH_KP',
          'PAGEIOLATCH_NL',
          'WRITELOG',
          'LOGMGR_QUEUE',
          'ASYNC_IO_COMPLETION',
          'IO_COMPLETION',
          'BACKUPIO'
        ],
        cpu: ['SOS_SCHEDULER_YIELD', 'THREADPOOL', 'RESOURCE_SEMAPHORE'],
        memory: [
          'RESOURCE_SEMAPHORE',
          'RESOURCE_SEMAPHORE_QUERY_COMPILE',
          'MEMORY_ALLOCATION_EXT',
          'MEMORYCLERK_SQLGENERAL'
        ],
        locking: [
          'LCK_M_S',
          'LCK_M_X',
          'LCK_M_IS',
          'LCK_M_IX',
          'LCK_M_U',
          'LCK_M_SIU',
          'LCK_M_SIX',
          'LCK_M_UIX',
          'LCK_M_BU',
          'LCK_M_SCH_S',
          'LCK_M_SCH_M'
        ],
        network: ['ASYNC_NETWORK_IO', 'NETWORK_IO'],
        ...config.waitTypes
      }
    };
  }

  /**
   * Detects and categorizes bottlenecks for a single query
   * @param {object} queryData - Query execution data
   * @returns {object} Bottleneck analysis
   */
  analyzeQuery(queryData) {
    const {
      query_hash,
      query_text,
      database_name,
      avg_duration_ms,
      total_executions,
      avg_cpu_time_ms,
      avg_logical_reads,
      avg_physical_reads,
      avg_writes,
      avg_wait_time_ms,
      wait_stats = []
    } = queryData;

    const bottleneck = {
      query_hash,
      query_text: this.truncateQuery(query_text),
      database_name,
      avg_duration_ms,
      total_executions,
      avg_cpu_time_ms,
      avg_logical_reads,
      avg_physical_reads,
      avg_writes,
      avg_wait_time_ms,
      wait_stats,
      bottleneck_type: this.identifyBottleneckType(queryData),
      severity: this.calculateSeverity(queryData),
      impact_score: this.calculateImpactScore(queryData),
      recommendations: this.generateRecommendations(queryData)
    };

    return bottleneck;
  }

  /**
   * Identifies the primary bottleneck type
   * @param {object} queryData - Query execution data
   * @returns {string} Bottleneck type
   */
  identifyBottleneckType(queryData) {
    const {
      avg_duration_ms,
      avg_cpu_time_ms,
      avg_logical_reads,
      avg_physical_reads,
      avg_wait_time_ms,
      wait_stats = []
    } = queryData;

    // Analyze wait statistics to identify primary bottleneck
    if (wait_stats.length > 0) {
      const primaryWaitType = this.getPrimaryWaitType(wait_stats);

      if (this.isWaitType(primaryWaitType, 'io')) {
        return avg_physical_reads > this.config.thresholds.highPhysicalReads
          ? 'IO_INTENSIVE'
          : 'IO_MODERATE';
      }

      if (this.isWaitType(primaryWaitType, 'cpu')) {
        return 'CPU_INTENSIVE';
      }

      if (this.isWaitType(primaryWaitType, 'memory')) {
        return 'MEMORY_PRESSURE';
      }

      if (this.isWaitType(primaryWaitType, 'locking')) {
        return 'BLOCKING_LOCKS';
      }

      if (this.isWaitType(primaryWaitType, 'network')) {
        return 'NETWORK_BOTTLENECK';
      }
    }

    // Fallback to metric-based analysis
    const cpuRatio = avg_cpu_time_ms / avg_duration_ms;
    const waitRatio = avg_wait_time_ms / avg_duration_ms;

    if (avg_physical_reads > this.config.thresholds.highPhysicalReads) {
      return 'IO_INTENSIVE';
    }

    if (cpuRatio > 0.7) {
      return 'CPU_INTENSIVE';
    }

    if (waitRatio > 0.5) {
      return 'WAIT_INTENSIVE';
    }

    if (avg_logical_reads > this.config.thresholds.highLogicalReads) {
      return 'MEMORY_INTENSIVE';
    }

    return 'GENERAL_SLOW';
  }

  /**
   * Calculates bottleneck severity
   * @param {object} queryData - Query execution data
   * @returns {string} Severity level (LOW, MEDIUM, HIGH, CRITICAL)
   */
  calculateSeverity(queryData) {
    const {
      avg_duration_ms,
      total_executions,
      avg_cpu_time_ms,
      avg_logical_reads,
      avg_wait_time_ms
    } = queryData;

    let severityScore = 0;

    // Duration impact
    if (avg_duration_ms > this.config.thresholds.slowQuery) {
      severityScore += 30;
    } else if (avg_duration_ms > this.config.thresholds.mediumQuery) {
      severityScore += 15;
    }

    // Frequency impact
    if (total_executions > this.config.thresholds.highFrequency) {
      severityScore += 25; // High frequency makes issues more critical
    } else if (total_executions > this.config.thresholds.mediumFrequency) {
      severityScore += 10;
    }

    // Resource usage impact
    if (avg_cpu_time_ms > this.config.thresholds.highCpu) {
      severityScore += 20;
    }

    if (avg_logical_reads > this.config.thresholds.highLogicalReads) {
      severityScore += 15;
    }

    if (avg_wait_time_ms > this.config.thresholds.highWaitTime) {
      severityScore += 10;
    }

    // Determine severity level
    if (severityScore >= 70) {
      return 'CRITICAL';
    } else if (severityScore >= 50) {
      return 'HIGH';
    } else if (severityScore >= 25) {
      return 'MEDIUM';
    } else {
      return 'LOW';
    }
  }

  /**
   * Calculates impact score (0-100)
   * @param {object} queryData - Query execution data
   * @returns {number} Impact score
   */
  calculateImpactScore(queryData) {
    const { avg_duration_ms, total_executions, avg_cpu_time_ms, avg_logical_reads } = queryData;

    // Calculate total impact based on duration, frequency, and resource usage
    const durationImpact = Math.min((avg_duration_ms / this.config.thresholds.slowQuery) * 40, 40);
    const frequencyImpact = Math.min(
      (total_executions / this.config.thresholds.highFrequency) * 30,
      30
    );
    const resourceImpact = Math.min(
      (avg_cpu_time_ms / this.config.thresholds.highCpu +
        avg_logical_reads / this.config.thresholds.highLogicalReads) *
        15,
      30
    );

    return Math.min(Math.round(durationImpact + frequencyImpact + resourceImpact), 100);
  }

  /**
   * Generates specific recommendations for the bottleneck
   * @param {object} queryData - Query execution data
   * @returns {array} List of recommendations
   */
  generateRecommendations(queryData) {
    const recommendations = [];
    const bottleneckType = this.identifyBottleneckType(queryData);

    switch (bottleneckType) {
      case 'IO_INTENSIVE':
        recommendations.push(
          'Consider adding indexes on frequently accessed columns',
          'Review query to reduce logical reads',
          'Consider query optimization or table partitioning',
          'Analyze WHERE clauses for missing indexes'
        );
        break;

      case 'CPU_INTENSIVE':
        recommendations.push(
          'Review query logic for optimization opportunities',
          'Consider rewriting complex expressions',
          'Analyze JOIN conditions and predicates',
          'Consider breaking down complex queries'
        );
        break;

      case 'MEMORY_PRESSURE':
        recommendations.push(
          'Optimize memory usage by reducing result set size',
          'Consider pagination for large result sets',
          'Review memory-intensive operations like sorts and hashes',
          'Analyze temp table usage and optimize'
        );
        break;

      case 'BLOCKING_LOCKS':
        recommendations.push(
          'Review transaction scope and duration',
          'Consider using appropriate isolation levels',
          'Optimize query order to reduce lock conflicts',
          'Analyze deadlock patterns and resolve'
        );
        break;

      case 'NETWORK_BOTTLENECK':
        recommendations.push(
          'Reduce result set size to minimize network traffic',
          'Consider data compression options',
          'Optimize application data access patterns',
          'Review network infrastructure capacity'
        );
        break;

      default:
        recommendations.push(
          'Perform comprehensive query performance analysis',
          'Review execution plan for optimization opportunities',
          'Consider indexing strategies based on query patterns',
          'Analyze table and index statistics'
        );
        break;
    }

    // Add frequency-based recommendations
    if (queryData.total_executions > this.config.thresholds.highFrequency) {
      recommendations.push(
        'High-frequency query - prioritize optimization efforts',
        'Consider caching strategies for frequently accessed data'
      );
    }

    return recommendations;
  }

  /**
   * Gets the primary wait type from wait statistics
   * @param {array} waitStats - Array of wait statistics
   * @returns {string} Primary wait type
   */
  getPrimaryWaitType(waitStats) {
    if (!waitStats || waitStats.length === 0) {
      return null;
    }

    // Sort by wait time descending and return the highest
    const sortedWaits = waitStats.sort((a, b) => b.wait_time_ms - a.wait_time_ms);
    return sortedWaits[0].wait_type;
  }

  /**
   * Checks if a wait type belongs to a specific category
   * @param {string} waitType - Wait type to check
   * @param {string} category - Category to check against
   * @returns {boolean} True if wait type belongs to category
   */
  isWaitType(waitType, category) {
    if (!waitType || !this.config.waitTypes[category]) {
      return false;
    }
    return this.config.waitTypes[category].includes(waitType);
  }

  /**
   * Truncates query text for display
   * @param {string} query - Full query text
   * @param {number} maxLength - Maximum length (default: 200)
   * @returns {string} Truncated query
   */
  truncateQuery(query, maxLength = 200) {
    if (!query || query.length <= maxLength) {
      return query;
    }
    return query.substring(0, maxLength) + '...';
  }

  /**
   * Filters bottlenecks by severity level
   * @param {array} bottlenecks - Array of bottleneck objects
   * @param {string} severityFilter - Severity level to filter by
   * @returns {array} Filtered bottlenecks
   */
  filterBySeverity(bottlenecks, severityFilter) {
    if (!severityFilter || severityFilter === 'ALL') {
      return bottlenecks;
    }

    const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (!validSeverities.includes(severityFilter.toUpperCase())) {
      throw new Error(
        `Invalid severity level: ${severityFilter}. Must be one of: ${validSeverities.join(', ')}`
      );
    }

    return bottlenecks.filter(b => b.severity === severityFilter.toUpperCase());
  }

  /**
   * Sorts bottlenecks by impact score
   * @param {array} bottlenecks - Array of bottleneck objects
   * @param {string} order - Sort order ('desc' or 'asc')
   * @returns {array} Sorted bottlenecks
   */
  sortByImpact(bottlenecks, order = 'desc') {
    return bottlenecks.sort((a, b) => {
      return order === 'desc' ? b.impact_score - a.impact_score : a.impact_score - b.impact_score;
    });
  }

  /**
   * Groups bottlenecks by type
   * @param {array} bottlenecks - Array of bottleneck objects
   * @returns {object} Grouped bottlenecks
   */
  groupByType(bottlenecks) {
    const grouped = {};

    bottlenecks.forEach(bottleneck => {
      const type = bottleneck.bottleneck_type;
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(bottleneck);
    });

    return grouped;
  }

  /**
   * Generates a summary report of bottlenecks
   * @param {array} bottlenecks - Array of bottleneck objects
   * @returns {object} Summary report
   */
  generateSummary(bottlenecks) {
    const total = bottlenecks.length;
    const severityCounts = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0
    };

    const typeCounts = {};
    let totalImpactScore = 0;

    bottlenecks.forEach(bottleneck => {
      severityCounts[bottleneck.severity]++;

      const type = bottleneck.bottleneck_type;
      typeCounts[type] = (typeCounts[type] || 0) + 1;

      totalImpactScore += bottleneck.impact_score;
    });

    const avgImpactScore = total > 0 ? Math.round(totalImpactScore / total) : 0;

    return {
      total_bottlenecks: total,
      avg_impact_score: avgImpactScore,
      severity_breakdown: severityCounts,
      type_breakdown: typeCounts,
      top_recommendations: this.getTopRecommendations(bottlenecks)
    };
  }

  /**
   * Gets top recommendations across all bottlenecks
   * @param {array} bottlenecks - Array of bottleneck objects
   * @returns {array} Top recommendations
   */
  getTopRecommendations(bottlenecks) {
    const recommendationCounts = {};

    // Count recommendation frequency
    bottlenecks.forEach(bottleneck => {
      bottleneck.recommendations.forEach(recommendation => {
        recommendationCounts[recommendation] = (recommendationCounts[recommendation] || 0) + 1;
      });
    });

    // Sort by frequency and return top 5
    return Object.entries(recommendationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([recommendation, count]) => ({
        recommendation,
        frequency: count,
        percentage: Math.round((count / bottlenecks.length) * 100)
      }));
  }

  /**
   * Detects bottlenecks across multiple queries in a database
   * @param {string} database - Database name to analyze
   * @returns {object} Comprehensive bottleneck analysis
   */
  async detectBottlenecks(query) {
    const pool = this.connectionManager.getPool();
    if (!pool) {
      throw new Error('Not connected to any server');
    }

    if (!query) {
      throw new Error('Query is required for detectBottlenecks');
    }

    // Placeholder for actual implementation
    return Promise.resolve([]);
  }
}
