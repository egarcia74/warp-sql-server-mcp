import winston from 'winston';

/**
 * Enhanced Logging System with Security Audit Capabilities
 * Provides structured logging with configurable levels and security audit trails
 */
export class Logger {
  constructor(config = {}) {
    this.config = {
      level: config.level || process.env.SQL_SERVER_LOG_LEVEL || 'info',
      enableSecurityAudit: config.enableSecurityAudit ?? true,
      includeTimestamp: config.includeTimestamp ?? true,
      includeMetadata: config.includeMetadata ?? true,
      maxFileSize: config.maxFileSize || '10m',
      maxFiles: config.maxFiles || 5,
      ...config
    };

    this.logger = this.createLogger();
    this.securityLogger = this.createSecurityLogger();
  }

  /**
   * Creates the main application logger
   * @returns {winston.Logger} Configured Winston logger
   */
  createLogger() {
    const formats = [winston.format.errors({ stack: true })];

    if (this.config.includeTimestamp) {
      formats.push(winston.format.timestamp());
    }

    if (process.env.NODE_ENV !== 'production') {
      formats.push(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const ts = timestamp ? `${timestamp} ` : '';
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${ts}[${level}] ${message}${metaStr}`;
        })
      );
    } else {
      formats.push(winston.format.json());
    }

    const transports = [
      new winston.transports.Console({
        level: this.config.level,
        format: winston.format.combine(...formats)
      })
    ];

    // Add file transport when logFile is specified
    if (this.config.logFile) {
      transports.push(
        new winston.transports.File({
          filename: this.config.logFile,
          level: this.config.level,
          maxsize: this.config.maxFileSize,
          maxFiles: this.config.maxFiles,
          format: winston.format.combine(winston.format.timestamp(), winston.format.json())
        })
      );
    }

    return winston.createLogger({
      level: this.config.level,
      format: winston.format.combine(...formats),
      transports
    });
  }

  /**
   * Creates a dedicated security audit logger
   * @returns {winston.Logger} Security-focused logger
   */
  createSecurityLogger() {
    if (!this.config.enableSecurityAudit) {
      return null;
    }

    const transports = [
      new winston.transports.Console({
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, message, ...meta }) => {
            return `${timestamp} [SECURITY] ${message} ${JSON.stringify(meta)}`;
          })
        )
      })
    ];

    // Add dedicated security audit file when securityLogFile is specified
    if (this.config.securityLogFile) {
      transports.push(
        new winston.transports.File({
          filename: this.config.securityLogFile,
          level: 'info',
          maxsize: this.config.maxFileSize,
          maxFiles: this.config.maxFiles,
          format: winston.format.combine(winston.format.timestamp(), winston.format.json())
        })
      );
    }

    return winston.createLogger({
      level: 'info',
      transports
    });
  }

  /**
   * Logs a general message
   * @param {string} level - Log level (error, warn, info, debug)
   * @param {string} message - Message to log
   * @param {object} meta - Additional metadata
   */
  log(level, message, meta = {}) {
    if (this.config.includeMetadata) {
      this.logger.log(level, message, {
        service: 'warp-sql-server-mcp',
        timestamp: new Date().toISOString(),
        ...meta
      });
    } else {
      this.logger.log(level, message, meta);
    }
  }

  /**
   * Logs an error message
   * @param {string} message - Error message
   * @param {Error|object} error - Error object or metadata
   * @param {object} meta - Additional metadata
   */
  error(message, error = {}, meta = {}) {
    const errorMeta = {
      ...meta,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            }
          : error
    };

    this.log('error', message, errorMeta);
  }

  /**
   * Logs a warning message
   * @param {string} message - Warning message
   * @param {object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  /**
   * Logs an info message
   * @param {string} message - Info message
   * @param {object} meta - Additional metadata
   */
  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  /**
   * Logs a debug message
   * @param {string} message - Debug message
   * @param {object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  /**
   * Logs security-related events
   * @param {string} event - Security event type
   * @param {string} message - Event description
   * @param {object} details - Event details
   */
  security(event, message, details = {}) {
    if (!this.securityLogger) {
      this.warn('Security logging is disabled', { event, message });
      return;
    }

    const securityEvent = {
      event,
      message,
      timestamp: new Date().toISOString(),
      severity: this.getSecuritySeverity(event),
      ...details
    };

    this.securityLogger.info('Security Event', securityEvent);

    // Also log to main logger if it's a high-severity event
    if (securityEvent.severity === 'HIGH' || securityEvent.severity === 'CRITICAL') {
      this.warn(`Security Event: ${message}`, { securityEvent });
    }
  }

  /**
   * Logs query execution with security context
   * @param {string} toolName - Name of the MCP tool
   * @param {string} query - SQL query (will be truncated for logging)
   * @param {object} context - Execution context
   * @param {object} result - Execution result summary
   */
  logQueryExecution(toolName, query, context = {}, result = {}) {
    const truncatedQuery = query.length > 200 ? `${query.substring(0, 200)}...` : query;

    const logData = {
      tool: toolName,
      query: truncatedQuery,
      database: context.database || 'default',
      user: context.user || 'unknown',
      success: result.success !== false,
      rowsAffected: result.rowsAffected || 0,
      duration: result.duration || 0,
      securityLevel: context.securityLevel || 'unknown'
    };

    if (result.success !== false) {
      this.info('Query executed successfully', logData);
    } else {
      this.error('Query execution failed', result.error, logData);
    }

    // Log security events for certain operations
    if (context.securityViolation) {
      this.security('QUERY_BLOCKED', 'Query blocked by security policy', {
        tool: toolName,
        reason: result.error?.message || 'Security policy violation',
        query: truncatedQuery
      });
    }
  }

  /**
   * Logs database connection events
   * @param {string} event - Connection event type
   * @param {object} details - Connection details (masked)
   */
  logConnection(event, details = {}) {
    const logData = {
      event,
      host: details.host || 'unknown',
      database: details.database || 'unknown',
      authType: details.authType || 'unknown',
      ...details
    };

    // Remove sensitive information
    delete logData.password;
    delete logData.connectionString;

    switch (event) {
      case 'CONNECTION_SUCCESS':
        this.info('Database connection established', logData);
        break;
      case 'CONNECTION_FAILED':
        this.error('Database connection failed', details.error, logData);
        this.security('CONNECTION_FAILED', 'Database connection failure', logData);
        break;
      case 'CONNECTION_RETRY':
        this.warn('Database connection retry', logData);
        break;
      default:
        this.info(`Database connection event: ${event}`, logData);
    }
  }

  /**
   * Logs tool usage statistics
   * @param {string} toolName - Name of the MCP tool
   * @param {object} stats - Usage statistics
   */
  logToolUsage(toolName, stats = {}) {
    this.info(`Tool usage: ${toolName}`, {
      tool: toolName,
      executionTime: stats.executionTime || 0,
      resultSize: stats.resultSize || 0,
      cacheHit: stats.cacheHit || false,
      ...stats
    });
  }

  /**
   * Determines security severity based on event type
   * @param {string} event - Security event type
   * @returns {string} Severity level
   */
  getSecuritySeverity(event) {
    const severityMap = {
      QUERY_BLOCKED: 'MEDIUM',
      CONNECTION_FAILED: 'HIGH',
      UNAUTHORIZED_ACCESS: 'CRITICAL',
      SUSPICIOUS_ACTIVITY: 'HIGH',
      CONFIGURATION_CHANGE: 'MEDIUM',
      PRIVILEGE_ESCALATION: 'CRITICAL'
    };

    return severityMap[event] || 'LOW';
  }

  /**
   * Creates a child logger with additional context
   * @param {object} context - Additional context to include in all logs
   * @returns {object} Child logger with context
   */
  child(context = {}) {
    const childLogger = Object.create(this);
    childLogger.defaultContext = { ...this.defaultContext, ...context };

    // Override log method to include default context
    childLogger.log = (level, message, meta = {}) => {
      const combinedMeta = { ...childLogger.defaultContext, ...meta };
      return this.log(level, message, combinedMeta);
    };

    return childLogger;
  }

  /**
   * Flushes any pending log writes
   * @returns {Promise<void>} Promise that resolves when all logs are written
   */
  async flush() {
    return new Promise(resolve => {
      const loggers = [this.logger];
      if (this.securityLogger) {
        loggers.push(this.securityLogger);
      }

      let pending = loggers.length;

      loggers.forEach(logger => {
        logger.on('finish', () => {
          pending--;
          if (pending === 0) {
            resolve();
          }
        });

        logger.end();
      });
    });
  }

  /**
   * Updates the log level dynamically
   * @param {string} level - New log level
   */
  setLevel(level) {
    this.config.level = level;
    this.logger.level = level;
    this.info(`Log level changed to ${level}`);
  }
}
