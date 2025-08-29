import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock AWS SDK
vi.mock('aws-sdk', () => ({
  default: {
    SecretsManager: vi.fn().mockImplementation(() => ({
      getSecretValue: vi.fn(),
      listSecrets: vi.fn()
    }))
  }
}));

// Mock Azure SDK
vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: vi.fn().mockImplementation(() => ({
    getSecret: vi.fn(),
    listPropertiesOfSecrets: vi.fn()
  }))
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({}))
}));

import { SecretManager } from '../../lib/config/secret-manager.js';
import AWS from 'aws-sdk';
import { SecretClient } from '@azure/keyvault-secrets';

describe('SecretManager', () => {
  let secretManager;
  let mockAWSSecretsClient;
  let mockAzureSecretClient;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Reset all mocks
    vi.clearAllMocks();

    // Setup AWS mock
    mockAWSSecretsClient = {
      getSecretValue: vi.fn(),
      listSecrets: vi.fn()
    };
    AWS.SecretsManager.mockImplementation(() => mockAWSSecretsClient);

    // Setup Azure mock
    mockAzureSecretClient = {
      getSecret: vi.fn(),
      listPropertiesOfSecrets: vi.fn()
    };
    SecretClient.mockImplementation(() => mockAzureSecretClient);

    // Mock console methods
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Restore console methods
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default configuration', () => {
      secretManager = new SecretManager();

      expect(secretManager.secretSource).toBe('env');
      expect(secretManager.cacheMaxAge).toBe(300000); // 5 minutes
      expect(secretManager.cache).toBeInstanceOf(Map);
    });

    test('should initialize with custom configuration', () => {
      const config = {
        secretSource: 'aws',
        cacheMaxAge: 600000,
        awsRegion: 'us-west-2'
      };

      secretManager = new SecretManager(config);

      expect(secretManager.secretSource).toBe('aws');
      expect(secretManager.cacheMaxAge).toBe(600000);
      expect(secretManager.config).toEqual(config);
    });

    test('should initialize AWS provider correctly', () => {
      process.env.AWS_REGION = 'us-west-2';
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

      secretManager = new SecretManager({ secretSource: 'aws' });

      expect(AWS.SecretsManager).toHaveBeenCalledWith({
        region: 'us-west-2',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret'
      });
      expect(secretManager.awsSecretsClient).toBeDefined();
    });

    test('should initialize Azure provider correctly', () => {
      process.env.AZURE_KEY_VAULT_URL = 'https://test-vault.vault.azure.net/';

      secretManager = new SecretManager({ secretSource: 'azure' });

      expect(SecretClient).toHaveBeenCalledWith(
        'https://test-vault.vault.azure.net/',
        expect.any(Object)
      );
      expect(secretManager.azureSecretClient).toBeDefined();
    });

    test('should throw error when Azure URL is missing', () => {
      expect(() => {
        new SecretManager({ secretSource: 'azure' });
      }).toThrow('Azure Key Vault URL is required for Azure secret management');
    });

    test('should use custom Azure URL from config', () => {
      const config = {
        secretSource: 'azure',
        azureVaultUrl: 'https://custom-vault.vault.azure.net/'
      };

      secretManager = new SecretManager(config);

      expect(SecretClient).toHaveBeenCalledWith(
        'https://custom-vault.vault.azure.net/',
        expect.any(Object)
      );
    });
  });

  describe('Environment Variable Secret Source', () => {
    beforeEach(() => {
      secretManager = new SecretManager({ secretSource: 'env' });
    });

    test('should retrieve secret from environment variables', async () => {
      process.env.TEST_SECRET = 'test-value';

      const result = await secretManager.getSecret('TEST_SECRET');

      expect(result).toBe('test-value');
    });

    test('should return null for missing environment variable', async () => {
      const result = await secretManager.getSecret('MISSING_SECRET');

      expect(result).toBeNull();
    });

    test('should cache environment variable values', async () => {
      process.env.CACHED_SECRET = 'cached-value';

      // First call
      const result1 = await secretManager.getSecret('CACHED_SECRET');
      // Second call should use cache
      const result2 = await secretManager.getSecret('CACHED_SECRET');

      expect(result1).toBe('cached-value');
      expect(result2).toBe('cached-value');
      expect(secretManager.cache.has('env:CACHED_SECRET')).toBe(true);
    });

    test('should bypass cache with refresh option', async () => {
      process.env.REFRESH_SECRET = 'initial-value';

      // First call to populate cache
      await secretManager.getSecret('REFRESH_SECRET');

      // Change environment variable
      process.env.REFRESH_SECRET = 'updated-value';

      // Call with refresh option
      const result = await secretManager.getSecret('REFRESH_SECRET', { refresh: true });

      expect(result).toBe('updated-value');
    });

    test('should respect cache expiration', async () => {
      secretManager = new SecretManager({ secretSource: 'env', cacheMaxAge: 100 }); // 100ms
      process.env.EXPIRING_SECRET = 'initial-value';

      // First call to populate cache
      await secretManager.getSecret('EXPIRING_SECRET');

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Change environment variable
      process.env.EXPIRING_SECRET = 'expired-value';

      // Should fetch new value since cache expired
      const result = await secretManager.getSecret('EXPIRING_SECRET');

      expect(result).toBe('expired-value');
    });
  });

  describe('AWS Secrets Manager', () => {
    beforeEach(() => {
      process.env.AWS_REGION = 'us-east-1';
      secretManager = new SecretManager({ secretSource: 'aws' });
    });

    test('should retrieve plain string secret from AWS', async () => {
      mockAWSSecretsClient.getSecretValue.mockReturnValue({
        promise: () =>
          Promise.resolve({
            SecretString: 'plain-secret-value'
          })
      });

      const result = await secretManager.getSecret('test-secret');

      expect(mockAWSSecretsClient.getSecretValue).toHaveBeenCalledWith({
        SecretId: 'test-secret',
        VersionStage: 'AWSCURRENT'
      });
      expect(result).toBe('plain-secret-value');
    });

    test('should retrieve JSON secret from AWS', async () => {
      const jsonSecret = { username: 'admin', password: 'secret123' };
      mockAWSSecretsClient.getSecretValue.mockReturnValue({
        promise: () =>
          Promise.resolve({
            SecretString: JSON.stringify(jsonSecret)
          })
      });

      const result = await secretManager.getSecret('json-secret');

      expect(result).toEqual(jsonSecret);
    });

    test('should handle AWS client not initialized error', async () => {
      secretManager.awsSecretsClient = null;

      const result = await secretManager.getSecret('test-secret');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        "Failed to retrieve secret 'test-secret' from aws:",
        'AWS Secrets Manager client not initialized'
      );
    });

    test('should handle AWS API errors with fallback to environment', async () => {
      process.env.FALLBACK_SECRET = 'fallback-value';
      mockAWSSecretsClient.getSecretValue.mockReturnValue({
        promise: () => Promise.reject(new Error('ResourceNotFoundException'))
      });

      const result = await secretManager.getSecret('FALLBACK_SECRET');

      expect(result).toBe('fallback-value');
      expect(console.error).toHaveBeenCalledWith(
        "Failed to retrieve secret 'FALLBACK_SECRET' from aws:",
        'ResourceNotFoundException'
      );
      expect(console.warn).toHaveBeenCalledWith(
        "Falling back to environment variable for secret 'FALLBACK_SECRET'"
      );
    });

    test('should return null when secret not found in AWS and no fallback', async () => {
      mockAWSSecretsClient.getSecretValue.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      const result = await secretManager.getSecret('missing-secret');

      expect(result).toBeNull();
    });

    test('should cache AWS secret values', async () => {
      mockAWSSecretsClient.getSecretValue.mockReturnValue({
        promise: () =>
          Promise.resolve({
            SecretString: 'cached-aws-value'
          })
      });

      // First call
      const result1 = await secretManager.getSecret('cached-aws-secret');
      // Second call should use cache
      const result2 = await secretManager.getSecret('cached-aws-secret');

      expect(result1).toBe('cached-aws-value');
      expect(result2).toBe('cached-aws-value');
      expect(mockAWSSecretsClient.getSecretValue).toHaveBeenCalledTimes(1);
      expect(secretManager.cache.has('aws:cached-aws-secret')).toBe(true);
    });
  });

  describe('Azure Key Vault', () => {
    beforeEach(() => {
      process.env.AZURE_KEY_VAULT_URL = 'https://test-vault.vault.azure.net/';
      secretManager = new SecretManager({ secretSource: 'azure' });
    });

    test('should retrieve secret from Azure Key Vault', async () => {
      mockAzureSecretClient.getSecret.mockResolvedValue({
        value: 'azure-secret-value'
      });

      const result = await secretManager.getSecret('SQL_SERVER_HOST');

      expect(mockAzureSecretClient.getSecret).toHaveBeenCalledWith('SQL-SERVER-HOST');
      expect(result).toBe('azure-secret-value');
    });

    test('should fallback to original name if converted name fails', async () => {
      mockAzureSecretClient.getSecret
        .mockRejectedValueOnce(new Error('Secret not found'))
        .mockResolvedValueOnce({ value: 'fallback-value' });

      const result = await secretManager.getSecret('SQL_SERVER_HOST');

      expect(mockAzureSecretClient.getSecret).toHaveBeenNthCalledWith(1, 'SQL-SERVER-HOST');
      expect(mockAzureSecretClient.getSecret).toHaveBeenNthCalledWith(2, 'SQL_SERVER_HOST');
      expect(result).toBe('fallback-value');
      expect(console.warn).toHaveBeenCalledWith(
        "Azure secret 'SQL-SERVER-HOST' not found, trying original name 'SQL_SERVER_HOST'"
      );
    });

    test('should handle Azure client not initialized error', async () => {
      secretManager.azureSecretClient = null;

      const result = await secretManager.getSecret('test-secret');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        "Failed to retrieve secret 'test-secret' from azure:",
        'Azure Key Vault client not initialized'
      );
    });

    test('should handle Azure API errors with fallback to environment', async () => {
      process.env.AZURE_FALLBACK_SECRET = 'azure-fallback-value';
      mockAzureSecretClient.getSecret.mockRejectedValue(new Error('Forbidden'));

      const result = await secretManager.getSecret('AZURE_FALLBACK_SECRET');

      expect(result).toBe('azure-fallback-value');
      expect(console.error).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        "Falling back to environment variable for secret 'AZURE_FALLBACK_SECRET'"
      );
    });

    test('should throw error when both converted and original names fail', async () => {
      mockAzureSecretClient.getSecret
        .mockRejectedValueOnce(new Error('First error'))
        .mockRejectedValueOnce(new Error('Second error'));

      const result = await secretManager.getSecret('TEST_SECRET');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        "Failed to retrieve secret 'TEST_SECRET' from azure:",
        "Azure Key Vault secret not found: 'TEST-SECRET' or 'TEST_SECRET'. Original error: First error, Fallback error: Second error"
      );
    });

    test('should cache Azure secret values', async () => {
      mockAzureSecretClient.getSecret.mockResolvedValue({
        value: 'cached-azure-value'
      });

      // First call
      const result1 = await secretManager.getSecret('CACHED_AZURE_SECRET');
      // Second call should use cache
      const result2 = await secretManager.getSecret('CACHED_AZURE_SECRET');

      expect(result1).toBe('cached-azure-value');
      expect(result2).toBe('cached-azure-value');
      expect(mockAzureSecretClient.getSecret).toHaveBeenCalledTimes(1);
      expect(secretManager.cache.has('azure:CACHED_AZURE_SECRET')).toBe(true);
    });
  });

  describe('Azure Secret Name Conversion', () => {
    beforeEach(() => {
      secretManager = new SecretManager();
    });

    test('should convert environment variable names to Azure format', () => {
      const testCases = [
        { input: 'SQL_SERVER_HOST', expected: 'SQL-SERVER-HOST' },
        { input: 'SQL_SERVER_PORT', expected: 'SQL-SERVER-PORT' },
        { input: 'SIMPLE_VAR', expected: 'SIMPLE-VAR' },
        { input: 'NO_UNDERSCORES', expected: 'NO-UNDERSCORES' },
        { input: 'single', expected: 'single' }, // no underscores
        { input: 'MULTIPLE_UNDER_SCORES', expected: 'MULTIPLE-UNDER-SCORES' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = secretManager.convertToAzureSecretName(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Database Configuration', () => {
    beforeEach(() => {
      secretManager = new SecretManager({ secretSource: 'env' });
    });

    test('should build complete database configuration with defaults', async () => {
      process.env.SQL_SERVER_HOST = 'test-server.com';
      process.env.SQL_SERVER_USER = 'testuser';
      process.env.SQL_SERVER_PASSWORD = 'testpass';

      const config = await secretManager.getDatabaseConfig();

      expect(config).toEqual({
        server: 'test-server.com',
        port: 1433, // default
        database: 'master', // default
        user: 'testuser',
        password: 'testpass',
        domain: null,
        encrypt: false, // default
        trustServerCertificate: true, // default
        connectionTimeout: 10000, // default
        requestTimeout: 30000, // default
        maxRetries: 3, // default
        retryDelay: 1000, // default
        poolMax: 10, // default
        poolMin: 0, // default
        poolIdleTimeout: 30000, // default
        readOnlyMode: true, // default
        allowDestructiveOperations: false, // default
        allowSchemaChanges: false, // default
        logLevel: 'info' // default
      });
    });

    test('should parse numeric and boolean configuration values correctly', async () => {
      process.env.SQL_SERVER_PORT = '5432';
      process.env.SQL_SERVER_ENCRYPT = 'true';
      process.env.SQL_SERVER_TRUST_CERT = 'true'; // This is the only value that makes it true, anything else defaults to true
      process.env.SQL_SERVER_POOL_MAX = '20';
      process.env.SQL_SERVER_READ_ONLY = 'false';
      process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'true';

      const config = await secretManager.getDatabaseConfig();

      expect(config.port).toBe(5432);
      expect(config.encrypt).toBe(true);
      expect(config.trustServerCertificate).toBe(true); // The implementation defaults to true unless explicitly 'false'
      expect(config.poolMax).toBe(20);
      expect(config.readOnlyMode).toBe(false);
      expect(config.allowDestructiveOperations).toBe(true);
    });

    test('should handle invalid numeric values with defaults', async () => {
      process.env.SQL_SERVER_PORT = 'invalid';
      process.env.SQL_SERVER_POOL_MAX = 'not-a-number';

      const config = await secretManager.getDatabaseConfig();

      expect(config.port).toBe(1433); // default fallback for NaN
      expect(config.poolMax).toBe(10); // default fallback for NaN
    });

    test('should correctly handle security settings defaults', async () => {
      // Test default security (secure by default)
      const config = await secretManager.getDatabaseConfig();

      expect(config.readOnlyMode).toBe(true); // secure default
      expect(config.allowDestructiveOperations).toBe(false); // secure default
      expect(config.allowSchemaChanges).toBe(false); // secure default
    });

    test('should handle explicit false values for read-only mode', async () => {
      process.env.SQL_SERVER_READ_ONLY = 'false';

      const config = await secretManager.getDatabaseConfig();

      expect(config.readOnlyMode).toBe(false);
    });
  });

  describe('Bulk Secret Retrieval', () => {
    beforeEach(() => {
      secretManager = new SecretManager({ secretSource: 'env' });
    });

    test('should retrieve multiple secrets in parallel', async () => {
      process.env.SECRET_1 = 'value1';
      process.env.SECRET_2 = 'value2';
      process.env.SECRET_3 = 'value3';

      const secretNames = ['SECRET_1', 'SECRET_2', 'SECRET_3'];
      const result = await secretManager.getSecrets(secretNames);

      expect(result).toEqual({
        SECRET_1: 'value1',
        SECRET_2: 'value2',
        SECRET_3: 'value3'
      });
    });

    test('should handle mix of found and missing secrets', async () => {
      process.env.FOUND_SECRET = 'found-value';
      // MISSING_SECRET is not set

      const secretNames = ['FOUND_SECRET', 'MISSING_SECRET'];
      const result = await secretManager.getSecrets(secretNames);

      expect(result).toEqual({
        FOUND_SECRET: 'found-value',
        MISSING_SECRET: null
      });
    });

    test('should handle empty secret names array', async () => {
      const result = await secretManager.getSecrets([]);

      expect(result).toEqual({});
    });
  });

  describe('Cache Management', () => {
    beforeEach(() => {
      secretManager = new SecretManager({ secretSource: 'env' });
    });

    test('should clear cache correctly', async () => {
      process.env.CACHE_TEST = 'cached-value';

      // Populate cache
      await secretManager.getSecret('CACHE_TEST');
      expect(secretManager.cache.has('env:CACHE_TEST')).toBe(true);

      // Clear cache
      secretManager.clearCache();
      expect(secretManager.cache.size).toBe(0);
    });

    test('should not cache null values', async () => {
      const result = await secretManager.getSecret('MISSING_SECRET');

      expect(result).toBeNull();
      expect(secretManager.cache.has('env:MISSING_SECRET')).toBe(false);
    });
  });

  describe('Health Checks', () => {
    test('should report healthy status for environment source', async () => {
      secretManager = new SecretManager({ secretSource: 'env' });

      const health = await secretManager.healthCheck();

      expect(health).toEqual({
        source: 'env',
        status: 'healthy',
        details: {
          environment: 'accessible'
        }
      });
    });

    test('should report healthy status for AWS when authenticated', async () => {
      process.env.AWS_REGION = 'us-east-1';
      secretManager = new SecretManager({ secretSource: 'aws' });

      mockAWSSecretsClient.listSecrets.mockReturnValue({
        promise: () => Promise.resolve({ SecretList: [] })
      });

      const health = await secretManager.healthCheck();

      expect(health).toEqual({
        source: 'aws',
        status: 'healthy',
        details: {
          aws: 'authenticated'
        }
      });
      expect(mockAWSSecretsClient.listSecrets).toHaveBeenCalledWith({ MaxResults: 1 });
    });

    test('should report unhealthy status for AWS when authentication fails', async () => {
      process.env.AWS_REGION = 'us-east-1';
      secretManager = new SecretManager({ secretSource: 'aws' });

      mockAWSSecretsClient.listSecrets.mockReturnValue({
        promise: () => Promise.reject(new Error('InvalidAccessKeyId'))
      });

      const health = await secretManager.healthCheck();

      expect(health).toEqual({
        source: 'aws',
        status: 'unhealthy',
        details: {
          aws: 'authentication failed: InvalidAccessKeyId'
        }
      });
    });

    test('should report unhealthy status for AWS when client not initialized', async () => {
      secretManager = new SecretManager({ secretSource: 'aws' });
      secretManager.awsSecretsClient = null;

      const health = await secretManager.healthCheck();

      expect(health).toEqual({
        source: 'aws',
        status: 'unhealthy',
        details: {
          aws: 'client not initialized'
        }
      });
    });

    test('should report healthy status for Azure when authenticated', async () => {
      process.env.AZURE_KEY_VAULT_URL = 'https://test-vault.vault.azure.net/';
      secretManager = new SecretManager({ secretSource: 'azure' });

      mockAzureSecretClient.listPropertiesOfSecrets.mockReturnValue({
        next: () => Promise.resolve({ value: null, done: true })
      });

      const health = await secretManager.healthCheck();

      expect(health).toEqual({
        source: 'azure',
        status: 'healthy',
        details: {
          azure: 'authenticated'
        }
      });
    });

    test('should report unhealthy status for Azure when authentication fails', async () => {
      process.env.AZURE_KEY_VAULT_URL = 'https://test-vault.vault.azure.net/';
      secretManager = new SecretManager({ secretSource: 'azure' });

      mockAzureSecretClient.listPropertiesOfSecrets.mockReturnValue({
        next: () => Promise.reject(new Error('Forbidden'))
      });

      const health = await secretManager.healthCheck();

      expect(health).toEqual({
        source: 'azure',
        status: 'unhealthy',
        details: {
          azure: 'authentication failed: Forbidden'
        }
      });
    });

    test('should report unhealthy status for Azure when client not initialized', async () => {
      // We need to set up the environment to avoid the constructor error
      process.env.AZURE_KEY_VAULT_URL = 'https://test-vault.vault.azure.net/';
      secretManager = new SecretManager({ secretSource: 'azure' });
      // Then nullify the client after construction
      secretManager.azureSecretClient = null;

      const health = await secretManager.healthCheck();

      expect(health).toEqual({
        source: 'azure',
        status: 'unhealthy',
        details: {
          azure: 'client not initialized'
        }
      });
    });

    test('should handle unexpected errors in health check', async () => {
      secretManager = new SecretManager({ secretSource: 'env' });

      // Mock an unexpected error by setting invalid secret source
      secretManager.secretSource = 'invalid-source';

      const health = await secretManager.healthCheck();

      expect(health.status).toBe('unknown'); // The switch doesn't handle invalid sources, so status stays 'unknown'
      expect(health.source).toBe('invalid-source');
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unsupported secret source', async () => {
      secretManager = new SecretManager({ secretSource: 'unsupported' });

      const result = await secretManager.getSecret('test-secret');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        "Failed to retrieve secret 'test-secret' from unsupported:",
        'Unsupported secret source: unsupported'
      );
    });

    test('should return null for environment source when no fallback available', async () => {
      secretManager = new SecretManager({ secretSource: 'env' });

      const result = await secretManager.getSecret('NONEXISTENT_SECRET');

      expect(result).toBeNull();
      expect(console.error).not.toHaveBeenCalled(); // No error for env source
    });
  });

  describe('Static Utility Methods', () => {
    test('should mask sensitive fields in configuration', () => {
      const config = {
        server: 'test-server.com',
        user: 'testuser',
        password: 'supersecret',
        connectionString: 'server=test;password=secret',
        port: 1433,
        database: 'testdb'
      };

      const masked = SecretManager.maskSecrets(config);

      expect(masked).toEqual({
        server: 'test-server.com',
        user: '***MASKED***',
        password: '***MASKED***',
        connectionString: '***MASKED***',
        port: 1433,
        database: 'testdb'
      });

      // Ensure original object is not modified
      expect(config.password).toBe('supersecret');
    });

    test('should handle null/undefined values in masking', () => {
      const config = {
        user: null,
        password: undefined,
        server: 'test-server.com'
      };

      const masked = SecretManager.maskSecrets(config);

      expect(masked).toEqual({
        user: null,
        password: undefined,
        server: 'test-server.com'
      });
    });

    test('should handle non-string sensitive values in masking', () => {
      const config = {
        user: 'testuser',
        password: 12345, // numeric password
        server: 'test-server.com'
      };

      const masked = SecretManager.maskSecrets(config);

      expect(masked).toEqual({
        user: '***MASKED***',
        password: 12345, // non-string values are not masked
        server: 'test-server.com'
      });
    });
  });

  describe('Edge Cases and Integration Scenarios', () => {
    test('should handle AWS region precedence correctly', () => {
      process.env.AWS_REGION = 'us-west-1';

      // Config region should take precedence over environment
      secretManager = new SecretManager({
        secretSource: 'aws',
        awsRegion: 'us-east-2'
      });

      expect(AWS.SecretsManager).toHaveBeenCalledWith({
        region: 'us-east-2', // config takes precedence
        accessKeyId: undefined,
        secretAccessKey: undefined
      });
    });

    test('should handle Azure URL precedence correctly', () => {
      process.env.AZURE_KEY_VAULT_URL = 'https://env-vault.vault.azure.net/';

      // Config URL should take precedence over environment
      secretManager = new SecretManager({
        secretSource: 'azure',
        azureVaultUrl: 'https://config-vault.vault.azure.net/'
      });

      expect(SecretClient).toHaveBeenCalledWith(
        'https://config-vault.vault.azure.net/', // config takes precedence
        expect.any(Object)
      );
    });

    test('should handle very short cache expiration correctly', async () => {
      secretManager = new SecretManager({
        secretSource: 'env',
        cacheMaxAge: 1 // 1ms cache
      });

      process.env.SHORT_CACHE_SECRET = 'initial-value';

      // First call
      const result1 = await secretManager.getSecret('SHORT_CACHE_SECRET');

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 5));

      // Change value
      process.env.SHORT_CACHE_SECRET = 'updated-value';

      // Second call should get new value
      const result2 = await secretManager.getSecret('SHORT_CACHE_SECRET');

      expect(result1).toBe('initial-value');
      expect(result2).toBe('updated-value');
    });

    test('should handle concurrent secret requests correctly', async () => {
      process.env.CONCURRENT_SECRET = 'concurrent-value';
      secretManager = new SecretManager({ secretSource: 'env' });

      // Make multiple concurrent requests
      const promises = Array(10)
        .fill()
        .map(() => secretManager.getSecret('CONCURRENT_SECRET'));

      const results = await Promise.all(promises);

      // All should return the same value
      expect(results.every(result => result === 'concurrent-value')).toBe(true);

      // Should have only one cache entry
      expect(secretManager.cache.size).toBe(1);
    });
  });
});
