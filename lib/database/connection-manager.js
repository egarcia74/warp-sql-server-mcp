/**
 * Database Connection Manager
 *
 * Handles SQL Server connection pooling, retry logic, and authentication
 * Extracted from the main SqlServerMCP class for better organization
 */

import sql from 'mssql';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class ConnectionManager {
  constructor(config = {}) {
    // Configuration with defaults
    this.connectionTimeout =
      config.connectionTimeout || parseInt(process.env.SQL_SERVER_CONNECT_TIMEOUT_MS || '10000');
    this.requestTimeout =
      config.requestTimeout || parseInt(process.env.SQL_SERVER_REQUEST_TIMEOUT_MS || '30000');
    this.maxRetries = config.maxRetries || parseInt(process.env.SQL_SERVER_MAX_RETRIES || '3');
    this.retryDelay =
      config.retryDelay || parseInt(process.env.SQL_SERVER_RETRY_DELAY_MS || '1000');

    // Connection state
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Connect to SQL Server with retry logic and proper authentication handling
   * @returns {Promise<Object>} SQL Server connection pool
   */
  async connect() {
    if (this.pool && this.pool.connected) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Using existing database connection pool');
      }
      return this.pool;
    }

    if (process.env.NODE_ENV !== 'test') {
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

        if (process.env.NODE_ENV !== 'test') {
          console.error(`Connected to SQL Server successfully (attempt ${attempt})`);
        }
        return this.pool;
      } catch (error) {
        lastError = error;
        if (process.env.NODE_ENV !== 'test') {
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
   * Build the connection configuration from environment variables
   * @private
   * @returns {Object} SQL Server connection configuration
   */
  _buildConnectionConfig() {
    const baseConfig = {
      server: process.env.SQL_SERVER_HOST || 'localhost',
      port: parseInt(process.env.SQL_SERVER_PORT) || 1433,
      database: process.env.SQL_SERVER_DATABASE || 'master',
      user: process.env.SQL_SERVER_USER,
      password: process.env.SQL_SERVER_PASSWORD,
      options: {
        encrypt: process.env.SQL_SERVER_ENCRYPT === 'true' || false,
        trustServerCertificate: process.env.SQL_SERVER_TRUST_CERT === 'true' || true,
        enableArithAbort: true,
        requestTimeout: this.requestTimeout
      },
      connectionTimeout: this.connectionTimeout,
      requestTimeout: this.requestTimeout,
      pool: {
        max: parseInt(process.env.SQL_SERVER_POOL_MAX || '10'),
        min: parseInt(process.env.SQL_SERVER_POOL_MIN || '0'),
        idleTimeoutMillis: parseInt(process.env.SQL_SERVER_POOL_IDLE_TIMEOUT_MS || '30000')
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

    return {
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
  }
}
