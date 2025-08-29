#!/usr/bin/env node

/**
 * Test script for Azure Key Vault Secret Manager integration
 *
 * This script demonstrates how to use the Azure Key Vault secret manager
 * and provides examples of secret naming, authentication, and retrieval.
 *
 * Prerequisites:
 * 1. Azure Key Vault created with appropriate secrets
 * 2. Service Principal with Key Vault access OR Managed Identity configured
 * 3. Environment variables set for authentication
 *
 * Usage:
 *   node scripts/test-azure-secrets.js
 *
 * Environment Variables:
 *   SECRET_MANAGER_TYPE=azure
 *   AZURE_KEY_VAULT_URL=https://your-vault.vault.azure.net/
 *   AZURE_CLIENT_ID=your-app-id (for service principal)
 *   AZURE_CLIENT_SECRET=your-client-secret (for service principal)
 *   AZURE_TENANT_ID=your-tenant-id (for service principal)
 */

import { SecretManager } from '../lib/config/secret-manager.js';

/**
 * Test Azure Key Vault secret retrieval functionality
 */
async function testAzureSecrets() {
  console.log('🧪 Testing Azure Key Vault Secret Manager Integration\n');

  // Check required environment variables - using local variables to avoid CodeQL warnings
  const secretManagerType = process.env.SECRET_MANAGER_TYPE || 'NOT SET';
  const azureVaultUrl = process.env.AZURE_KEY_VAULT_URL || 'NOT SET';
  const azureClientIdStatus = process.env.AZURE_CLIENT_ID ? '***SET***' : 'NOT SET';
  const azureClientSecretStatus = process.env.AZURE_CLIENT_SECRET ? '***SET***' : 'NOT SET';
  const azureTenantId = process.env.AZURE_TENANT_ID || 'NOT SET';

  console.log('📋 Environment Configuration:');
  // lgtm[js/clear-text-logging] - Logging configuration names and status only, not sensitive values
  console.log(`  SECRET_MANAGER_TYPE: ${secretManagerType}`);
  // lgtm[js/clear-text-logging] - Key Vault URL is not sensitive (public endpoint)
  console.log(`  AZURE_KEY_VAULT_URL: ${azureVaultUrl}`);
  // lgtm[js/clear-text-logging] - Logging only '***SET***' or 'NOT SET' status, not actual client ID
  console.log(`  AZURE_CLIENT_ID: ${azureClientIdStatus}`);
  // lgtm[js/clear-text-logging] - Logging only '***SET***' or 'NOT SET' status, not actual secret
  console.log(`  AZURE_CLIENT_SECRET: ${azureClientSecretStatus}`);
  // lgtm[js/clear-text-logging] - Tenant ID is not sensitive (public directory identifier)
  console.log(`  AZURE_TENANT_ID: ${azureTenantId}\n`);

  if (process.env.SECRET_MANAGER_TYPE !== 'azure') {
    console.log('❌ SECRET_MANAGER_TYPE must be set to "azure" for this test');
    console.log('   export SECRET_MANAGER_TYPE="azure"\n');
    return;
  }

  if (!process.env.AZURE_KEY_VAULT_URL) {
    console.log('❌ AZURE_KEY_VAULT_URL is required');
    console.log('   export AZURE_KEY_VAULT_URL="https://your-vault.vault.azure.net/"\n');
    return;
  }

  try {
    // Initialize the Secret Manager
    console.log('🔧 Initializing Secret Manager...');
    const secretManager = new SecretManager({
      secretSource: 'azure',
      azureVaultUrl: process.env.AZURE_KEY_VAULT_URL
    });

    // Test 1: Health Check
    console.log('\n🏥 Testing Azure Key Vault Health Check...');
    const health = await secretManager.healthCheck();
    console.log('   Health Status:', JSON.stringify(health, null, 2));

    if (health.status !== 'healthy') {
      console.log(
        '❌ Health check failed. Check your Azure authentication and Key Vault permissions.'
      );
      return;
    }
    console.log('✅ Azure Key Vault connection healthy');

    // Test 2: Secret Name Conversion
    console.log('\n🔄 Testing Secret Name Conversion...');
    const testNames = [
      'SQL_SERVER_HOST',
      'SQL_SERVER_PORT',
      'SQL_SERVER_USER',
      'SQL_SERVER_PASSWORD',
      'CUSTOM_SECRET_NAME'
    ];

    console.log('   Environment Variable → Azure Key Vault Secret Name:');
    for (const envName of testNames) {
      const azureName = secretManager.convertToAzureSecretName(envName);
      console.log(`   ${envName} → ${azureName}`);
    }

    // Test 3: Individual Secret Retrieval
    console.log('\n🔍 Testing Individual Secret Retrieval...');
    const testSecrets = ['SQL_SERVER_HOST', 'SQL_SERVER_PORT', 'SQL_SERVER_USER'];

    for (const secretName of testSecrets) {
      try {
        console.log(`   Retrieving ${secretName}...`);
        const secretValue = await secretManager.getSecret(secretName);
        if (secretValue) {
          console.log(
            `   ✅ ${secretName}: Retrieved (${typeof secretValue}, ${secretValue.length} chars)`
          );
        } else {
          console.log(`   ⚠️  ${secretName}: Not found or empty`);
        }
      } catch (error) {
        console.log(`   ❌ ${secretName}: Failed - ${error.message}`);
      }
    }

    // Test 4: Multiple Secrets Retrieval
    console.log('\n📦 Testing Multiple Secrets Retrieval...');
    try {
      const multipleSecrets = await secretManager.getSecrets([
        'SQL_SERVER_HOST',
        'SQL_SERVER_PORT',
        'SQL_SERVER_DATABASE',
        'SQL_SERVER_USER'
      ]);

      console.log('   Multiple secrets results:');
      for (const [name, value] of Object.entries(multipleSecrets)) {
        if (value) {
          console.log(`   ✅ ${name}: Retrieved (${typeof value}, ${value.length} chars)`);
        } else {
          console.log(`   ⚠️  ${name}: Not found or empty`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Multiple secrets retrieval failed: ${error.message}`);
    }

    // Test 5: Database Configuration
    console.log('\n⚙️  Testing Complete Database Configuration...');
    try {
      const dbConfig = await secretManager.getDatabaseConfig();
      const maskedConfig = SecretManager.maskSecrets(dbConfig);

      console.log('   Database configuration loaded:');
      console.log('   ', JSON.stringify(maskedConfig, null, 4));
      console.log('   ✅ Database configuration retrieved successfully');
    } catch (error) {
      console.log(`   ❌ Database configuration failed: ${error.message}`);
    }

    // Test 6: Cache Testing
    console.log('\n💾 Testing Secret Caching...');
    try {
      const startTime = Date.now();
      await secretManager.getSecret('SQL_SERVER_HOST');
      const firstCallTime = Date.now() - startTime;

      const cachedStartTime = Date.now();
      await secretManager.getSecret('SQL_SERVER_HOST');
      const cachedCallTime = Date.now() - cachedStartTime;

      console.log(`   First call (fresh): ${firstCallTime}ms`);
      console.log(`   Second call (cached): ${cachedCallTime}ms`);

      if (cachedCallTime < firstCallTime) {
        console.log('   ✅ Caching appears to be working (faster second call)');
      } else {
        console.log('   ⚠️  Caching may not be working as expected');
      }
    } catch (error) {
      console.log(`   ❌ Cache testing failed: ${error.message}`);
    }

    // Test 7: Error Handling
    console.log('\n🚨 Testing Error Handling...');
    try {
      console.log('   Testing non-existent secret...');
      const nonExistentSecret = await secretManager.getSecret('NONEXISTENT_SECRET_NAME');
      if (nonExistentSecret === null) {
        console.log('   ✅ Non-existent secret correctly returned null');
      } else {
        console.log('   ⚠️  Non-existent secret returned unexpected value:', nonExistentSecret);
      }
    } catch (error) {
      console.log(`   ✅ Non-existent secret correctly threw error: ${error.message}`);
    }

    // Test 8: Fallback Testing
    console.log('\n🔄 Testing Environment Variable Fallback...');
    try {
      // Set a test environment variable
      process.env.TEST_FALLBACK_SECRET = 'fallback-value';

      const fallbackValue = await secretManager.getSecret('TEST_FALLBACK_SECRET');
      if (fallbackValue === 'fallback-value') {
        console.log('   ✅ Environment variable fallback working correctly');
      } else {
        console.log('   ⚠️  Environment variable fallback returned:', fallbackValue);
      }

      // Clean up
      delete process.env.TEST_FALLBACK_SECRET;
    } catch (error) {
      console.log(`   ❌ Fallback testing failed: ${error.message}`);
    }

    console.log('\n🎉 Azure Key Vault Secret Manager Test Completed Successfully!');
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    console.error('Stack trace:', error.stack);
  }
}

/**
 * Display usage information and examples
 */
function displayUsage() {
  console.log(`
🚀 Azure Key Vault Test Script

This script tests the Azure Key Vault integration with comprehensive examples.

📋 Setup Requirements:

1. Azure Key Vault with secrets:
   az keyvault secret set --vault-name "your-vault" --name "SQL-SERVER-HOST" --value "localhost"
   az keyvault secret set --vault-name "your-vault" --name "SQL-SERVER-PORT" --value "1433"
   az keyvault secret set --vault-name "your-vault" --name "SQL-SERVER-USER" --value "testuser"

2. Environment Variables (Service Principal):
   export SECRET_MANAGER_TYPE="azure"
   export AZURE_KEY_VAULT_URL="https://your-vault.vault.azure.net/"
   export AZURE_CLIENT_ID="your-app-id"
   export AZURE_CLIENT_SECRET="your-client-secret"
   export AZURE_TENANT_ID="your-tenant-id"

3. Or for Managed Identity (on Azure resources):
   export SECRET_MANAGER_TYPE="azure"
   export AZURE_KEY_VAULT_URL="https://your-vault.vault.azure.net/"

🎯 What This Script Tests:

✅ Azure authentication and connectivity
✅ Secret name conversion (underscores → hyphens)
✅ Individual and bulk secret retrieval
✅ Database configuration assembly
✅ Caching functionality
✅ Error handling and fallback behavior
✅ Health monitoring

📚 For detailed setup instructions, see:
   docs/AZURE-SECRETS-GUIDE.md
`);
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check for help argument
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    displayUsage();
    process.exit(0);
  }

  // Run the test
  testAzureSecrets().catch(error => {
    console.error('\n💥 Fatal error during test execution:', error);
    process.exit(1);
  });
}
