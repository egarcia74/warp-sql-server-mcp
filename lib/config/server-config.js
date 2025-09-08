/**
 * Server Configuration Manager
 *
 * Centralizes all configuration management and environment variable handling
 * Provides a clean interface for accessing server settings
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json for version information
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

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
   * Safely parse integer from environment variable or default
   * @param {string} envVar - Environment variable value
   * @param {string} defaultValue - Default value as string
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @returns {number} Parsed integer value
   * @private
   */
  _safeParseInt(envVar, defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const value = parseInt(envVar || defaultValue);
    if (isNaN(value) || value < min || value > max) {
      console.warn(`Invalid integer value: ${envVar}, using default: ${defaultValue}`);
      return parseInt(defaultValue);
    }
    return value;
  }

  /**
   * Safely parse float from environment variable or default
   * @param {string} envVar - Environment variable value
   * @param {string} defaultValue - Default value as string
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @returns {number} Parsed float value
   * @private
   */
  _safeParseFloat(envVar, defaultValue, min = 0, max = Number.MAX_VALUE) {
    const value = parseFloat(envVar || defaultValue);
    if (isNaN(value) || value < min || value > max) {
      console.warn(`Invalid float value: ${envVar}, using default: ${defaultValue}`);
      return parseFloat(defaultValue);
    }
    return value;
  }

  /**
   * Load configuration from environment variables
   * @private
   */
  _loadConfiguration() {
    // Debug mode
    this.debugMode = process.env.SQL_SERVER_DEBUG === 'true';

    // Timeouts and connection settings
    this.connectionTimeout = this._safeParseInt(
      process.env.SQL_SERVER_CONNECT_TIMEOUT_MS,
      '10000',
      1000,
      60000
    ); // 10s
    this.requestTimeout = this._safeParseInt(
      process.env.SQL_SERVER_REQUEST_TIMEOUT_MS,
      '30000',
      5000,
      300000
    ); // 30s
    this.maxRetries = this._safeParseInt(process.env.SQL_SERVER_MAX_RETRIES, '3', 0, 10);
    this.retryDelay = this._safeParseInt(process.env.SQL_SERVER_RETRY_DELAY_MS, '1000', 100, 10000); // 1s

    // Safety configuration with secure defaults
    this.readOnlyMode = process.env.SQL_SERVER_READ_ONLY !== 'false'; // Default: true
    this.allowDestructiveOperations =
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS === 'true'; // Default: false
    this.allowSchemaChanges = process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES === 'true'; // Default: false

    // Performance monitoring settings
    this.performanceMonitoring = {
      enabled: process.env.ENABLE_PERFORMANCE_MONITORING !== 'false', // Default: true
      maxMetricsHistory: this._safeParseInt(process.env.MAX_METRICS_HISTORY, '1000', 100, 10000),
      slowQueryThreshold: this._safeParseInt(process.env.SLOW_QUERY_THRESHOLD, '5000', 100, 60000),
      trackPoolMetrics: process.env.TRACK_POOL_METRICS !== 'false', // Default: true
      samplingRate: this._safeParseFloat(process.env.PERFORMANCE_SAMPLING_RATE, '1.0', 0.0, 1.0)
    };

    // Streaming configuration
    this.streaming = {
      enabled: process.env.ENABLE_STREAMING !== 'false', // Default: true
      batchSize: this._safeParseInt(process.env.STREAMING_BATCH_SIZE, '1000', 100, 50000),
      maxMemoryMB: this._safeParseInt(process.env.STREAMING_MAX_MEMORY_MB, '100', 10, 1000),
      maxResponseSize: this._safeParseInt(
        process.env.STREAMING_MAX_RESPONSE_SIZE,
        '10485760',
        1048576,
        104857600
      ) // 10MB
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
    const connectionSummary = this.getConnectionSummary();

    // Check for potentially unsafe configurations
    if (!this.readOnlyMode && this.allowDestructiveOperations) {
      warnings.push('Destructive operations are enabled - use caution in production');
    }

    if (!this.readOnlyMode && this.allowSchemaChanges) {
      warnings.push('Schema changes are enabled - use caution in production');
    }

    // SSL/TLS Security Validation
    const securityDecision = connectionSummary.securityDecision;

    // Warn about explicit certificate trust in production-like environments
    if (securityDecision.type === 'explicit' && securityDecision.securityLevel === 'low') {
      if (!connectionSummary.isDevEnvironment) {
        warnings.push(
          '🚨 SSL certificate trust is explicitly enabled but environment appears to be production - this is a security risk'
        );
      }
    }

    // Warn about environment detection issues
    if (securityDecision.type === 'auto-detected' && securityDecision.warnings) {
      securityDecision.warnings.forEach(warning => {
        warnings.push(`🔍 SSL auto-detection: ${warning}`);
      });
    }

    // Warn about low-confidence environment detection
    if (securityDecision.confidence === 'low' && connectionSummary.trustCert) {
      warnings.push(
        '⚠️ SSL certificate trust enabled with low confidence in environment detection - consider setting SQL_SERVER_TRUST_CERT explicitly'
      );
    }

    // Recommend explicit SSL configuration for production
    if (!process.env.SQL_SERVER_TRUST_CERT && !connectionSummary.isDevEnvironment) {
      warnings.push(
        '💡 Production environment detected - consider setting SQL_SERVER_TRUST_CERT=false explicitly for security'
      );
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
      errors,
      sslSecurity: {
        decision: securityDecision,
        trustCert: connectionSummary.trustCert,
        source: connectionSummary.trustCertSource,
        environment: connectionSummary.isDevEnvironment ? 'development' : 'production'
      }
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
   * Determine if we're in a development-like environment with conservative security approach
   * @private
   * @returns {Object} Environment detection result with details
   */
  _analyzeEnvironment() {
    const host = process.env.SQL_SERVER_HOST || 'localhost';
    const nodeEnv = process.env.NODE_ENV;
    const isExplicitDev = nodeEnv === 'development' || nodeEnv === 'test';

    // Conservative detection: Only trust certificates in clearly identified development scenarios
    const devIndicators = [];
    const prodWarnings = [];

    // Strong development indicators
    if (isExplicitDev) {
      devIndicators.push(`NODE_ENV=${nodeEnv}`);
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      devIndicators.push(`localhost connection (${host})`);
    }

    // Weaker development indicators that need additional validation
    if (host.endsWith('.local')) {
      if (isExplicitDev) {
        devIndicators.push('.local domain with explicit dev environment');
      } else {
        prodWarnings.push(
          '.local domain without explicit NODE_ENV=development (could be production)'
        );
      }
    }

    // Private IP ranges - only trust if NODE_ENV is explicitly development
    const isPrivateIP =
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);

    if (isPrivateIP) {
      if (isExplicitDev) {
        devIndicators.push(`private IP (${host}) with explicit dev environment`);
      } else {
        prodWarnings.push(
          `private IP (${host}) without explicit NODE_ENV=development (could be cloud production)`
        );
      }
    }

    // Conservative decision: require strong evidence for development
    const isDevelopment =
      devIndicators.length > 0 &&
      (isExplicitDev || // Strong: explicit NODE_ENV
        host === 'localhost' ||
        host === '127.0.0.1'); // Strong: localhost

    return {
      isDevelopment,
      confidence: isDevelopment ? 'high' : 'low',
      devIndicators,
      prodWarnings,
      host,
      nodeEnv: nodeEnv || '<not set>'
    };
  }

  /**
   * Determine if we're in a development-like environment (backward compatibility)
   * @private
   * @returns {boolean} True if environment appears to be development
   */
  _isLikelyDevEnvironment() {
    return this._analyzeEnvironment().isDevelopment;
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

    // Get detailed environment analysis for security decisions
    const envAnalysis = this._analyzeEnvironment();

    // Match ConnectionManager's context-aware SSL logic with detailed reasoning
    let trustCert;
    let trustCertSource;
    let securityDecision;

    if (process.env.SQL_SERVER_TRUST_CERT === 'true') {
      trustCert = true;
      trustCertSource = 'explicit-true';
      securityDecision = {
        type: 'explicit',
        reason: 'User explicitly enabled SQL_SERVER_TRUST_CERT=true',
        securityLevel: 'low',
        recommendation: 'Only use in development environments'
      };
    } else if (process.env.SQL_SERVER_TRUST_CERT === 'false') {
      trustCert = false;
      trustCertSource = 'explicit-false';
      securityDecision = {
        type: 'explicit',
        reason: 'User explicitly disabled SQL_SERVER_TRUST_CERT=false',
        securityLevel: 'high',
        recommendation: 'Recommended for production environments'
      };
    } else {
      trustCert = envAnalysis.isDevelopment;
      trustCertSource = envAnalysis.isDevelopment ? 'auto-dev' : 'auto-prod';
      securityDecision = {
        type: 'auto-detected',
        reason: envAnalysis.isDevelopment
          ? `Development environment detected: ${envAnalysis.devIndicators.join(', ')}`
          : 'Production environment assumed (no strong development indicators found)',
        securityLevel: envAnalysis.isDevelopment ? 'low' : 'high',
        confidence: envAnalysis.confidence,
        warnings: envAnalysis.prodWarnings.length > 0 ? envAnalysis.prodWarnings : null,
        recommendation: envAnalysis.isDevelopment
          ? 'Certificate trust enabled for development convenience'
          : 'Certificate trust disabled for production security'
      };
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
      securityDecision, // Detailed SSL security decision reasoning
      isDevEnvironment: envAnalysis.isDevelopment, // Whether environment was detected as development
      environmentAnalysis: envAnalysis, // Full environment analysis details
      poolMax: this._safeParseInt(process.env.SQL_SERVER_POOL_MAX, '10', 1, 100),
      poolMin: this._safeParseInt(process.env.SQL_SERVER_POOL_MIN, '0', 0, 50)
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

    // MCP Server Information
    configLines.push('🖥️  MCP Server Information:');
    configLines.push(`    Name: ${packageJson.name}`);
    configLines.push(`    Version: ${packageJson.version}`);
    configLines.push(`    Description: ${packageJson.description}`);
    configLines.push('');

    // Runtime Environment
    configLines.push('⚙️  Runtime Environment:');
    configLines.push(`    Node.js: ${process.version}`);
    configLines.push(`    Platform: ${process.platform}`);
    configLines.push(`    Architecture: ${process.arch}`);
    configLines.push(`    Process ID: ${process.pid}`);
    configLines.push(`    Parent Process ID: ${process.ppid || 'unknown'}`);
    configLines.push(`    Working Directory: ${process.cwd()}`);
    configLines.push(`    Environment: ${process.env.NODE_ENV || 'development'}`);

    // Memory and system info
    const memUsage = process.memoryUsage();
    configLines.push(
      `    Memory Usage: ${Math.round(memUsage.rss / 1024 / 1024)}MB RSS, ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB Heap`
    );
    configLines.push(`    Uptime: ${Math.round(process.uptime())}s`);

    // Command line arguments
    const args = process.argv.slice(2);
    if (args.length > 0) {
      configLines.push(`    Command Args: ${args.join(' ')}`);
    }

    // Important environment variables for debugging
    const debugEnvVars = [
      'VSCODE_MCP',
      'SQL_SERVER_HOST',
      'SQL_SERVER_PORT',
      'SQL_SERVER_DATABASE',
      'SQL_SERVER_USER',
      'SQL_SERVER_ENCRYPT',
      'SQL_SERVER_TRUST_CERT',
      'SQL_SERVER_LOG_LEVEL',
      'NODE_ENV'
    ];

    const setEnvVars = debugEnvVars
      .filter(varName => process.env[varName] !== undefined)
      .map(varName => {
        const value = varName.includes('PASSWORD') ? '***' : process.env[varName];
        return `${varName}=${value}`;
      });

    if (setEnvVars.length > 0) {
      configLines.push(`    Key Env Vars: ${setEnvVars.join(', ')}`);
    }

    configLines.push('');

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

    // Show SSL certificate trust with enhanced security decision details
    const securityDecision = connectionSummary.securityDecision;
    let trustCertDisplay = `${connectionSummary.trustCert}`;

    switch (connectionSummary.trustCertSource) {
      case 'explicit-true':
        trustCertDisplay += ' (⚠️  explicitly enabled - use only in development)';
        break;
      case 'explicit-false':
        trustCertDisplay += ' (✅ explicitly disabled for security)';
        break;
      case 'auto-dev':
        trustCertDisplay += ' (🔧 auto-enabled for development convenience)';
        break;
      case 'auto-prod':
        trustCertDisplay += ' (🔒 auto-disabled for production security)';
        break;
    }
    configLines.push(`    Trust Cert: ${trustCertDisplay}`);

    // Show detailed security decision reasoning
    configLines.push(`    Security Decision: ${securityDecision.reason}`);
    if (securityDecision.type === 'auto-detected') {
      configLines.push(`    Detection Confidence: ${securityDecision.confidence}`);
      if (securityDecision.warnings && securityDecision.warnings.length > 0) {
        configLines.push(`    ⚠️  Warnings: ${securityDecision.warnings.join(', ')}`);
      }
    }
    configLines.push(
      `    Security Level: ${securityDecision.securityLevel === 'high' ? '🔒 High' : '⚠️  Low'}`
    );

    configLines.push(
      `    Environment: ${connectionSummary.isDevEnvironment ? '🔧 Development' : '🏭 Production'} (${securityDecision.type === 'auto-detected' ? 'auto-detected' : 'explicit'})`
    );
    configLines.push(
      `    Pool: ${connectionSummary.poolMin}-${connectionSummary.poolMax} connections`
    );

    // Network and timing diagnostics
    configLines.push('');
    configLines.push('🔧 Network & Timing Diagnostics:');
    configLines.push(
      `    Connection String Length: ${this.getConnectionConfig().connectionString?.length || 0} chars`
    );
    configLines.push(`    Hostname Resolution: ${os.hostname()}`);

    // Try to get network interface info (best effort)
    try {
      const networkInterfaces = os.networkInterfaces();
      const activeInterfaces = Object.keys(networkInterfaces)
        .filter(name => !name.startsWith('lo'))
        .slice(0, 2); // Show first 2 non-loopback interfaces
      if (activeInterfaces.length > 0) {
        configLines.push(`    Network Interfaces: ${activeInterfaces.join(', ')}`);
      }
    } catch {
      // Ignore network interface errors
    }

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

    // Add dependency and module information for troubleshooting
    configLines.push('');
    configLines.push('📦 Dependencies & Modules:');

    // Key dependency versions from package.json
    try {
      const dependencies = packageJson.dependencies || {};
      const keyDeps = ['mssql', 'winston', 'dotenv'];
      const depInfo = keyDeps
        .filter(dep => dependencies[dep])
        .map(dep => `${dep}@${dependencies[dep]}`)
        .join(', ');
      if (depInfo) {
        configLines.push(`    Key Dependencies: ${depInfo}`);
      }
    } catch {
      // Ignore dependency parsing errors
    }

    // Module loading information
    configLines.push(
      `    Total Modules Loaded: ${Object.keys(process.moduleLoadList || []).length}`
    );
    configLines.push('    MCP Protocol: Model Context Protocol');
    configLines.push('    Transport: stdio (stdin/stdout)');

    // Add log file paths if logger is available
    if (logger && logger.config) {
      const logConfig = logger.config;
      const logDefaults = logger._getSmartLogDefaults();

      configLines.push('');
      configLines.push('📁 Log File Locations:');

      if (logConfig.logFile || logDefaults.logFile) {
        const mainLogPath = logConfig.logFile || logDefaults.logFile;
        configLines.push(`    Main Log: ${mainLogPath}`);
      }

      if (
        logConfig.securityLogFile ||
        (this.logging.securityAudit && logDefaults.securityLogFile)
      ) {
        const securityLogPath = logConfig.securityLogFile || logDefaults.securityLogFile;
        configLines.push(`    Security Audit: ${securityLogPath}`);
      }

      if (logDefaults.errorLogFile) {
        configLines.push(`    Error Log: ${logDefaults.errorLogFile}`);
      }
    }

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
