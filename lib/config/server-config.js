/**
 * Server Configuration Manager
 *
 * Centralizes all configuration management and environment variable handling
 * Provides a clean interface for accessing server settings
 */

export class ServerConfig {
  constructor() {
    // Load all configuration from environment variables with defaults
    this._loadConfiguration();
  }

  /**
   * Reload configuration from environment variables (useful for tests)
   */
  reload() {
    this._loadConfiguration();
  }

  /**
   * Load configuration from environment variables
   * @private
   */
  _loadConfiguration() {
    // Debug mode
    this.debugMode = process.env.SQL_SERVER_DEBUG === 'true';

    // Timeouts and connection settings
    this.connectionTimeout = parseInt(process.env.SQL_SERVER_CONNECT_TIMEOUT_MS || '10000'); // 10s
    this.requestTimeout = parseInt(process.env.SQL_SERVER_REQUEST_TIMEOUT_MS || '30000'); // 30s
    this.maxRetries = parseInt(process.env.SQL_SERVER_MAX_RETRIES || '3');
    this.retryDelay = parseInt(process.env.SQL_SERVER_RETRY_DELAY_MS || '1000'); // 1s

    // Safety configuration with secure defaults
    this.readOnlyMode = process.env.SQL_SERVER_READ_ONLY !== 'false'; // Default: true
    this.allowDestructiveOperations =
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS === 'true'; // Default: false
    this.allowSchemaChanges = process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES === 'true'; // Default: false

    // Performance monitoring settings
    this.performanceMonitoring = {
      enabled: process.env.ENABLE_PERFORMANCE_MONITORING !== 'false', // Default: true
      maxMetricsHistory: parseInt(process.env.MAX_METRICS_HISTORY || '1000'),
      slowQueryThreshold: parseInt(process.env.SLOW_QUERY_THRESHOLD || '5000'),
      trackPoolMetrics: process.env.TRACK_POOL_METRICS !== 'false', // Default: true
      samplingRate: parseFloat(process.env.PERFORMANCE_SAMPLING_RATE || '1.0')
    };

    // Streaming configuration
    this.streaming = {
      enabled: process.env.ENABLE_STREAMING !== 'false', // Default: true
      batchSize: parseInt(process.env.STREAMING_BATCH_SIZE || '1000'),
      maxMemoryMB: parseInt(process.env.STREAMING_MAX_MEMORY_MB || '100'),
      maxResponseSize: parseInt(process.env.STREAMING_MAX_RESPONSE_SIZE || '10485760') // 10MB
    };

    // Logging configuration
    this.logging = {
      logLevel: process.env.SQL_SERVER_LOG_LEVEL || 'info',
      securityAudit: process.env.ENABLE_SECURITY_AUDIT === 'true', // Default: false
      responseFormat: process.env.SQL_SERVER_RESPONSE_FORMAT || 'json'
    };

    // SQL patterns for security validation
    this.securityPatterns = {
      destructive: [
        /^\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i,
        /^\s*EXEC(UTE)?\s+/i,
        /^\s*CALL\s+/i,
        /;\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i // Multi-statement
      ],
      schemaChanges: [
        /^\s*(CREATE|DROP|ALTER)\s+/i,
        /^\s*(GRANT|REVOKE)\s+/i,
        /;\s*(CREATE|DROP|ALTER|GRANT|REVOKE)\s+/i // Multi-statement
      ],
      readOnly: [
        /^\s*SELECT\s+/i,
        /^\s*SHOW\s+/i,
        /^\s*DESCRIBE\s+/i,
        /^\s*DESC\s+/i,
        /^\s*EXPLAIN\s+/i,
        /^\s*WITH\s+[\s\S]*?\bSELECT\s+/i // CTE queries - improved to handle multi-line
      ]
    };
  }

  /**
   * Get database connection configuration
   * @returns {Object} Connection configuration object
   */
  getConnectionConfig() {
    return {
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.requestTimeout,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    };
  }

  /**
   * Get security configuration
   * @returns {Object} Security configuration object
   */
  getSecurityConfig() {
    return {
      readOnlyMode: this.readOnlyMode,
      allowDestructiveOperations: this.allowDestructiveOperations,
      allowSchemaChanges: this.allowSchemaChanges,
      patterns: this.securityPatterns
    };
  }

  /**
   * Get performance monitoring configuration
   * @returns {Object} Performance monitoring configuration
   */
  getPerformanceConfig() {
    return { ...this.performanceMonitoring };
  }

  /**
   * Check if debug mode is enabled
   * @returns {boolean} Debug mode status
   */
  isDebugMode() {
    return this.debugMode;
  }

  /**
   * Get a summary of current configuration (for logging/debugging)
   * @returns {Object} Configuration summary
   */
  getConfigSummary() {
    return {
      debugMode: this.debugMode,
      readOnlyMode: this.readOnlyMode,
      allowDestructiveOperations: this.allowDestructiveOperations,
      allowSchemaChanges: this.allowSchemaChanges,
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.requestTimeout,
      maxRetries: this.maxRetries,
      performanceMonitoring: this.performanceMonitoring.enabled
    };
  }

  /**
   * Validate the current configuration
   * @returns {Object} Validation result with warnings and errors
   */
  validate() {
    const warnings = [];
    const errors = [];

    // Check for potentially unsafe configurations
    if (!this.readOnlyMode && this.allowDestructiveOperations) {
      warnings.push('Destructive operations are enabled - use caution in production');
    }

    if (!this.readOnlyMode && this.allowSchemaChanges) {
      warnings.push('Schema changes are enabled - use caution in production');
    }

    // Check for invalid timeout values
    if (this.connectionTimeout <= 0) {
      errors.push('Connection timeout must be greater than 0');
    }

    if (this.requestTimeout <= 0) {
      errors.push('Request timeout must be greater than 0');
    }

    if (this.maxRetries < 1) {
      errors.push('Max retries must be at least 1');
    }

    // Check performance monitoring settings
    if (
      this.performanceMonitoring.samplingRate < 0 ||
      this.performanceMonitoring.samplingRate > 1
    ) {
      errors.push('Performance sampling rate must be between 0 and 1');
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }

  /**
   * Redact sensitive data for logging
   * @private
   * @param {string} value - Value to redact
   * @param {boolean} isPassword - Whether this is a password (full mask) or other credential (partial mask)
   * @returns {string} Redacted value
   */
  _redactSensitive(value, isPassword = false) {
    if (!value || value === '') return '<not set>';

    // Passwords get FULL masking - no pattern disclosure
    if (isPassword) {
      return '***********'; // Fixed length to avoid revealing password length
    }

    // Other credentials (usernames, etc.) get partial masking for config verification
    if (value.length <= 4) return '***';
    return value.substring(0, 2) + '*'.repeat(Math.min(value.length - 4, 8)) + value.slice(-2);
  }

  /**
   * Determine if we're in a development-like environment (matches ConnectionManager logic)
   * @private
   * @returns {boolean} True if environment appears to be development
   */
  _isLikelyDevEnvironment() {
    const host = process.env.SQL_SERVER_HOST || 'localhost';
    const nodeEnv = process.env.NODE_ENV;

    return (
      nodeEnv === 'development' ||
      nodeEnv === 'test' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.local') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    );
  }

  /**
   * Get connection configuration summary with redacted sensitive data
   * @returns {Object} Connection configuration for logging
   */
  getConnectionSummary() {
    const host = process.env.SQL_SERVER_HOST || 'localhost';
    const port = process.env.SQL_SERVER_PORT || '1433';
    const database = process.env.SQL_SERVER_DATABASE || 'master';
    const user = process.env.SQL_SERVER_USER;
    const password = process.env.SQL_SERVER_PASSWORD;
    const domain = process.env.SQL_SERVER_DOMAIN;
    const encrypt = process.env.SQL_SERVER_ENCRYPT !== 'false';
    const isDevEnv = this._isLikelyDevEnvironment();

    // Match ConnectionManager's context-aware SSL logic
    let trustCert;
    let trustCertSource;
    if (process.env.SQL_SERVER_TRUST_CERT === 'true') {
      trustCert = true;
      trustCertSource = 'explicit-true';
    } else if (process.env.SQL_SERVER_TRUST_CERT === 'false') {
      trustCert = false;
      trustCertSource = 'explicit-false';
    } else {
      trustCert = isDevEnv;
      trustCertSource = isDevEnv ? 'auto-dev' : 'auto-prod';
    }

    // Determine authentication type
    let authType = 'SQL Server Authentication';
    if (!user && !password) {
      authType = 'Windows Authentication';
    }

    return {
      server: `${host}:${port}`,
      database,
      authType,
      user: user || '<Windows Auth>', // Username: shown in cleartext for config verification
      password: this._redactSensitive(password, true), // Password: FULL masking for security
      domain: domain || '<not set>',
      encrypt,
      trustCert,
      trustCertSource, // How the trustCert value was determined
      isDevEnvironment: isDevEnv, // Whether environment was detected as development
      poolMax: parseInt(process.env.SQL_SERVER_POOL_MAX || '10'),
      poolMin: parseInt(process.env.SQL_SERVER_POOL_MIN || '0')
    };
  }

  /**
   * Log configuration summary for MCP servers (stdout compatible)
   */
  logMcpConfiguration() {
    if (process.env.NODE_ENV === 'test') return;

    const connectionSummary = this.getConnectionSummary();

    // Simple, clean output that will appear in MCP logs
    const lines = [
      '=== SQL Server MCP Configuration ===',
      `Server: ${connectionSummary.server}`,
      `Database: ${connectionSummary.database}`,
      `Auth: ${connectionSummary.authType}`,
      `Encrypt: ${connectionSummary.encrypt}`,
      `Security: Read-Only=${this.readOnlyMode}, DML=${this.allowDestructiveOperations}, DDL=${this.allowSchemaChanges}`,
      `Performance: ${this.performanceMonitoring.enabled ? 'Enabled' : 'Disabled'}`,
      `Logging: ${this.logging.logLevel}${this.logging.securityAudit ? ' +Security' : ''}`,
      '===================================='
    ];

    lines.forEach(line => console.log(line));
  }

  /**
   * Log current configuration (useful for startup)
   * @param {Object} connectionManager - Optional connection manager to extract SSL info from
   * @param {Object} logger - Optional logger instance to use instead of console.error
   */
  logConfiguration(connectionManager = null, logger = null) {
    if (process.env.NODE_ENV === 'test') return;

    const connectionSummary = this.getConnectionSummary();

    // Build configuration as single string to prevent line-by-line logging issues
    const configLines = [];
    configLines.push('=== SQL Server MCP Configuration ===');
    configLines.push('🌐 Connection Settings:');
    configLines.push(`    Server: ${connectionSummary.server}`);
    configLines.push(`    Database: ${connectionSummary.database}`);
    configLines.push(`    Auth Type: ${connectionSummary.authType}`);
    configLines.push(`    User: ${connectionSummary.user}`);
    configLines.push('    Password: ***********');
    if (connectionSummary.authType === 'Windows Authentication') {
      configLines.push(`    Domain: ${connectionSummary.domain}`);
    }
    configLines.push(`    Encrypt: ${connectionSummary.encrypt}`);

    // Show SSL certificate trust with context information
    let trustCertDisplay = `${connectionSummary.trustCert}`;
    switch (connectionSummary.trustCertSource) {
      case 'explicit-true':
        trustCertDisplay += ' (explicitly enabled)';
        break;
      case 'explicit-false':
        trustCertDisplay += ' (explicitly disabled for security)';
        break;
      case 'auto-dev':
        trustCertDisplay += ' (auto-enabled for development environment)';
        break;
      case 'auto-prod':
        trustCertDisplay += ' (auto-disabled for production security)';
        break;
    }
    configLines.push(`    Trust Cert: ${trustCertDisplay}`);
    configLines.push(
      `    Environment: ${connectionSummary.isDevEnvironment ? 'Development' : 'Production'} (auto-detected)`
    );
    configLines.push(
      `    Pool: ${connectionSummary.poolMin}-${connectionSummary.poolMax} connections`
    );

    // Show SSL connection information if encryption is enabled and we have a connection
    if (connectionSummary.encrypt && connectionManager) {
      const health = connectionManager.getConnectionHealth();
      if (health.ssl) {
        configLines.push('');
        configLines.push('🔐 SSL Connection Information:');
        configLines.push(`    Status: ${health.ssl.connection_status}`);
        configLines.push(`    Protocol: ${health.ssl.protocol}`);
        configLines.push(`    Server: ${health.ssl.server}`);
        configLines.push(`    Encryption: ${health.ssl.encrypt ? 'Enabled' : 'Disabled'}`);
        configLines.push(
          `    Trust Server Certificate: ${health.ssl.trust_server_certificate ? 'Yes' : 'No'}`
        );
        if (health.ssl.note) {
          configLines.push(`    Note: ${health.ssl.note}`);
        }
      }
    }

    configLines.push('');
    configLines.push('🔒 Security & Operation Settings:');
    configLines.push(`    Debug Mode: ${this.debugMode}`);
    configLines.push(`    Read-Only Mode: ${this.readOnlyMode ? '🔒' : '🔓'} ${this.readOnlyMode}`);
    configLines.push(
      `    Allow Destructive Operations: ${this.allowDestructiveOperations ? '⚠️' : '✅'} ${this.allowDestructiveOperations}`
    );
    configLines.push(
      `    Allow Schema Changes: ${this.allowSchemaChanges ? '⚠️' : '✅'} ${this.allowSchemaChanges}`
    );
    configLines.push(`    Connection Timeout: ${this.connectionTimeout}ms`);
    configLines.push(`    Request Timeout: ${this.requestTimeout}ms`);
    configLines.push(`    Max Retries: ${this.maxRetries}`);
    configLines.push('');
    configLines.push('⚡ Performance Monitoring:');
    configLines.push(`    Enabled: ${this.performanceMonitoring.enabled}`);
    if (this.performanceMonitoring.enabled) {
      configLines.push(`    Max History: ${this.performanceMonitoring.maxMetricsHistory} records`);
      configLines.push(
        `    Slow Query Threshold: ${this.performanceMonitoring.slowQueryThreshold}ms`
      );
      configLines.push(`    Track Pool Metrics: ${this.performanceMonitoring.trackPoolMetrics}`);
      configLines.push(`    Sampling Rate: ${this.performanceMonitoring.samplingRate * 100}%`);
    }
    configLines.push('');
    configLines.push('📊 Streaming Configuration:');
    configLines.push(`    Enabled: ${this.streaming.enabled}`);
    if (this.streaming.enabled) {
      configLines.push(`    Batch Size: ${this.streaming.batchSize} rows`);
      configLines.push(`    Memory Limit: ${this.streaming.maxMemoryMB}MB`);
      configLines.push(
        `    Response Size Limit: ${Math.round(this.streaming.maxResponseSize / 1048576)}MB`
      );
    }
    configLines.push('');
    configLines.push('📝 Logging & Output:');
    configLines.push(`    Log Level: ${this.logging.logLevel}`);
    configLines.push(`    Security Audit: ${this.logging.securityAudit}`);
    configLines.push(`    Response Format: ${this.logging.responseFormat}`);
    configLines.push('====================================');

    // Add validation warnings/errors
    const validation = this.validate();
    if (validation.warnings.length > 0) {
      configLines.push('⚠️  Configuration Warnings:');
      validation.warnings.forEach(warning => configLines.push(`  ⚠️  ${warning}`));
    }
    if (validation.errors.length > 0) {
      configLines.push('❌ Configuration Errors:');
      validation.errors.forEach(error => configLines.push(`  ❌ ${error}`));
    }

    const configMessage = configLines.join('\n');

    // Use logger if provided, otherwise fall back to console.log (stdout)
    if (logger && typeof logger.info === 'function') {
      // For MCP servers, use a single info log to ensure it appears in Warp logs
      logger.info('SQL Server MCP Configuration', {
        configuration: configMessage,
        summary: {
          server: connectionSummary.server,
          database: connectionSummary.database,
          authType: connectionSummary.authType,
          encrypt: connectionSummary.encrypt,
          readOnlyMode: this.readOnlyMode,
          allowDestructiveOperations: this.allowDestructiveOperations,
          allowSchemaChanges: this.allowSchemaChanges,
          logLevel: this.logging.logLevel,
          securityAudit: this.logging.securityAudit
        }
      });
    } else {
      // Use console.log (stdout) instead of console.error (stderr) for MCP compatibility
      console.log(configMessage);
    }
  }
}

// Export a singleton instance for easy access
export const serverConfig = new ServerConfig();
