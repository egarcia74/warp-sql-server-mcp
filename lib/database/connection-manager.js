/**
 * Database Connection Manager
 *
 * Handles SQL Server connection pooling, retry logic, and authentication
 * Extracted from the main SqlServerMCP class for better organization
 */

import sql from 'mssql';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ServerConfig } from '../config/server-config.js';

export class ConnectionManager {
  constructor(config = {}) {
    // Use ServerConfig for centralized configuration management
    this.serverConfig = config.serverConfig || new ServerConfig();

    // Configuration with defaults (prefer passed config, fallback to ServerConfig, then env vars)
    const connectionConfig = this.serverConfig.getConnectionConfig();
    this.connectionTimeout = config.connectionTimeout || connectionConfig.connectionTimeout;
    this.requestTimeout = config.requestTimeout || connectionConfig.requestTimeout;
    this.maxRetries = config.maxRetries || connectionConfig.maxRetries;
    this.retryDelay = config.retryDelay || connectionConfig.retryDelay;

    // Connection state
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Safely parse integer from environment variable with validation
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
   * Connect to SQL Server with retry logic and proper authentication handling
   * @returns {Promise<Object>} SQL Server connection pool
   */
  async connect() {
    if (this.pool && this.pool.connected) {
      // Connection pool already available - reusing efficiently
      return this.pool;
    }

    if (process.env.NODE_ENV !== 'test' && process.env.SQL_SERVER_DEBUG === 'true') {
      console.error('Establishing new database connection...');
    }

    const baseConfig = this._buildConnectionConfig();

    // Retry logic with exponential backoff
    let attempt = 0;
    let lastError = null;

    while (attempt < this.maxRetries) {
      try {
        attempt += 1;
        const config = { ...baseConfig };
        this.pool = await sql.connect(config);
        this.isConnected = true;

        if (process.env.NODE_ENV !== 'test' && process.env.SQL_SERVER_DEBUG === 'true') {
          console.error(`Connected to SQL Server successfully (attempt ${attempt})`);
        }
        return this.pool;
      } catch (error) {
        lastError = error;
        if (process.env.NODE_ENV !== 'test' && process.env.SQL_SERVER_DEBUG === 'true') {
          console.error(`Connection attempt ${attempt} failed: ${error.message}`);
        }
        if (attempt >= this.maxRetries) break;

        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await new Promise(res => setTimeout(res, delay));
      }
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Failed to connect to SQL Server after ${this.maxRetries} attempts: ${lastError ? lastError.message : 'Unknown error'}`
    );
  }

  /**
   * Determine if we're in a development-like environment (delegates to ServerConfig)
   * @private
   * @returns {boolean} True if environment appears to be development
   */
  _isLikelyDevEnvironment() {
    return this.serverConfig._isLikelyDevEnvironment();
  }

  /**
   * Build the connection configuration from environment variables
   * @private
   * @returns {Object} SQL Server connection configuration
   */
  _buildConnectionConfig() {
    const isDevEnv = this._isLikelyDevEnvironment();

    // Context-aware SSL certificate trust:
    // - Explicit 'true': Always trust (developer override)
    // - Explicit 'false': Never trust (production override)
    // - Not set: Smart default based on environment (trust in dev, don't trust in prod)
    let trustServerCertificate;
    if (process.env.SQL_SERVER_TRUST_CERT === 'true') {
      trustServerCertificate = true;
    } else if (process.env.SQL_SERVER_TRUST_CERT === 'false') {
      trustServerCertificate = false;
    } else {
      // Environment-aware default: trust certificates in development environments
      trustServerCertificate = isDevEnv;
    }

    const baseConfig = {
      server: process.env.SQL_SERVER_HOST || 'localhost',
      port: this._safeParseInt(process.env.SQL_SERVER_PORT, '1433', 1, 65535),
      database: process.env.SQL_SERVER_DATABASE || 'master',
      user: process.env.SQL_SERVER_USER,
      password: process.env.SQL_SERVER_PASSWORD,
      options: {
        encrypt: process.env.SQL_SERVER_ENCRYPT !== 'false',
        trustServerCertificate,
        enableArithAbort: true,
        requestTimeout: this.requestTimeout
      },
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.requestTimeout,
      pool: {
        max: this._safeParseInt(process.env.SQL_SERVER_POOL_MAX, '10', 1, 100),
        min: this._safeParseInt(process.env.SQL_SERVER_POOL_MIN, '0', 0, 50),
        idleTimeoutMillis: this._safeParseInt(
          process.env.SQL_SERVER_POOL_IDLE_TIMEOUT_MS,
          '30000',
          1000,
          300000
        )
      }
    };

    // Handle Windows Authentication if no user/password provided
    if (!baseConfig.user && !baseConfig.password) {
      baseConfig.authentication = {
        type: 'ntlm',
        options: {
          domain: process.env.SQL_SERVER_DOMAIN || ''
        }
      };
      // Remove user/password for Windows auth
      delete baseConfig.user;
      delete baseConfig.password;
    } else {
      // Ensure we don't mix SQL Server auth with NTLM
      delete baseConfig.authentication;
    }

    return baseConfig;
  }

  /**
   * Get the current connection pool
   * @returns {Object|null} Current connection pool or null
   */
  getPool() {
    return this.pool;
  }

  /**
   * Check if currently connected
   * @returns {boolean} Connection status
   */
  isConnectionActive() {
    return this.isConnected && this.pool && this.pool.connected;
  }

  /**
   * Close the connection pool
   * @returns {Promise<void>}
   */
  async close() {
    if (this.pool) {
      try {
        await this.pool.close();
      } catch (error) {
        // Log the error but don't throw - we still want to null out the pool
        if (process.env.NODE_ENV !== 'test') {
          console.error('Error closing connection pool:', error.message);
        }
      } finally {
        this.pool = null;
        this.isConnected = false;
      }
    }
  }

  /**
   * Get connection health information
   * @returns {Object} Connection health metrics
   */
  getConnectionHealth() {
    if (!this.pool) {
      return {
        connected: false,
        status: 'No connection pool'
      };
    }

    const health = {
      connected: this.pool.connected,
      connecting: this.pool.connecting,
      healthy: this.pool.healthy,
      status: this.pool.connected ? 'Connected' : 'Disconnected',
      pool: {
        size: this.pool.size,
        available: this.pool.available,
        pending: this.pool.pending,
        borrowed: this.pool.borrowed
      }
    };

    // Try to extract SSL/TLS certificate information if encryption is enabled
    if (this.pool.connected && process.env.SQL_SERVER_ENCRYPT === 'true') {
      health.ssl = this._extractSSLInfo();
    }

    return health;
  }

  /**
   * Get SSL/TLS connection information
   * @private
   * @returns {Object|null} SSL connection status or null if not available
   */
  _extractSSLInfo() {
    try {
      if (!this.pool || !this.pool.connected) return null;

      // Since mssql library doesn't expose underlying TLS socket details easily,
      // provide connection security information based on configuration
      const config = this._buildConnectionConfig();

      return {
        enabled: true,
        encrypt: config.options.encrypt,
        trust_server_certificate: config.options.trustServerCertificate,
        connection_status: 'Encrypted connection established',
        server: `${config.server}:${config.port}`,
        protocol: 'TLS/SSL',
        note: 'Certificate details not available through mssql library abstraction'
      };
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Could not extract SSL connection info:', error.message);
      }
    }

    return null;
  }
}
