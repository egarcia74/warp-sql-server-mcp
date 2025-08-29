import { Parser } from 'node-sql-parser';

/**
 * Enhanced SQL Query Validator using proper SQL parsing
 * Replaces regex-based validation with comprehensive AST-based analysis
 */
export class QueryValidator {
  constructor(config = {}) {
    this.readOnlyMode = config.readOnlyMode ?? true;
    this.allowDestructiveOperations = config.allowDestructiveOperations ?? false;
    this.allowSchemaChanges = config.allowSchemaChanges ?? false;

    // Initialize SQL parser for multiple databases
    this.parser = new Parser();

    // Define allowed statement types for each security level
    this.readOnlyStatements = new Set(['select', 'show', 'describe', 'desc', 'explain', 'with']);

    this.destructiveStatements = new Set([
      'insert',
      'update',
      'delete',
      'truncate',
      'merge',
      'replace'
    ]);

    this.schemaStatements = new Set(['create', 'drop', 'alter', 'rename', 'grant', 'revoke']);

    // Dangerous functions and procedures that should be blocked
    this.dangerousFunctions = new Set([
      'xp_cmdshell',
      'sp_configure',
      'openquery',
      'openrowset',
      'opendatasource',
      'sp_oacreate',
      'sp_oamethod',
      'bulk'
    ]);
  }

  /**
   * Validates a SQL query against current security policies
   * @param {string} query - SQL query to validate
   * @param {object} context - Additional context (database, tool name, etc.)
   * @returns {object} Validation result with allowed flag and detailed reason
   */
  validateQuery(query, context = {}) {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return {
        allowed: true,
        reason: 'Empty query',
        queryType: 'empty'
      };
    }

    try {
      // Parse the SQL query into AST
      const ast = this.parser.astify(trimmedQuery, {
        database: 'transactsql' // SQL Server dialect
      });

      // Handle both single statements and arrays of statements
      const statements = Array.isArray(ast) ? ast : [ast];

      // Validate each statement
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const validation = this.validateStatement(stmt, context, i);

        if (!validation.allowed) {
          return {
            ...validation,
            statementNumber: i + 1,
            totalStatements: statements.length
          };
        }
      }

      return {
        allowed: true,
        reason: 'Query validation passed',
        statementsCount: statements.length,
        queryType: this.getQueryType(statements)
      };
    } catch (parseError) {
      // If parsing fails, fall back to regex validation for better compatibility
      console.warn(`SQL parsing failed, falling back to regex validation: ${parseError.message}`);
      return this.fallbackRegexValidation(trimmedQuery, context);
    }
  }

  /**
   * Validates a single SQL statement
   * @param {object} stmt - Parsed SQL statement AST
   * @param {object} context - Validation context
   * @param {number} index - Statement index in multi-statement query
   * @returns {object} Validation result
   */
  validateStatement(stmt, _context, _index) {
    if (!stmt || !stmt.type) {
      return {
        allowed: false,
        reason: 'Invalid or unparseable SQL statement',
        queryType: 'invalid'
      };
    }

    const stmtType = stmt.type.toLowerCase();

    // Check for dangerous functions first
    const dangerousFunction = this.checkForDangerousFunctions(stmt);
    if (dangerousFunction) {
      return {
        allowed: false,
        reason: `Query contains dangerous function '${dangerousFunction}' which is prohibited for security`,
        queryType: 'dangerous',
        securityViolation: true
      };
    }

    // Apply read-only mode restrictions
    if (this.readOnlyMode) {
      if (!this.readOnlyStatements.has(stmtType)) {
        return {
          allowed: false,
          reason: `Read-only mode is enabled. Statement type '${stmtType}' is not allowed. Only SELECT queries are permitted. Set SQL_SERVER_READ_ONLY=false to disable.`,
          queryType: 'non-select',
          statement: stmtType
        };
      }
    }

    // Check destructive operations (if not in read-only mode)
    if (!this.readOnlyMode && this.destructiveStatements.has(stmtType)) {
      if (!this.allowDestructiveOperations) {
        return {
          allowed: false,
          reason: `Destructive operation '${stmtType}' is disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.`,
          queryType: 'destructive',
          statement: stmtType
        };
      }
    }

    // Check schema changes (if not in read-only mode)
    if (!this.readOnlyMode && this.schemaStatements.has(stmtType)) {
      if (!this.allowSchemaChanges) {
        return {
          allowed: false,
          reason: `Schema change '${stmtType}' is disabled. Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=true to enable.`,
          queryType: 'schema',
          statement: stmtType
        };
      }
    }

    // Check for SQL injection patterns in the AST
    const injectionCheck = this.checkForSqlInjection(stmt);
    if (!injectionCheck.safe) {
      return {
        allowed: false,
        reason: `Potential SQL injection detected: ${injectionCheck.reason}`,
        queryType: 'injection',
        securityViolation: true
      };
    }

    return { allowed: true, reason: `Statement '${stmtType}' validation passed` };
  }

  /**
   * Checks for dangerous SQL functions in the AST
   * @param {object} stmt - SQL statement AST
   * @returns {string|null} Name of dangerous function found, or null
   */
  checkForDangerousFunctions(stmt) {
    const checkNode = node => {
      if (!node || typeof node !== 'object') return null;

      // Check function calls
      if (node.type === 'function') {
        const functionName = node.name?.toLowerCase();
        if (functionName && this.dangerousFunctions.has(functionName)) {
          return functionName;
        }
      }

      // Recursively check all properties
      for (const key in node) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          const value = node[key];
          if (Array.isArray(value)) {
            for (const item of value) {
              const result = checkNode(item);
              if (result) return result;
            }
          } else if (typeof value === 'object') {
            const result = checkNode(value);
            if (result) return result;
          }
        }
      }

      return null;
    };

    return checkNode(stmt);
  }

  /**
   * Advanced SQL injection detection using AST analysis
   * @param {object} stmt - SQL statement AST
   * @returns {object} Safety check result
   */
  checkForSqlInjection(stmt) {
    // This is a simplified implementation - in production, you might want
    // more sophisticated SQL injection detection

    const suspiciousPatterns = [
      // Look for potential injection in string literals
      /['"]\s*(;|\s+(OR|AND)\s+)/i,
      // Union-based injection
      /\bUNION\s+(ALL\s+)?SELECT\b/i,
      // Comment-based injection
      /(-{2}|\/\*|\*\/)/,
      // System table access
      /\bsys\./i
    ];

    const checkStringLiterals = node => {
      if (!node || typeof node !== 'object') return { safe: true };

      // Check string values for suspicious patterns
      if (typeof node.value === 'string') {
        for (const pattern of suspiciousPatterns) {
          if (pattern.test(node.value)) {
            return {
              safe: false,
              reason: `Suspicious pattern detected in string literal: '${node.value}'`
            };
          }
        }
      }

      // Recursively check all properties
      for (const key in node) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          const value = node[key];
          if (Array.isArray(value)) {
            for (const item of value) {
              const result = checkStringLiterals(item);
              if (!result.safe) return result;
            }
          } else if (typeof value === 'object') {
            const result = checkStringLiterals(value);
            if (!result.safe) return result;
          }
        }
      }

      return { safe: true };
    };

    return checkStringLiterals(stmt);
  }

  /**
   * Fallback regex validation for when SQL parsing fails
   * @param {string} query - SQL query string
   * @param {object} context - Validation context
   * @returns {object} Validation result
   */
  fallbackRegexValidation(query, _context) {
    // Use the original regex patterns as fallback
    const destructivePatterns = [
      /^\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i,
      /^\s*EXEC(UTE)?\s+/i,
      /^\s*CALL\s+/i,
      /;\s*(DELETE|UPDATE|INSERT|TRUNCATE)\s+/i
    ];

    const schemaChangePatterns = [
      /^\s*(CREATE|DROP|ALTER)\s+/i,
      /^\s*(GRANT|REVOKE)\s+/i,
      /;\s*(CREATE|DROP|ALTER|GRANT|REVOKE)\s+/i
    ];

    const readOnlyPatterns = [
      /^\s*SELECT\s+/i,
      /^\s*SHOW\s+/i,
      /^\s*DESCRIBE\s+/i,
      /^\s*DESC\s+/i,
      /^\s*EXPLAIN\s+/i,
      /^\s*WITH\s+[\s\S]*?\bSELECT\s+/i
    ];

    // Apply read-only mode restrictions
    if (this.readOnlyMode) {
      const isReadOnlyQuery = readOnlyPatterns.some(pattern => pattern.test(query));
      if (!isReadOnlyQuery) {
        return {
          allowed: false,
          reason:
            'Read-only mode is enabled. Only SELECT queries are allowed. Set SQL_SERVER_READ_ONLY=false to disable.',
          queryType: 'non-select',
          fallback: true
        };
      }
    }

    // Check for destructive operations
    if (!this.readOnlyMode) {
      const hasDestructiveOps = destructivePatterns.some(pattern => pattern.test(query));
      if (hasDestructiveOps && !this.allowDestructiveOperations) {
        return {
          allowed: false,
          reason:
            'Destructive operations (INSERT/UPDATE/DELETE) are disabled. Set SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true to enable.',
          queryType: 'destructive',
          fallback: true
        };
      }
    }

    // Check for schema changes
    if (!this.readOnlyMode) {
      const hasSchemaChanges = schemaChangePatterns.some(pattern => pattern.test(query));
      if (hasSchemaChanges && !this.allowSchemaChanges) {
        return {
          allowed: false,
          reason:
            'Schema changes (CREATE/DROP/ALTER) are disabled. Set SQL_SERVER_ALLOW_SCHEMA_CHANGES=true to enable.',
          queryType: 'schema',
          fallback: true
        };
      }
    }

    return {
      allowed: true,
      reason: 'Fallback regex validation passed',
      fallback: true
    };
  }

  /**
   * Determines the overall query type from parsed statements
   * @param {array} statements - Array of parsed statements
   * @returns {string} Query type classification
   */
  getQueryType(statements) {
    if (statements.length === 0) return 'empty';
    if (statements.length > 1) return 'multi-statement';

    const stmt = statements[0];
    return stmt.type?.toLowerCase() || 'unknown';
  }

  /**
   * Updates security configuration
   * @param {object} newConfig - New security configuration
   */
  updateConfig(newConfig) {
    if (Object.prototype.hasOwnProperty.call(newConfig, 'readOnlyMode')) {
      this.readOnlyMode = newConfig.readOnlyMode;
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'allowDestructiveOperations')) {
      this.allowDestructiveOperations = newConfig.allowDestructiveOperations;
    }
    if (Object.prototype.hasOwnProperty.call(newConfig, 'allowSchemaChanges')) {
      this.allowSchemaChanges = newConfig.allowSchemaChanges;
    }
  }

  /**
   * Gets current security configuration
   * @returns {object} Current security settings
   */
  getConfig() {
    return {
      readOnlyMode: this.readOnlyMode,
      allowDestructiveOperations: this.allowDestructiveOperations,
      allowSchemaChanges: this.allowSchemaChanges
    };
  }
}
