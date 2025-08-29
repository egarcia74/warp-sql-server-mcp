# Azure Key Vault Configuration Guide

This guide provides comprehensive instructions for configuring Azure Key Vault with the Warp SQL Server MCP project.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Azure Key Vault Setup](#azure-key-vault-setup)
3. [Authentication Configuration](#authentication-configuration)
4. [Secret Naming and Organization](#3-secret-naming-convention)
5. [Environment Variables](#environment-variables)
6. [Complete Configuration Examples](#complete-configuration-examples)
7. [Testing and Validation](#testing-and-validation)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:

- **Azure subscription** with appropriate permissions
- **Azure Key Vault** resource created
- **Azure CLI** installed (`az cli`) or **Azure PowerShell**
- **Service Principal** or **Managed Identity** configured
- **Node.js 18+** and the MCP project dependencies installed

## Azure Key Vault Setup

### 1. Create Azure Key Vault (if not exists)

```bash
# Using Azure CLI
az keyvault create \
    --name "your-sql-mcp-vault" \
    --resource-group "your-resource-group" \
    --location "East US" \
    --enable-soft-delete \
    --retention-days 7
```

### 2. Add Database Connection Secrets

The MCP server looks for specific secret names in your Azure Key Vault. Here's how to add them:

#### Core Database Secrets

```bash
# SQL Server connection details
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-HOST" --value "your-sql-server.database.windows.net"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-PORT" --value "1433"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-DATABASE" --value "your-database-name"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-USER" --value "your-sql-username"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-PASSWORD" --value "your-secure-password"
```

#### Optional Configuration Secrets

```bash
# Security settings
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-ENCRYPT" --value "true"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-TRUST-CERT" --value "false"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-READ-ONLY" --value "true"

# Performance settings
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-CONNECT-TIMEOUT-MS" --value "10000"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-REQUEST-TIMEOUT-MS" --value "30000"
az keyvault secret set --vault-name "your-sql-mcp-vault" --name "SQL-SERVER-POOL-MAX" --value "10"
```

### 3. Secret Naming Convention

**Important:** Azure Key Vault secret names follow these rules:

- **Allowed characters**: Letters, numbers, and hyphens (`-`)
- **NOT allowed**: Underscores (`_`), spaces, special characters
- **Length**: 1-127 characters
- **Case**: Case-insensitive

The MCP server automatically converts environment variable names to Azure-compatible format:

| Environment Variable  | Azure Key Vault Secret Name |
| --------------------- | --------------------------- |
| `SQL_SERVER_HOST`     | `SQL-SERVER-HOST`           |
| `SQL_SERVER_PORT`     | `SQL-SERVER-PORT`           |
| `SQL_SERVER_USER`     | `SQL-SERVER-USER`           |
| `SQL_SERVER_PASSWORD` | `SQL-SERVER-PASSWORD`       |
| `SQL_SERVER_ENCRYPT`  | `SQL-SERVER-ENCRYPT`        |

## Authentication Configuration

### Option 1: Service Principal (Recommended for Production)

#### 1.1 Create Service Principal

```bash
# Create service principal
az ad sp create-for-rbac --name "sql-mcp-service-principal" --skip-assignment

# Output will include:
# {
#   "appId": "your-app-id",
#   "displayName": "sql-mcp-service-principal",
#   "password": "your-client-secret",
#   "tenant": "your-tenant-id"
# }
```

#### 1.2 Grant Key Vault Access

```bash
# Grant secret access to the service principal
az keyvault set-policy \
    --name "your-sql-mcp-vault" \
    --spn "your-app-id" \
    --secret-permissions get list
```

#### 1.3 Configure Environment Variables

```bash
# Azure authentication
export AZURE_CLIENT_ID="your-app-id"
export AZURE_CLIENT_SECRET="your-client-secret"
export AZURE_TENANT_ID="your-tenant-id"

# Key Vault configuration
export SECRET_MANAGER_TYPE="azure"
export AZURE_KEY_VAULT_URL="https://your-sql-mcp-vault.vault.azure.net/"
```

### Option 2: Managed Identity (For Azure Resources)

If running on Azure VM, App Service, or Container Instances:

#### 2.1 Enable Managed Identity

```bash
# For Azure VM
az vm identity assign --resource-group "your-rg" --name "your-vm"

# For Azure App Service
az webapp identity assign --resource-group "your-rg" --name "your-webapp"
```

#### 2.2 Grant Key Vault Access

```bash
# Get the managed identity principal ID
PRINCIPAL_ID=$(az vm identity show --resource-group "your-rg" --name "your-vm" --query principalId --output tsv)

# Grant access to Key Vault
az keyvault set-policy \
    --name "your-sql-mcp-vault" \
    --object-id "$PRINCIPAL_ID" \
    --secret-permissions get list
```

#### 2.3 Configure Environment Variables

```bash
# Only need these for managed identity
export SECRET_MANAGER_TYPE="azure"
export AZURE_KEY_VAULT_URL="https://your-sql-mcp-vault.vault.azure.net/"
```

## Environment Variables

### Required Configuration

```bash
# Secret management type (REQUIRED)
export SECRET_MANAGER_TYPE="azure"

# Azure Key Vault URL (REQUIRED)
export AZURE_KEY_VAULT_URL="https://your-vault-name.vault.azure.net/"
```

### Authentication Variables (Service Principal)

```bash
# Required for Service Principal authentication
export AZURE_CLIENT_ID="your-app-id"
export AZURE_CLIENT_SECRET="your-client-secret"
export AZURE_TENANT_ID="your-tenant-id"
```

### Optional Configuration

```bash
# Cache settings (optional)
export SECRET_CACHE_MAX_AGE="300000"  # 5 minutes in milliseconds

# Logging (optional)
export LOG_LEVEL="info"  # debug, info, warn, error
```

## Complete Configuration Examples

### Example 1: Production Service Principal Setup

```bash
#!/bin/bash
# production-azure-setup.sh

# Azure authentication (from service principal creation)
export AZURE_CLIENT_ID="12345678-1234-5678-9012-123456789012"
export AZURE_CLIENT_SECRET="your-secure-client-secret"
export AZURE_TENANT_ID="87654321-4321-8765-2109-876543210987"

# Key Vault configuration
export SECRET_MANAGER_TYPE="azure"
export AZURE_KEY_VAULT_URL="https://prod-sql-mcp-vault.vault.azure.net/"

# Optional: Performance and logging
export SECRET_CACHE_MAX_AGE="600000"  # 10 minutes
export LOG_LEVEL="warn"

# Start the MCP server
npm start
```

### Example 2: Development Environment

```bash
#!/bin/bash
# dev-azure-setup.sh

# Azure authentication
export AZURE_CLIENT_ID="dev-app-id"
export AZURE_CLIENT_SECRET="dev-client-secret"
export AZURE_TENANT_ID="your-tenant-id"

# Key Vault configuration
export SECRET_MANAGER_TYPE="azure"
export AZURE_KEY_VAULT_URL="https://dev-sql-mcp-vault.vault.azure.net/"

# Development settings
export LOG_LEVEL="debug"
export SECRET_CACHE_MAX_AGE="60000"  # 1 minute for development

# Start in development mode
npm run dev
```

### Example 3: Docker Container

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
# Run with Azure Key Vault configuration
docker run -d \
  --name sql-mcp \
  -e SECRET_MANAGER_TYPE="azure" \
  -e AZURE_KEY_VAULT_URL="https://your-vault.vault.azure.net/" \
  -e AZURE_CLIENT_ID="your-app-id" \
  -e AZURE_CLIENT_SECRET="your-client-secret" \
  -e AZURE_TENANT_ID="your-tenant-id" \
  -e LOG_LEVEL="info" \
  your-registry/sql-mcp:latest
```

### Example 4: Azure App Service Configuration

Using Azure App Service Configuration:

```bash
# Set application settings via Azure CLI
az webapp config appsettings set \
    --resource-group "your-rg" \
    --name "your-webapp" \
    --settings \
        SECRET_MANAGER_TYPE="azure" \
        AZURE_KEY_VAULT_URL="https://your-vault.vault.azure.net/" \
        LOG_LEVEL="info"
```

## Testing and Validation

### 1. Test Azure Authentication

```bash
# Test Azure CLI authentication
az account show

# Test Key Vault access
az keyvault secret list --vault-name "your-sql-mcp-vault"
```

### 2. Test Secret Retrieval

Create a simple test script:

```javascript
// test-azure-secrets.js
import { SecretManager } from './lib/config/secret-manager.js';

async function testAzureSecrets() {
  const secretManager = new SecretManager({
    secretSource: 'azure',
    azureVaultUrl: process.env.AZURE_KEY_VAULT_URL
  });

  try {
    // Test health check
    const health = await secretManager.healthCheck();
    console.log('Health Check:', JSON.stringify(health, null, 2));

    // Test secret retrieval
    const host = await secretManager.getSecret('SQL_SERVER_HOST');
    console.log('SQL Server Host:', host ? 'Retrieved successfully' : 'Not found');

    // Test full database config
    const dbConfig = await secretManager.getDatabaseConfig();
    console.log('Database Config:', SecretManager.maskSecrets(dbConfig));
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testAzureSecrets();
```

```bash
# Run the test
node test-azure-secrets.js
```

### 3. Test MCP Server Startup

```bash
# Enable debug logging to see secret loading
export LOG_LEVEL="debug"
npm start
```

Look for these log messages:

```log
[INFO] Secret Manager: Initializing with source: azure
[INFO] Secret Manager: Health check - azure: healthy
[INFO] Database config loaded successfully from Azure Key Vault
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Authentication Errors

**Error:** `AADSTS70011: The provided value for the input parameter 'scope' is not valid`

**Solution:** Ensure your service principal has correct permissions:

```bash
# Re-check service principal
az ad sp show --id "your-app-id"

# Re-grant Key Vault permissions
az keyvault set-policy \
    --name "your-vault" \
    --spn "your-app-id" \
    --secret-permissions get list
```

#### 2. Key Vault URL Issues

**Error:** `KeyVaultErrorException: Vault not found`

**Solution:** Verify the vault URL format:

```bash
# Correct format
https://vault-name.vault.azure.net/

# Get the correct URL
az keyvault show --name "your-vault" --query "properties.vaultUri" -o tsv
```

#### 3. Secret Name Issues

**Error:** `Secret not found: SQL_SERVER_HOST`

**Solution:** Check secret naming in Azure Key Vault:

```bash
# List all secrets
az keyvault secret list --vault-name "your-vault" --query "[].name" -o table

# Ensure names use hyphens, not underscores
# SQL_SERVER_HOST should be SQL-SERVER-HOST in Azure Key Vault
```

#### 4. Network Connectivity

**Error:** `getaddrinfo ENOTFOUND vault-name.vault.azure.net`

**Solution:** Check network and firewall settings:

```bash
# Test network connectivity
nslookup your-vault.vault.azure.net
curl -I https://your-vault.vault.azure.net/

# Check Azure Key Vault firewall settings
az keyvault network-rule list --name "your-vault"
```

#### 5. Permission Issues

**Error:** `Forbidden: The user, group or application does not have secrets get permission`

**Solution:** Grant proper permissions:

```bash
# For service principal
az keyvault set-policy \
    --name "your-vault" \
    --spn "your-app-id" \
    --secret-permissions get list

# For managed identity
az keyvault set-policy \
    --name "your-vault" \
    --object-id "managed-identity-object-id" \
    --secret-permissions get list
```

### Debug Mode

Enable comprehensive debugging:

```bash
export LOG_LEVEL="debug"
export NODE_ENV="development"
npm start
```

This will show detailed logs including:

- Secret Manager initialization
- Authentication attempts
- Secret retrieval operations
- Health check results
- Error details with stack traces

### Health Check Endpoint

The MCP server includes a health check for the secret manager:

```javascript
// Access health check programmatically
const secretManager = new SecretManager({ secretSource: 'azure' });
const health = await secretManager.healthCheck();
console.log(health);

// Expected output for healthy Azure connection:
// {
//   "source": "azure",
//   "status": "healthy",
//   "details": {
//     "azure": "authenticated"
//   }
// }
```

## Best Practices

### Security Best Practices

1. **Use Managed Identity** when possible (Azure-hosted resources)
2. **Rotate secrets regularly** using Azure Key Vault features
3. **Use separate Key Vaults** for different environments
4. **Enable audit logging** for Key Vault access
5. **Use resource-specific vaults** to limit blast radius

### Configuration Best Practices

1. **Use infrastructure as code** (ARM templates, Terraform)
2. **Document secret naming conventions** for your team
3. **Test secret rotation** procedures
4. **Monitor Key Vault metrics** and alerts
5. **Use environment-specific prefixes** in secret names

### Example Infrastructure as Code

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "resources": [
    {
      "type": "Microsoft.KeyVault/vaults",
      "apiVersion": "2021-11-01-preview",
      "name": "[parameters('keyVaultName')]",
      "properties": {
        "tenantId": "[subscription().tenantId]",
        "sku": {
          "family": "A",
          "name": "standard"
        },
        "accessPolicies": [
          {
            "tenantId": "[subscription().tenantId]",
            "objectId": "[parameters('servicePrincipalObjectId')]",
            "permissions": {
              "secrets": ["get", "list"]
            }
          }
        ]
      }
    }
  ]
}
```

This completes the comprehensive Azure Key Vault configuration guide. The secret manager will
handle the automatic conversion between environment variable names and Azure-compatible secret
names, providing seamless integration with your existing configuration patterns.
