import AWS from 'aws-sdk';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * Universal Secret Management System
 * Supports environment variables, AWS Secrets Manager, and Azure Key Vault
 */
export class SecretManager {
  constructor(config = {}) {
    this.config = config;
    this.secretSource = config.secretSource || 'env'; // 'env', 'aws', 'azure'
    this.cache = new Map();
    this.cacheMaxAge = config.cacheMaxAge || 300000; // 5 minutes default

    this.initializeProviders();
  }

  /**
   * Initialize secret providers based on configuration
   */
  initializeProviders() {
    if (this.secretSource === 'aws') {
      this.awsSecretsClient = new AWS.SecretsManager({
        region: this.config.awsRegion || process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      });
    } else if (this.secretSource === 'azure') {
      const vaultUrl = this.config.azureVaultUrl || process.env.AZURE_KEY_VAULT_URL;
      if (!vaultUrl) {
        throw new Error('Azure Key Vault URL is required for Azure secret management');
      }

      this.azureSecretClient = new SecretClient(vaultUrl, new DefaultAzureCredential());
    }
  }

  /**
   * Retrieves a secret value from the configured source
   * @param {string} secretName - Name/key of the secret
   * @param {object} options - Additional options
   * @returns {Promise<string|null>} Secret value or null if not found
   */
  async getSecret(secretName, options = {}) {
    const cacheKey = `${this.secretSource}:${secretName}`;

    // Check cache first (unless forced refresh)
    if (!options.refresh && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheMaxAge) {
        return cached.value;
      }
    }

    let secretValue = null;

    try {
      switch (this.secretSource) {
        case 'env':
          secretValue = await this.getFromEnvironment(secretName);
          break;
        case 'aws':
          secretValue = await this.getFromAWS(secretName);
          break;
        case 'azure':
          secretValue = await this.getFromAzure(secretName);
          break;
        default:
          throw new Error(`Unsupported secret source: ${this.secretSource}`);
      }

      // Cache the result
      if (secretValue !== null) {
        this.cache.set(cacheKey, {
          value: secretValue,
          timestamp: Date.now()
        });
      }

      return secretValue;
    } catch (error) {
      console.error(
        `Failed to retrieve secret '${secretName}' from ${this.secretSource}:`,
        error.message
      );

      // Fallback to environment variable if primary source fails
      if (this.secretSource !== 'env') {
        console.warn(`Falling back to environment variable for secret '${secretName}'`);
        return await this.getFromEnvironment(secretName);
      }

      return null;
    }
  }

  /**
   * Retrieves secret from environment variables
   * @param {string} secretName - Environment variable name
   * @returns {Promise<string|null>} Secret value
   */
  async getFromEnvironment(secretName) {
    return process.env[secretName] || null;
  }

  /**
   * Retrieves secret from AWS Secrets Manager
   * @param {string} secretName - Secret ARN or name
   * @returns {Promise<string|null>} Secret value
   */
  async getFromAWS(secretName) {
    if (!this.awsSecretsClient) {
      throw new Error('AWS Secrets Manager client not initialized');
    }

    const params = {
      SecretId: secretName,
      VersionStage: 'AWSCURRENT'
    };

    const result = await this.awsSecretsClient.getSecretValue(params).promise();

    if (result.SecretString) {
      // Handle both plain string and JSON secrets
      try {
        const secretObj = JSON.parse(result.SecretString);
        return secretObj;
      } catch {
        return result.SecretString;
      }
    }

    return null;
  }

  /**
   * Retrieves secret from Azure Key Vault
   * @param {string} secretName - Secret name (environment variable format)
   * @returns {Promise<string|null>} Secret value
   */
  async getFromAzure(secretName) {
    if (!this.azureSecretClient) {
      throw new Error('Azure Key Vault client not initialized');
    }

    // Convert environment variable format to Azure Key Vault format
    // Environment: SQL_SERVER_HOST -> Azure: SQL-SERVER-HOST
    const azureSecretName = this.convertToAzureSecretName(secretName);

    try {
      const secret = await this.azureSecretClient.getSecret(azureSecretName);
      return secret.value || null;
    } catch (error) {
      // If the converted name fails, try the original name as fallback
      if (azureSecretName !== secretName) {
        console.warn(
          `Azure secret '${azureSecretName}' not found, trying original name '${secretName}'`
        );
        try {
          const secret = await this.azureSecretClient.getSecret(secretName);
          return secret.value || null;
        } catch (fallbackError) {
          // Log both attempts for debugging
          throw new Error(
            `Azure Key Vault secret not found: '${azureSecretName}' or '${secretName}'. ` +
              `Original error: ${error.message}, Fallback error: ${fallbackError.message}`
          );
        }
      }
      throw error;
    }
  }

  /**
   * Converts environment variable names to Azure Key Vault compatible format
   * @param {string} envVarName - Environment variable name (e.g., SQL_SERVER_HOST)
   * @returns {string} Azure Key Vault secret name (e.g., SQL-SERVER-HOST)
   */
  convertToAzureSecretName(envVarName) {
    // Azure Key Vault secret names:
    // - Can contain letters, numbers, and hyphens
    // - Cannot contain underscores
    // - Are case-insensitive
    // - Must be 1-127 characters

    return envVarName.replace(/_/g, '-');
  }

  /**
   * Retrieves database connection configuration with secrets resolution
   * @returns {Promise<object>} Database configuration object
   */
  async getDatabaseConfig() {
    const config = {
      server: (await this.getSecret('SQL_SERVER_HOST')) || 'localhost',
      port: parseInt(await this.getSecret('SQL_SERVER_PORT')) || 1433,
      database: (await this.getSecret('SQL_SERVER_DATABASE')) || 'master',
      user: await this.getSecret('SQL_SERVER_USER'),
      password: await this.getSecret('SQL_SERVER_PASSWORD'),
      domain: await this.getSecret('SQL_SERVER_DOMAIN'),

      // Connection options
      encrypt: (await this.getSecret('SQL_SERVER_ENCRYPT')) === 'true' || false,
      trustServerCertificate: (await this.getSecret('SQL_SERVER_TRUST_CERT')) === 'true' || true,

      // Timeout configurations
      connectionTimeout: parseInt(await this.getSecret('SQL_SERVER_CONNECT_TIMEOUT_MS')) || 10000,
      requestTimeout: parseInt(await this.getSecret('SQL_SERVER_REQUEST_TIMEOUT_MS')) || 30000,
      maxRetries: parseInt(await this.getSecret('SQL_SERVER_MAX_RETRIES')) || 3,
      retryDelay: parseInt(await this.getSecret('SQL_SERVER_RETRY_DELAY_MS')) || 1000,

      // Pool settings
      poolMax: parseInt(await this.getSecret('SQL_SERVER_POOL_MAX')) || 10,
      poolMin: parseInt(await this.getSecret('SQL_SERVER_POOL_MIN')) || 0,
      poolIdleTimeout: parseInt(await this.getSecret('SQL_SERVER_POOL_IDLE_TIMEOUT_MS')) || 30000,

      // Security settings
      readOnlyMode: (await this.getSecret('SQL_SERVER_READ_ONLY')) !== 'false', // Default: true
      allowDestructiveOperations:
        (await this.getSecret('SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS')) === 'true',
      allowSchemaChanges: (await this.getSecret('SQL_SERVER_ALLOW_SCHEMA_CHANGES')) === 'true',

      // Logging and monitoring
      logLevel: (await this.getSecret('SQL_SERVER_LOG_LEVEL')) || 'info'
    };

    return config;
  }

  /**
   * Retrieves multiple secrets in parallel
   * @param {string[]} secretNames - Array of secret names
   * @returns {Promise<object>} Object mapping secret names to values
   */
  async getSecrets(secretNames) {
    const promises = secretNames.map(async name => {
      const value = await this.getSecret(name);
      return { name, value };
    });

    const results = await Promise.all(promises);
    const secretMap = {};

    for (const { name, value } of results) {
      secretMap[name] = value;
    }

    return secretMap;
  }

  /**
   * Clears the secret cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Health check for secret providers
   * @returns {Promise<object>} Health status
   */
  async healthCheck() {
    const health = {
      source: this.secretSource,
      status: 'unknown',
      details: {}
    };

    try {
      switch (this.secretSource) {
        case 'env':
          health.status = 'healthy';
          health.details.environment = 'accessible';
          break;

        case 'aws':
          if (this.awsSecretsClient) {
            // Test with a dummy call to validate credentials
            try {
              await this.awsSecretsClient.listSecrets({ MaxResults: 1 }).promise();
              health.status = 'healthy';
              health.details.aws = 'authenticated';
            } catch (error) {
              health.status = 'unhealthy';
              health.details.aws = `authentication failed: ${error.message}`;
            }
          } else {
            health.status = 'unhealthy';
            health.details.aws = 'client not initialized';
          }
          break;

        case 'azure':
          if (this.azureSecretClient) {
            try {
              // Test with a simple operation
              await this.azureSecretClient.listPropertiesOfSecrets().next();
              health.status = 'healthy';
              health.details.azure = 'authenticated';
            } catch (error) {
              health.status = 'unhealthy';
              health.details.azure = `authentication failed: ${error.message}`;
            }
          } else {
            health.status = 'unhealthy';
            health.details.azure = 'client not initialized';
          }
          break;
      }
    } catch (error) {
      health.status = 'unhealthy';
      health.details.error = error.message;
    }

    return health;
  }

  /**
   * Creates a masked version of configuration for logging
   * @param {object} config - Configuration object
   * @returns {object} Masked configuration
   */
  static maskSecrets(config) {
    const masked = { ...config };

    const secretFields = ['password', 'user', 'connectionString'];

    for (const field of secretFields) {
      if (masked[field] && typeof masked[field] === 'string') {
        masked[field] = '***MASKED***';
      }
    }

    return masked;
  }
}
