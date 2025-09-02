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
   * @param {string} value - Value to potentially redact
   * @param {boolean} isSensitive - Whether the value contains sensitive data
   * @returns {string} Redacted or original value
   */
  _redactSensitive(value, isSensitive = true) {
    if (!value || value === '') return '<not set>';
    if (!isSensitive) return value;
    if (value.length <= 4) return '***';
    return value.substring(0, 2) + '*'.repeat(Math.min(value.length - 4, 8)) + value.slice(-2);
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
    const encrypt = process.env.SQL_SERVER_ENCRYPT === 'true';
    const trustCert = process.env.SQL_SERVER_TRUST_CERT === 'true';

    // Determine authentication type
    let authType = 'SQL Server Authentication';
    if (!user && !password) {
      authType = 'Windows Authentication';
    }

    return {
      server: `${host}:${port}`,
      database,
      authType,
      user: user ? this._redactSensitive(user, false) : '<Windows Auth>',
      password: this._redactSensitive(password, true),
      domain: domain || '<not set>',
      encrypt,
      trustCert,
      poolMax: parseInt(process.env.SQL_SERVER_POOL_MAX || '10'),
      poolMin: parseInt(process.env.SQL_SERVER_POOL_MIN || '0')
    };
  }

  /**
   * Log current configuration (useful for startup)
   */
  logConfiguration() {
    if (process.env.NODE_ENV === 'test') return;

    const connectionSummary = this.getConnectionSummary();

    console.error('=== SQL Server MCP Configuration ===');
    console.error('Connection Settings:');
    console.error(`  Server: ${connectionSummary.server}`);
    console.error(`  Database: ${connectionSummary.database}`);
    console.error(`  Auth Type: ${connectionSummary.authType}`);
    console.error(`  User: ${connectionSummary.user}`);
    console.error(`  Password: ${connectionSummary.password}`);
    if (connectionSummary.authType === 'Windows Authentication') {
      console.error(`  Domain: ${connectionSummary.domain}`);
    }
    console.error(`  Encrypt: ${connectionSummary.encrypt}`);
    console.error(`  Trust Cert: ${connectionSummary.trustCert}`);
    console.error(`  Pool: ${connectionSummary.poolMin}-${connectionSummary.poolMax} connections`);
    console.error('');
    console.error('Server Settings:');
    console.error(`  Debug Mode: ${this.debugMode}`);
    console.error(`  Read-Only Mode: ${this.readOnlyMode}`);
    console.error(`  Allow Destructive Operations: ${this.allowDestructiveOperations}`);
    console.error(`  Allow Schema Changes: ${this.allowSchemaChanges}`);
    console.error(`  Connection Timeout: ${this.connectionTimeout}ms`);
    console.error(`  Request Timeout: ${this.requestTimeout}ms`);
    console.error(`  Max Retries: ${this.maxRetries}`);
    console.error(`  Performance Monitoring: ${this.performanceMonitoring.enabled}`);
    console.error('====================================');

    // Log any configuration warnings/errors
    const validation = this.validate();
    if (validation.warnings.length > 0) {
      console.error('Configuration Warnings:');
      validation.warnings.forEach(warning => console.error(`  - ${warning}`));
    }
    if (validation.errors.length > 0) {
      console.error('Configuration Errors:');
      validation.errors.forEach(error => console.error(`  - ${error}`));
    }
  }
}

// Export a singleton instance for easy access
export const serverConfig = new ServerConfig();
