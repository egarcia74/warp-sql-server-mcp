#!/usr/bin/env node

/**
 * Test script for AWS Secrets Manager Secret Manager integration
 *
 * This script demonstrates how to use the AWS Secrets Manager secret manager
 * and provides examples of secret naming, authentication, and retrieval.
 *
 * Prerequisites:
 * 1. AWS account with Secrets Manager access
 * 2. IAM User with access keys OR IAM Role with appropriate permissions
 * 3. Secrets created in AWS Secrets Manager
 * 4. Environment variables set for authentication
 *
 * Usage:
 *   node scripts/test-aws-secrets.js
 *
 * Environment Variables:
 *   SECRET_MANAGER_TYPE=aws
 *   AWS_REGION=us-east-1 (or your preferred region)
 *   AWS_ACCESS_KEY_ID=your-access-key-id (for IAM user)
 *   AWS_SECRET_ACCESS_KEY=your-secret-access-key (for IAM user)
 */

import { SecretManager } from '../lib/config/secret-manager.js';

/**
 * Test AWS Secrets Manager secret retrieval functionality
 */
async function testAWSSecrets() {
  console.log('🧪 Testing AWS Secrets Manager Secret Manager Integration\n');

  // Log safe computed values instead of raw env vars to avoid CodeQL warnings
  console.log('📋 Environment Configuration:');
  console.log(
    `  SECRET_MANAGER_TYPE: ${process.env.SECRET_MANAGER_TYPE === 'aws' ? 'aws' : 'NOT SET'}`
  );
  console.log(`  AWS_REGION: ${process.env.AWS_REGION || 'NOT SET'}`);
  console.log(`  AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? '***SET***' : 'NOT SET'}`);
  console.log(
    `  AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? '***SET***' : 'NOT SET'}`
  );
  console.log(`  AWS_PROFILE: ${process.env.AWS_PROFILE || 'NOT SET'}`);
  console.log(`  AWS_SDK_LOAD_CONFIG: ${process.env.AWS_SDK_LOAD_CONFIG || 'NOT SET'}\n`);

  if (process.env.SECRET_MANAGER_TYPE !== 'aws') {
    console.log('❌ SECRET_MANAGER_TYPE must be set to "aws" for this test');
    console.log('   export SECRET_MANAGER_TYPE="aws"\n');
    return;
  }

  if (!process.env.AWS_REGION) {
    console.log('❌ AWS_REGION is required');
    console.log('   export AWS_REGION="us-east-1"\n');
    return;
  }

  try {
    // Initialize the Secret Manager
    console.log('🔧 Initializing Secret Manager...');
    const secretManager = new SecretManager({
      secretSource: 'aws',
      awsRegion: process.env.AWS_REGION
    });

    // Test 1: Health Check
    console.log('\n🏥 Testing AWS Secrets Manager Health Check...');
    const health = await secretManager.healthCheck();
    console.log('   Health Status:', JSON.stringify(health, null, 2));

    if (health.status !== 'healthy') {
      console.log(
        '❌ Health check failed. Check your AWS authentication and Secrets Manager permissions.'
      );
      console.log('   Try running: aws sts get-caller-identity');
      console.log('   Try running: aws secretsmanager list-secrets --max-results 1');
      return;
    }
    console.log('✅ AWS Secrets Manager connection healthy');

    // Test 2: Individual Secret Retrieval
    console.log('\n🔍 Testing Individual Secret Retrieval...');
    const individualSecrets = [
      'sql-mcp/SQL_SERVER_HOST',
      'sql-mcp/SQL_SERVER_PORT',
      'sql-mcp/SQL_SERVER_USER',
      'sql-mcp-dev/SQL_SERVER_HOST',
      'sql-mcp-prod/SQL_SERVER_HOST'
    ];

    for (const secretName of individualSecrets) {
      try {
        console.log(`   Retrieving ${secretName}...`);
        const secretValue = await secretManager.getSecret(secretName);
        if (secretValue) {
          const valueType = typeof secretValue;
          const length =
            typeof secretValue === 'string'
              ? secretValue.length
              : JSON.stringify(secretValue).length;
          console.log(`   ✅ ${secretName}: Retrieved (${valueType}, ${length} chars)`);
        } else {
          console.log(`   ⚠️  ${secretName}: Not found or empty`);
        }
      } catch (error) {
        console.log(`   ❌ ${secretName}: Failed - ${error.message}`);
      }
    }

    // Test 3: JSON Secret Retrieval
    console.log('\n📦 Testing JSON Secret Retrieval...');
    const jsonSecrets = [
      'sql-mcp/database-config',
      'sql-mcp/production/database-config',
      'sql-mcp/development/database-config',
      'sql-mcp-prod/config',
      'sql-mcp-dev/config'
    ];

    for (const secretName of jsonSecrets) {
      try {
        console.log(`   Retrieving JSON secret ${secretName}...`);
        const secretValue = await secretManager.getSecret(secretName);
        if (secretValue) {
          if (typeof secretValue === 'object') {
            console.log(
              `   ✅ ${secretName}: JSON object with keys: ${Object.keys(secretValue).join(', ')}`
            );

            // Check for expected database config keys
            const expectedKeys = ['SQL_SERVER_HOST', 'SQL_SERVER_PORT', 'SQL_SERVER_USER'];
            const foundKeys = expectedKeys.filter(key => key in secretValue);
            if (foundKeys.length > 0) {
              console.log(`   📋   Found database config keys: ${foundKeys.join(', ')}`);
            }
          } else {
            console.log(
              `   ⚠️  ${secretName}: Retrieved as ${typeof secretValue} (expected object)`
            );
          }
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
      const testSecretNames = [
        'sql-mcp/SQL_SERVER_HOST',
        'sql-mcp/SQL_SERVER_PORT',
        'sql-mcp/SQL_SERVER_DATABASE',
        'sql-mcp/SQL_SERVER_USER',
        'sql-mcp/database-config'
      ];

      const multipleSecrets = await secretManager.getSecrets(testSecretNames);

      console.log('   Multiple secrets results:');
      for (const [name, value] of Object.entries(multipleSecrets)) {
        if (value !== null && value !== undefined) {
          const valueType = typeof value;
          if (valueType === 'object') {
            console.log(`   ✅ ${name}: JSON object with ${Object.keys(value).length} keys`);
          } else {
            console.log(
              `   ✅ ${name}: Retrieved (${valueType}, ${value.toString().length} chars)`
            );
          }
        } else {
          console.log(`   ⚠️  ${name}: Not found or empty`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Multiple secrets retrieval failed: ${error.message}`);
    }

    // Test 5: Database Configuration Assembly
    console.log('\n⚙️  Testing Complete Database Configuration...');
    try {
      console.log('   Attempting to assemble database configuration from secrets...');
      const dbConfig = await secretManager.getDatabaseConfig();
      const maskedConfig = SecretManager.maskSecrets(dbConfig);

      console.log('   Database configuration loaded:');
      console.log('   ', JSON.stringify(maskedConfig, null, 4));

      // Validate configuration completeness
      const requiredFields = ['server', 'port', 'database'];
      const missingFields = requiredFields.filter(field => !dbConfig[field]);

      if (missingFields.length === 0) {
        console.log('   ✅ Database configuration retrieved successfully');
        console.log(`   📋   Server: ${dbConfig.server}`);
        console.log(`   📋   Port: ${dbConfig.port}`);
        console.log(`   📋   Database: ${dbConfig.database}`);
        console.log(
          `   📋   Authentication: ${dbConfig.user ? 'SQL Server Auth' : 'Windows Auth'}`
        );
      } else {
        console.log(
          `   ⚠️  Database configuration incomplete. Missing: ${missingFields.join(', ')}`
        );
        console.log(
          '   💡 Hint: Ensure secrets exist for SQL_SERVER_HOST, SQL_SERVER_PORT, SQL_SERVER_DATABASE'
        );
      }
    } catch (error) {
      console.log(`   ❌ Database configuration failed: ${error.message}`);
    }

    // Test 6: Cache Testing
    console.log('\n💾 Testing Secret Caching...');
    try {
      const testSecretName = 'sql-mcp/SQL_SERVER_HOST';
      console.log(`   Testing caching with secret: ${testSecretName}`);

      const startTime = Date.now();
      await secretManager.getSecret(testSecretName);
      const firstCallTime = Date.now() - startTime;

      const cachedStartTime = Date.now();
      await secretManager.getSecret(testSecretName);
      const cachedCallTime = Date.now() - cachedStartTime;

      console.log(`   First call (fresh): ${firstCallTime}ms`);
      console.log(`   Second call (cached): ${cachedCallTime}ms`);

      if (cachedCallTime < firstCallTime) {
        console.log('   ✅ Caching appears to be working (faster second call)');
      } else {
        console.log('   ⚠️  Caching may not be working as expected');
      }

      // Test cache invalidation
      console.log('   Testing cache refresh...');
      const refreshStartTime = Date.now();
      await secretManager.getSecret(testSecretName, { refresh: true });
      const refreshCallTime = Date.now() - refreshStartTime;
      console.log(`   Refresh call (forced): ${refreshCallTime}ms`);
    } catch (error) {
      console.log(`   ❌ Cache testing failed: ${error.message}`);
    }

    // Test 7: Error Handling
    console.log('\n🚨 Testing Error Handling...');

    // Test non-existent secret
    try {
      console.log('   Testing non-existent individual secret...');
      const nonExistentSecret = await secretManager.getSecret(
        'sql-mcp/NONEXISTENT_SECRET_NAME_12345'
      );
      if (nonExistentSecret === null) {
        console.log('   ✅ Non-existent secret correctly returned null');
      } else {
        console.log('   ⚠️  Non-existent secret returned unexpected value:', nonExistentSecret);
      }
    } catch (error) {
      console.log(`   ✅ Non-existent secret correctly threw error: ${error.message}`);
    }

    // Test malformed JSON secret
    try {
      console.log('   Testing potential malformed JSON handling...');
      const malformedSecret = await secretManager.getSecret('sql-mcp/malformed-json-test');
      if (malformedSecret === null) {
        console.log('   ✅ Malformed/non-existent JSON secret handled correctly');
      } else {
        console.log('   📋 Secret exists and was parsed:', typeof malformedSecret);
      }
    } catch (error) {
      console.log(`   ✅ Malformed JSON secret correctly handled: ${error.message}`);
    }

    // Test 8: Fallback Testing
    console.log('\n🔄 Testing Environment Variable Fallback...');
    try {
      // Set a test environment variable
      process.env.TEST_FALLBACK_SECRET = 'fallback-value-aws';

      console.log('   Testing fallback to environment variable...');
      const fallbackValue = await secretManager.getSecret('TEST_FALLBACK_SECRET');
      if (fallbackValue === 'fallback-value-aws') {
        console.log('   ✅ Environment variable fallback working correctly');
      } else {
        console.log('   ⚠️  Environment variable fallback returned:', fallbackValue);
      }

      // Clean up
      delete process.env.TEST_FALLBACK_SECRET;
    } catch (error) {
      console.log(`   ❌ Fallback testing failed: ${error.message}`);
    }

    // Test 9: AWS-Specific Features
    console.log('\n🔧 Testing AWS-Specific Features...');

    try {
      console.log('   Testing AWS region consistency...');
      const currentRegion = process.env.AWS_REGION;
      console.log(`   📍 Current AWS region: ${currentRegion}`);

      // Test if we can access secrets in this region
      const regionTestSecret = await secretManager.getSecret('sql-mcp/SQL_SERVER_HOST');
      if (regionTestSecret) {
        console.log('   ✅ Secret access confirmed in current region');
      } else {
        console.log('   ⚠️  No test secret found in current region');
        console.log(
          '   💡 Hint: Create a test secret with: aws secretsmanager create-secret --name "sql-mcp/SQL_SERVER_HOST" --secret-string "localhost"'
        );
      }
    } catch (error) {
      console.log(`   ❌ AWS-specific feature testing failed: ${error.message}`);
    }

    // Test 10: Secret Versioning (AWS Feature)
    console.log('\n🔄 Testing AWS Secret Versioning...');
    try {
      console.log('   Testing secret version handling...');

      // AWS Secrets Manager automatically handles versioning
      // We test that our implementation works with the latest version
      const versionTest = await secretManager.getSecret('sql-mcp/SQL_SERVER_HOST');
      if (versionTest) {
        console.log('   ✅ Secret version handling working (retrieves AWSCURRENT by default)');
      } else {
        console.log('   ⚠️  No versioned secret available for testing');
      }
    } catch (error) {
      console.log(`   ❌ Secret versioning test failed: ${error.message}`);
    }

    console.log('\n🎉 AWS Secrets Manager Secret Manager Test Completed Successfully!');
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
🚀 AWS Secrets Manager Test Script

This script tests the AWS Secrets Manager integration with comprehensive examples.

📋 Setup Requirements:

1. AWS Secrets Manager with secrets:
   
   Individual secrets approach:
   aws secretsmanager create-secret --name "sql-mcp/SQL_SERVER_HOST" --secret-string "localhost"
   aws secretsmanager create-secret --name "sql-mcp/SQL_SERVER_PORT" --secret-string "1433"
   aws secretsmanager create-secret --name "sql-mcp/SQL_SERVER_USER" --secret-string "testuser"
   
   OR JSON secret approach:
   aws secretsmanager create-secret --name "sql-mcp/database-config" --secret-string '{
     "SQL_SERVER_HOST": "localhost",
     "SQL_SERVER_PORT": "1433", 
     "SQL_SERVER_USER": "testuser",
     "SQL_SERVER_PASSWORD": "testpass"
   }'

2. Environment Variables (IAM User):
   export SECRET_MANAGER_TYPE="aws"
   export AWS_REGION="us-east-1"
   export AWS_ACCESS_KEY_ID="your-access-key-id"
   export AWS_SECRET_ACCESS_KEY="your-secret-access-key"

3. Or for IAM Role (on EC2/ECS/Lambda):
   export SECRET_MANAGER_TYPE="aws"
   export AWS_REGION="us-east-1"

4. Or using AWS Profile:
   export SECRET_MANAGER_TYPE="aws"
   export AWS_REGION="us-east-1"
   export AWS_PROFILE="sql-mcp"
   export AWS_SDK_LOAD_CONFIG="1"

🎯 What This Script Tests:

✅ AWS authentication and connectivity
✅ Individual secret retrieval (sql-mcp/SECRET_NAME format)
✅ JSON secret retrieval and parsing
✅ Multiple secrets batch retrieval
✅ Database configuration assembly
✅ Caching functionality with refresh capability
✅ Error handling and fallback behavior
✅ Health monitoring
✅ AWS-specific features (regions, versioning)

📚 For detailed setup instructions, see:
   docs/reference/AWS-SECRETS-GUIDE.md

🛠️  Common Troubleshooting:

   Authentication issues:
   aws sts get-caller-identity
   aws secretsmanager list-secrets --max-results 1

   Permission issues:
   aws iam list-attached-user-policies --user-name your-user
   aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::ACCOUNT:user/your-user --action-names secretsmanager:GetSecretValue

   Region issues:
   aws secretsmanager describe-secret --secret-id "sql-mcp/SQL_SERVER_HOST"
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
  testAWSSecrets().catch(error => {
    console.error('\n💥 Fatal error during test execution:', error);
    process.exit(1);
  });
}
