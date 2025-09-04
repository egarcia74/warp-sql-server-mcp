# AWS Secrets Manager Configuration Guide

This guide provides comprehensive instructions for configuring AWS Secrets Manager with the Warp SQL Server MCP project.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [AWS Secrets Manager Setup](#aws-secrets-manager-setup)
3. [Authentication Configuration](#authentication-configuration)
4. [Secret Storage Strategies](#secret-storage-strategies)
5. [Environment Variables](#environment-variables)
6. [Complete Configuration Examples](#complete-configuration-examples)
7. [Testing and Validation](#testing-and-validation)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:

- **AWS Account** with appropriate permissions
- **AWS CLI** installed and configured (`aws cli`)
- **IAM User/Role** with Secrets Manager permissions
- **Node.js 18+** and the MCP project dependencies installed
- **AWS SDK credentials** configured

> **📖 Environment Variables Reference**: For complete documentation of all environment variables, defaults, and configuration options, see **[ENV-VARS.md](ENV-VARS.md)**.

## AWS Secrets Manager Setup

### 1. Create Secrets Using AWS CLI

AWS Secrets Manager supports both **individual secrets** and **JSON-structured secrets**. The MCP server supports both approaches.

#### Option A: Individual Secrets (Simple Approach)

```bash
# Create individual secrets for each configuration value
aws secretsmanager create-secret \
    --name "sql-mcp/SQL_SERVER_HOST" \
    --description "SQL Server hostname for MCP" \
    --secret-string "your-sql-server.database.windows.net"

aws secretsmanager create-secret \
    --name "sql-mcp/SQL_SERVER_PORT" \
    --description "SQL Server port for MCP" \
    --secret-string "1433"

aws secretsmanager create-secret \
    --name "sql-mcp/SQL_SERVER_DATABASE" \
    --description "SQL Server database name for MCP" \
    --secret-string "your-database-name"

aws secretsmanager create-secret \
    --name "sql-mcp/SQL_SERVER_USER" \
    --description "SQL Server username for MCP" \
    --secret-string "your-sql-username"

aws secretsmanager create-secret \
    --name "sql-mcp/SQL_SERVER_PASSWORD" \
    --description "SQL Server password for MCP" \
    --secret-string "your-secure-password"
```

#### Option B: Structured JSON Secret (Recommended for Production)

```bash
# Create a single secret with all database configuration
aws secretsmanager create-secret \
    --name "sql-mcp/database-config" \
    --description "Complete SQL Server configuration for MCP" \
    --secret-string '{
        "SQL_SERVER_HOST": "your-sql-server.database.windows.net",
        "SQL_SERVER_PORT": "1433",
        "SQL_SERVER_DATABASE": "your-database-name",
        "SQL_SERVER_USER": "your-sql-username",
        "SQL_SERVER_PASSWORD": "your-secure-password",
        "SQL_SERVER_ENCRYPT": "true",
        "SQL_SERVER_TRUST_CERT": "false",
        "SQL_SERVER_READ_ONLY": "true"
    }'
```

### 2. Secret Naming Strategies

#### Individual Secrets Approach

Use a consistent naming pattern with prefixes:

```bash
# Production environment
sql-mcp-prod/SQL_SERVER_HOST
sql-mcp-prod/SQL_SERVER_PORT
sql-mcp-prod/SQL_SERVER_USER
sql-mcp-prod/SQL_SERVER_PASSWORD

# Development environment
sql-mcp-dev/SQL_SERVER_HOST
sql-mcp-dev/SQL_SERVER_PORT
sql-mcp-dev/SQL_SERVER_USER
sql-mcp-dev/SQL_SERVER_PASSWORD
```

#### Structured JSON Approach

Use environment-specific secret names:

```bash
# Production
sql-mcp/production/database-config

# Development
sql-mcp/development/database-config

# Staging
sql-mcp/staging/database-config
```

### 3. Set Up Resource-Based Policies (Optional)

For additional security, you can set resource-based policies:

```bash
# Create policy document
cat > secret-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnableMCPAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT-ID:role/sql-mcp-role"
      },
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "secretsmanager:ResourceTag/Project": "sql-mcp"
        }
      }
    }
  ]
}
EOF

# Apply policy to secret
aws secretsmanager put-resource-policy \
    --secret-id "sql-mcp/database-config" \
    --resource-policy file://secret-policy.json
```

## Authentication Configuration

### Option 1: IAM User with Access Keys (Development)

#### 1.1 Create IAM User

```bash
# Create IAM user
aws iam create-user --user-name sql-mcp-user

# Create access keys
aws iam create-access-key --user-name sql-mcp-user
```

#### 1.2 Create IAM Policy

```bash
# Create policy document
cat > sql-mcp-secrets-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "SecretsManagerAccess",
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": [
                "arn:aws:secretsmanager:*:*:secret:sql-mcp/*",
                "arn:aws:secretsmanager:*:*:secret:sql-mcp-*"
            ]
        },
        {
            "Sid": "SecretsManagerList",
            "Effect": "Allow",
            "Action": [
                "secretsmanager:ListSecrets"
            ],
            "Resource": "*"
        }
    ]
}
EOF

# Create policy
aws iam create-policy \
    --policy-name SQLMCPSecretsManagerPolicy \
    --policy-document file://sql-mcp-secrets-policy.json

# Attach policy to user
aws iam attach-user-policy \
    --user-name sql-mcp-user \
    --policy-arn arn:aws:iam::ACCOUNT-ID:policy/SQLMCPSecretsManagerPolicy
```

#### 1.3 Configure Environment Variables

```bash
# AWS credentials (from access key creation)
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export AWS_REGION="us-east-1"

# Secret Manager configuration
export SECRET_MANAGER_TYPE="aws"
```

### Option 2: IAM Role (Production - EC2/ECS/Lambda)

#### 2.1 Create IAM Role

```bash
# Create trust policy for EC2
cat > trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "ec2.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF

# Create role
aws iam create-role \
    --role-name sql-mcp-role \
    --assume-role-policy-document file://trust-policy.json

# Attach the secrets policy
aws iam attach-role-policy \
    --role-name sql-mcp-role \
    --policy-arn arn:aws:iam::ACCOUNT-ID:policy/SQLMCPSecretsManagerPolicy

# Create instance profile
aws iam create-instance-profile --instance-profile-name sql-mcp-profile
aws iam add-role-to-instance-profile \
    --instance-profile-name sql-mcp-profile \
    --role-name sql-mcp-role
```

#### 2.2 Launch EC2 with Role

```bash
# Launch EC2 instance with IAM role
aws ec2 run-instances \
    --image-id ami-0c02fb55956c7d316 \
    --instance-type t3.micro \
    --iam-instance-profile Name=sql-mcp-profile \
    --security-group-ids sg-your-security-group \
    --subnet-id subnet-your-subnet
```

#### 2.3 Configure Environment Variables (No AWS Credentials Needed)

```bash
# Only need these for IAM role
export AWS_REGION="us-east-1"
export SECRET_MANAGER_TYPE="aws"
```

### Option 3: Cross-Account Role Access

For enterprise environments with multiple AWS accounts:

```bash
# Create cross-account trust policy
cat > cross-account-trust.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::TRUSTED-ACCOUNT-ID:root"
            },
            "Action": "sts:AssumeRole",
            "Condition": {
                "StringEquals": {
                    "sts:ExternalId": "sql-mcp-external-id"
                }
            }
        }
    ]
}
EOF

# Create cross-account role
aws iam create-role \
    --role-name sql-mcp-cross-account-role \
    --assume-role-policy-document file://cross-account-trust.json
```

## Secret Storage Strategies

### Strategy 1: Individual Secrets per Environment Variable

**Best for:** Simple configurations, granular access control

```javascript
// How the MCP server accesses individual secrets
const host = await secretManager.getSecret('sql-mcp/SQL_SERVER_HOST');
const port = await secretManager.getSecret('sql-mcp/SQL_SERVER_PORT');
const user = await secretManager.getSecret('sql-mcp/SQL_SERVER_USER');
```

**Environment Configuration:**

```bash
export SECRET_MANAGER_TYPE="aws"
export AWS_REGION="us-east-1"
# Individual secrets will be automatically retrieved
```

### Strategy 2: Structured JSON Secrets

**Best for:** Production environments, atomic updates, reduced API calls

```javascript
// How the MCP server accesses JSON secrets
const secretData = await secretManager.getSecret('sql-mcp/database-config');
// secretData is automatically parsed as JSON object
const host = secretData.SQL_SERVER_HOST;
const port = secretData.SQL_SERVER_PORT;
```

**JSON Secret Structure:**

```json
{
  "SQL_SERVER_HOST": "prod-sql.database.windows.net",
  "SQL_SERVER_PORT": "1433",
  "SQL_SERVER_DATABASE": "ProductionDB",
  "SQL_SERVER_USER": "prod_user",
  "SQL_SERVER_PASSWORD": "secure-password-123",
  "SQL_SERVER_ENCRYPT": "true",
  "SQL_SERVER_TRUST_CERT": "false",
  "SQL_SERVER_READ_ONLY": "true",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "false",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
}
```

### Strategy 3: Hierarchical Secrets with Environments

**Best for:** Multi-environment deployments

```bash
# Production secrets
sql-mcp/prod/database-config
sql-mcp/prod/logging-config
sql-mcp/prod/performance-config

# Development secrets
sql-mcp/dev/database-config
sql-mcp/dev/logging-config
sql-mcp/dev/performance-config
```

## Environment Variables

### Required Configuration

```bash
# Secret management type (REQUIRED)
export SECRET_MANAGER_TYPE="aws"

# AWS region (REQUIRED)
export AWS_REGION="us-east-1"  # or your preferred region
```

### Authentication Variables (Method Dependent)

#### For IAM User (Development)

```bash
# Required for IAM user authentication
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
```

#### For IAM Role (Production)

```bash
# No additional credentials needed - role provides access
# AWS SDK automatically uses EC2/ECS/Lambda role
```

#### For Cross-Account Access

```bash
# For assuming cross-account roles
export AWS_ROLE_ARN="arn:aws:iam::ACCOUNT:role/sql-mcp-role"
export AWS_EXTERNAL_ID="sql-mcp-external-id"
```

### Optional Configuration

```bash
# Caching settings (optional)
export SECRET_CACHE_MAX_AGE="300000"  # 5 minutes in milliseconds

# AWS SDK configuration (optional)
export AWS_SDK_LOAD_CONFIG="1"       # Load from ~/.aws/config
export AWS_PROFILE="sql-mcp"         # Use specific AWS profile

# Logging (optional)
export LOG_LEVEL="info"               # debug, info, warn, error
```

## Complete Configuration Examples

### Example 1: Production with IAM Role and JSON Secret

```bash
#!/bin/bash
# production-aws-setup.sh

# AWS configuration (IAM role provides credentials)
export AWS_REGION="us-east-1"
export SECRET_MANAGER_TYPE="aws"

# Secret configuration - using structured JSON secret
export AWS_SECRET_NAME="sql-mcp/production/database-config"

# Optional: Performance and logging
export SECRET_CACHE_MAX_AGE="600000"  # 10 minutes
export LOG_LEVEL="warn"

# Start the MCP server
npm start
```

**Corresponding AWS Secret:**

```bash
aws secretsmanager create-secret \
    --name "sql-mcp/production/database-config" \
    --description "Production SQL Server configuration" \
    --secret-string '{
        "SQL_SERVER_HOST": "prod-sql.database.windows.net",
        "SQL_SERVER_PORT": "1433",
        "SQL_SERVER_DATABASE": "ProductionDB",
        "SQL_SERVER_USER": "prod_readonly_user",
        "SQL_SERVER_PASSWORD": "ultra-secure-prod-password",
        "SQL_SERVER_ENCRYPT": "true",
        "SQL_SERVER_TRUST_CERT": "false",
        "SQL_SERVER_READ_ONLY": "true"
    }'
```

### Example 2: Development with IAM User and Individual Secrets

```bash
#!/bin/bash
# dev-aws-setup.sh

# AWS authentication (IAM user)
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="secret-key"
export AWS_REGION="us-west-2"

# Secret Manager configuration
export SECRET_MANAGER_TYPE="aws"

# Development settings
export LOG_LEVEL="debug"
export SECRET_CACHE_MAX_AGE="60000"  # 1 minute for development

# Start in development mode
npm run dev
```

**Create Development Secrets:**

```bash
# Development individual secrets
aws secretsmanager create-secret \
    --region us-west-2 \
    --name "sql-mcp-dev/SQL_SERVER_HOST" \
    --secret-string "localhost"

aws secretsmanager create-secret \
    --region us-west-2 \
    --name "sql-mcp-dev/SQL_SERVER_USER" \
    --secret-string "dev_user"

aws secretsmanager create-secret \
    --region us-west-2 \
    --name "sql-mcp-dev/SQL_SERVER_PASSWORD" \
    --secret-string "dev-password-123"
```

### Example 3: Docker Container with IAM Role

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY . .
RUN npm ci --production

# Environment variables will be provided at runtime
EXPOSE 3000

CMD ["npm", "start"]
```

```bash
# Run container on EC2 with IAM role
docker run -d \
  --name sql-mcp \
  -e SECRET_MANAGER_TYPE="aws" \
  -e AWS_REGION="us-east-1" \
  -e LOG_LEVEL="info" \
  your-registry/sql-mcp:latest
```

### Example 4: ECS Task Definition

```json
{
  "family": "sql-mcp-task",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/sql-mcp-task-role",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/sql-mcp-execution-role",
  "containerDefinitions": [
    {
      "name": "sql-mcp",
      "image": "your-registry/sql-mcp:latest",
      "memory": 512,
      "cpu": 256,
      "essential": true,
      "environment": [
        {
          "name": "SECRET_MANAGER_TYPE",
          "value": "aws"
        },
        {
          "name": "AWS_REGION",
          "value": "us-east-1"
        },
        {
          "name": "LOG_LEVEL",
          "value": "info"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sql-mcp",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### Example 5: Lambda Function Configuration

```bash
# Create Lambda deployment package
zip -r sql-mcp-lambda.zip index.js lib/ node_modules/

# Create Lambda function
aws lambda create-function \
    --function-name sql-mcp-lambda \
    --runtime nodejs18.x \
    --role arn:aws:iam::ACCOUNT:role/sql-mcp-lambda-role \
    --handler index.handler \
    --zip-file fileb://sql-mcp-lambda.zip \
    --environment Variables='{
        "SECRET_MANAGER_TYPE":"aws",
        "AWS_REGION":"us-east-1",
        "LOG_LEVEL":"info"
    }'
```

### Example 6: Multi-Environment with Parameter Store

For environments that also use Systems Manager Parameter Store:

```bash
# Store environment indicator in Parameter Store
aws ssm put-parameter \
    --name "/sql-mcp/environment" \
    --value "production" \
    --type "String"

# Application retrieves environment and builds secret name
export ENVIRONMENT=$(aws ssm get-parameter --name "/sql-mcp/environment" --query 'Parameter.Value' --output text)
export AWS_SECRET_NAME="sql-mcp/${ENVIRONMENT}/database-config"
```

## Testing and Validation

### 1. Test AWS Authentication

```bash
# Test AWS CLI authentication
aws sts get-caller-identity

# Test Secrets Manager access
aws secretsmanager list-secrets --max-results 10

# Test specific secret access
aws secretsmanager get-secret-value --secret-id "sql-mcp/SQL_SERVER_HOST"
```

### 2. Test Secret Retrieval

Create a test script:

```javascript
// test-aws-secrets.js
import { SecretManager } from './lib/config/secret-manager.js';

async function testAWSSecrets() {
  const secretManager = new SecretManager({
    secretSource: 'aws'
  });

  try {
    // Test health check
    const health = await secretManager.healthCheck();
    console.log('Health Check:', JSON.stringify(health, null, 2));

    // Test individual secret
    const host = await secretManager.getSecret('sql-mcp/SQL_SERVER_HOST');
    console.log('SQL Server Host:', host ? 'Retrieved successfully' : 'Not found');

    // Test JSON secret
    const jsonSecret = await secretManager.getSecret('sql-mcp/database-config');
    console.log('JSON Secret:', typeof jsonSecret, Object.keys(jsonSecret || {}));

    // Test full database config
    const dbConfig = await secretManager.getDatabaseConfig();
    console.log('Database Config:', SecretManager.maskSecrets(dbConfig));
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testAWSSecrets();
```

```bash
# Run the test
node test-aws-secrets.js
```

### 3. Test MCP Server Startup

```bash
# Enable debug logging to see secret loading
export LOG_LEVEL="debug"
npm start
```

Look for these log messages:

```log
[INFO] Secret Manager: Initializing with source: aws
[INFO] Secret Manager: Health check - aws: healthy
[INFO] Database config loaded successfully from AWS Secrets Manager
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Authentication Errors

**Error:** `UnauthorizedOperation: You are not authorized to perform this operation`

**Solution:** Check IAM permissions:

```bash
# Check current identity
aws sts get-caller-identity

# Test specific permissions
aws secretsmanager list-secrets --max-results 1

# Verify IAM policy attachment
aws iam list-attached-user-policies --user-name sql-mcp-user
```

#### 2. Secret Not Found Errors

**Error:** `ResourceNotFoundException: Secrets Manager can't find the specified secret`

**Solution:** Verify secret name and region:

```bash
# List all secrets in region
aws secretsmanager list-secrets --region us-east-1

# Check exact secret name
aws secretsmanager describe-secret --secret-id "sql-mcp/SQL_SERVER_HOST"

# Verify region consistency
echo $AWS_REGION
```

#### 3. Region Mismatch Issues

**Error:** `InvalidRequestException: You can't perform this operation on the secret because it's in a different region`

**Solution:** Ensure region consistency:

```bash
# Check secret region
aws secretsmanager describe-secret \
    --secret-id "sql-mcp/database-config" \
    --query 'ARN' --output text

# Set correct region
export AWS_REGION="us-west-2"  # Match secret's region
```

#### 4. JSON Parsing Errors

**Error:** `SyntaxError: Unexpected token in JSON`

**Solution:** Validate JSON secret format:

```bash
# Retrieve and validate JSON
aws secretsmanager get-secret-value \
    --secret-id "sql-mcp/database-config" \
    --query 'SecretString' --output text | jq .

# Fix invalid JSON in secret
aws secretsmanager update-secret \
    --secret-id "sql-mcp/database-config" \
    --secret-string '{"SQL_SERVER_HOST": "valid-json"}'
```

#### 5. Rate Limiting Issues

**Error:** `ThrottlingException: Rate exceeded`

**Solution:** Implement exponential backoff and caching:

```bash
# Enable longer caching
export SECRET_CACHE_MAX_AGE="1800000"  # 30 minutes

# Use batch operations where possible
# Check AWS service quotas
aws service-quotas get-service-quota \
    --service-code secretsmanager \
    --quota-code L-F4EA4DCC
```

#### 6. Cross-Account Access Issues

**Error:** `AccessDenied: Cross-account pass role is not allowed`

**Solution:** Verify cross-account trust relationship:

```bash
# Check role trust policy
aws iam get-role \
    --role-name sql-mcp-cross-account-role \
    --query 'Role.AssumeRolePolicyDocument'

# Test role assumption
aws sts assume-role \
    --role-arn "arn:aws:iam::ACCOUNT:role/sql-mcp-role" \
    --role-session-name "sql-mcp-test"
```

### Debug Mode

Enable comprehensive debugging:

```bash
export LOG_LEVEL="debug"
export AWS_SDK_LOAD_CONFIG="1"
export NODE_ENV="development"

# Enable AWS SDK debugging (verbose)
export AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE="1"
npm start
```

This will show detailed logs including:

- Secret Manager initialization
- AWS authentication attempts
- Secret retrieval operations
- Health check results
- AWS SDK debug information

### Health Check Validation

The MCP server includes health checks for AWS Secrets Manager:

```javascript
// Access health check programmatically
const secretManager = new SecretManager({ secretSource: 'aws' });
const health = await secretManager.healthCheck();
console.log(health);

// Expected output for healthy AWS connection:
// {
//   "source": "aws",
//   "status": "healthy",
//   "details": {
//     "aws": "authenticated"
//   }
// }
```

## Best Practices

### Security Best Practices

1. **Use IAM Roles** when possible (EC2, ECS, Lambda)
2. **Rotate secrets regularly** using AWS Secrets Manager automatic rotation
3. **Use separate secrets** for different environments
4. **Enable CloudTrail logging** for Secrets Manager API calls
5. **Use resource-based policies** for additional access control
6. **Encrypt secrets with KMS** customer-managed keys
7. **Use VPC endpoints** for private network access

### Cost Optimization

1. **Batch secret retrievals** where possible
2. **Use appropriate caching** to reduce API calls
3. **Clean up unused secrets** regularly
4. **Use Secrets Manager** only for truly sensitive data
5. **Consider Parameter Store** for non-sensitive configuration

### Configuration Best Practices

1. **Use infrastructure as code** (CloudFormation, Terraform)
2. **Document secret naming conventions** for your team
3. **Test secret rotation** procedures
4. **Monitor CloudWatch metrics** and set up alerts
5. **Use environment-specific prefixes** in secret names

### Example Infrastructure as Code (CloudFormation)

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'SQL MCP Secrets Manager Setup'

Resources:
  SQLMCPDatabaseSecret:
    Type: 'AWS::SecretsManager::Secret'
    Properties:
      Name: !Sub 'sql-mcp/${Environment}/database-config'
      Description: 'SQL Server configuration for MCP'
      SecretString: !Sub |
        {
          "SQL_SERVER_HOST": "${SQLServerHost}",
          "SQL_SERVER_PORT": "1433",
          "SQL_SERVER_DATABASE": "${DatabaseName}",
          "SQL_SERVER_USER": "${DatabaseUser}",
          "SQL_SERVER_PASSWORD": "${DatabasePassword}",
          "SQL_SERVER_ENCRYPT": "true",
          "SQL_SERVER_TRUST_CERT": "false"
        }
      KmsKeyId: !Ref SQLMCPSecretsKMSKey

  SQLMCPSecretsKMSKey:
    Type: 'AWS::KMS::Key'
    Properties:
      Description: 'KMS Key for SQL MCP Secrets'
      KeyPolicy:
        Statement:
          - Sid: Enable IAM User Permissions
            Effect: Allow
            Principal:
              AWS: !Sub 'arn:aws:iam::${AWS::AccountId}:root'
            Action: 'kms:*'
            Resource: '*'
          - Sid: Allow SQL MCP Role
            Effect: Allow
            Principal:
              AWS: !GetAtt SQLMCPRole.Arn
            Action:
              - 'kms:Decrypt'
              - 'kms:GenerateDataKey'
            Resource: '*'

  SQLMCPRole:
    Type: 'AWS::IAM::Role'
    Properties:
      RoleName: !Sub 'sql-mcp-role-${Environment}'
      AssumeRolePolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              Service: ec2.amazonaws.com
            Action: 'sts:AssumeRole'
      ManagedPolicyArns:
        - !Ref SQLMCPSecretsPolicy

  SQLMCPSecretsPolicy:
    Type: 'AWS::IAM::ManagedPolicy'
    Properties:
      PolicyDocument:
        Statement:
          - Effect: Allow
            Action:
              - 'secretsmanager:GetSecretValue'
              - 'secretsmanager:DescribeSecret'
            Resource: !Ref SQLMCPDatabaseSecret
```

This completes the comprehensive AWS Secrets Manager configuration guide. The secret manager
handles both individual secrets and JSON-structured secrets automatically, providing maximum
flexibility for different deployment scenarios.
