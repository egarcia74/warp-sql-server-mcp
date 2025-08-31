# VS Code Integration Guide for Warp SQL Server MCP

> **Complete guide for integrating warp-sql-server-mcp with Visual Studio Code and the Model Context Protocol (MCP)**

This guide covers VS Code setup, MCP configuration, development workflow, and best practices for working with the Warp SQL Server MCP in Visual Studio Code.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Setup (5 Minutes)](#quick-setup-5-minutes)
- [VS Code Extensions](#vs-code-extensions)
- [MCP Configuration](#mcp-configuration)
- [Development Workflow](#development-workflow)
- [Database Development](#database-development)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)
- [Advanced Configuration](#advanced-configuration)

## Prerequisites

### Required Software

- ✅ **VS Code** 1.80+ (latest recommended)
- ✅ **Node.js** 18+ installed
- ✅ **SQL Server** running (localhost:1433 or remote)
- ✅ **Warp Terminal** with MCP support
- ✅ **Git** for version control

### Database Requirements

- SQL Server 2016+ (recommended: SQL Server 2019+)
- Valid SQL Server authentication OR Windows authentication
- Database user with appropriate permissions (see [Security](#security-best-practices))

## Quick Setup (5 Minutes)

### Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/egarcia74/warp-sql-server-mcp.git
cd warp-sql-server-mcp

# Install dependencies
npm install

# Verify installation
npm test
```

### Step 2: Open in VS Code

```bash
# Open project in VS Code
code .
```

### Step 3: Configure Environment

1. **Copy environment template**:

   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file** in VS Code with your SQL Server details:

   ```bash
   # Basic connection settings
   SQL_SERVER_HOST=localhost
   SQL_SERVER_PORT=1433
   SQL_SERVER_DATABASE=master
   SQL_SERVER_USER=your_username
   SQL_SERVER_PASSWORD=your_password

   # Security settings (recommended for development)
   SQL_SERVER_READ_ONLY=false
   SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
   SQL_SERVER_ALLOW_SCHEMA_CHANGES=false

   # SSL settings (for local development)
   SQL_SERVER_ENCRYPT=false
   SQL_SERVER_TRUST_CERT=true
   ```

### Step 4: Test the Server

```bash
# Run the server in development mode
npm run dev
```

You should see:

```bash
✅ SQL Server MCP Server started
🔗 Connected to SQL Server
⚠️ Security: UNSAFE (RW, DML+, DDL-)
```

## VS Code Extensions

### Essential Extensions

Install these extensions for the best development experience:

#### 1. **SQL Server (mssql)** - Microsoft

- **Extension ID**: `ms-mssql.mssql`
- **Purpose**: Direct SQL Server integration, query execution, IntelliSense
- **Features**:
  - Database connections
  - SQL syntax highlighting
  - Query execution
  - Results visualization

#### 2. **SQLTools** - Matheus Teixeira

- **Extension ID**: `mtxr.sqltools`
- **Purpose**: Multi-database management interface
- **Add-on**: `mtxr.sqltools-driver-mssql` for SQL Server support

#### 3. **REST Client** - Huachao Mao

- **Extension ID**: `humao.rest-client`
- **Purpose**: Test MCP endpoints and API interactions

#### 4. **Thunder Client** - RangaVadhineni

- **Extension ID**: `rangav.vscode-thunder-client`
- **Purpose**: Alternative API testing tool

### Recommended Extensions

#### Development Quality

- **ESLint** (`dbaeumer.vscode-eslint`) - Linting integration
- **Prettier** (`esbenp.prettier-vscode`) - Code formatting
- **GitLens** (`eamodio.gitlens`) - Enhanced Git integration
- **Error Lens** (`usernamehw.errorlens`) - Inline error highlighting

#### Testing & Debugging

- **Vitest** (`ZixuanChen.vitest-explorer`) - Test explorer
- **Jest Runner** (`firsttris.vscode-jest-runner`) - Test execution
- **Node.js Extension Pack** (`ms-vscode.vscode-node-extension-pack`) - Node.js development

#### Documentation

- **Markdown All in One** (`yzhang.markdown-all-in-one`) - Markdown editing
- **markdownlint** (`davidanson.vscode-markdownlint`) - Markdown linting

## MCP Configuration

### Option 1: VS Code with Warp Integration

**Best for**: Using Warp Terminal within VS Code for MCP interactions

1. **Configure Warp MCP Settings**:
   - Open Warp → Settings (`Cmd+,`)
   - Navigate to **MCP** tab
   - Add new server:

```json
{
  "name": "sql-server",
  "command": "node",
  "args": ["/path/to/warp-sql-server-mcp/index.js"],
  "env": {
    "SQL_SERVER_HOST": "localhost",
    "SQL_SERVER_PORT": "1433",
    "SQL_SERVER_DATABASE": "master",
    "SQL_SERVER_USER": "your_username",
    "SQL_SERVER_PASSWORD": "your_password",
    "SQL_SERVER_ENCRYPT": "false",
    "SQL_SERVER_TRUST_CERT": "true",
    "SQL_SERVER_READ_ONLY": "false",
    "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
    "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
  }
}
```

1. **Open Warp in VS Code**:
   - Use integrated terminal: `View → Terminal`
   - Set Warp as default shell
   - Test MCP connection:
   ```text
   List all databases on the server
   ```

### Option 2: Direct VS Code MCP Integration

**Coming Soon**: VS Code will support MCP directly. When available:

1. **Install MCP Extension** (when released)
2. **Configure MCP Server** in VS Code settings:
   ```json
   {
     "mcp.servers": {
       "sql-server": {
         "command": "node",
         "args": ["/path/to/warp-sql-server-mcp/index.js"],
         "env": {
           // Environment variables here
         }
       }
     }
   }
   ```

### Option 3: Development Mode Setup

**Best for**: Active development of the MCP server itself

1. **Use VS Code's integrated terminal**
2. **Run in development mode**:
   ```bash
   npm run dev
   ```
3. **Test with MCP client tools** or Warp integration

## Development Workflow

### Project Structure in VS Code

```text
warp-sql-server-mcp/
├── 📁 .vscode/                 # VS Code settings (git-ignored)
├── 📁 docs/                    # Documentation
│   ├── 📄 VSCODE-INTEGRATION-GUIDE.md  # This guide
│   ├── 📄 AWS-SECRETS-GUIDE.md
│   └── 📄 AZURE-SECRETS-GUIDE.md
├── 📁 lib/                     # Core modules
│   ├── 📁 config/              # Configuration management
│   ├── 📁 security/            # Security validation
│   └── 📁 utils/               # Utilities
├── 📁 test/                    # Comprehensive tests
├── 📄 index.js                 # Main MCP server
├── 📄 package.json             # Project configuration
└── 📄 .env                     # Environment config (git-ignored)
```

### VS Code Workspace Configuration

Create `.vscode/settings.json` for project-specific settings:

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": ["javascript"],
  "prettier.requireConfig": true,
  "files.associations": {
    "*.md": "markdown"
  },
  "markdownlint.config": {
    "extends": ".markdownlint.json"
  },
  "vitest.enable": true,
  "testing.defaultGutterClickAction": "run"
}
```

Create `.vscode/launch.json` for debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug MCP Server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/index.js",
      "env": {
        "SQL_SERVER_HOST": "localhost",
        "SQL_SERVER_PORT": "1433",
        "SQL_SERVER_DATABASE": "master",
        "SQL_SERVER_USER": "your_username",
        "SQL_SERVER_PASSWORD": "your_password",
        "SQL_SERVER_ENCRYPT": "false",
        "SQL_SERVER_TRUST_CERT": "true",
        "SQL_SERVER_READ_ONLY": "false",
        "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
        "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false",
        "SQL_SERVER_LOG_LEVEL": "debug"
      },
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "name": "Run Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": ["run"],
      "console": "integratedTerminal",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

Create `.vscode/tasks.json` for common tasks:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Start MCP Server",
      "type": "npm",
      "script": "dev",
      "group": "build",
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      },
      "problemMatcher": []
    },
    {
      "label": "Run Tests",
      "type": "npm",
      "script": "test",
      "group": "test",
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    },
    {
      "label": "Run Tests with Coverage",
      "type": "npm",
      "script": "test:coverage",
      "group": "test",
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    },
    {
      "label": "Lint and Fix",
      "type": "npm",
      "script": "lint:fix",
      "group": "build",
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    },
    {
      "label": "Format Code",
      "type": "npm",
      "script": "format",
      "group": "build",
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": false,
        "panel": "shared"
      }
    }
  ]
}
```

## Database Development

### Using SQL Server Extension

1. **Connect to Database**:
   - `Cmd+Shift+P` → "MS SQL: Connect"
   - Enter connection details:
     - **Server**: `localhost,1433`
     - **Database**: `master` (or your target database)
     - **Authentication**: SQL Login
     - **Username**: Your SQL Server username
     - **Password**: Your SQL Server password

2. **Execute Queries**:
   - Create `.sql` files in your workspace
   - Use `Cmd+Shift+E` to execute selected queries
   - View results in the integrated results panel

### MCP Tools in VS Code Context

#### Example Workflow: Database Analysis

1. **Open integrated terminal** (`Ctrl+` ` `)
2. **Start Warp in terminal** (if using Warp integration)
3. **Use natural language queries**:

```text
Show me all tables in the AdventureWorks database
```

```text
What's the schema for the Users table?
```

```text
Export the top 100 orders to CSV format
```

#### Example Workflow: Query Development

1. **Write SQL in `.sql` file**:

   ```sql
   -- queries/user-analysis.sql
   SELECT
       u.UserId,
       u.UserName,
       COUNT(o.OrderId) as OrderCount
   FROM Users u
   LEFT JOIN Orders o ON u.UserId = o.UserId
   GROUP BY u.UserId, u.UserName
   ORDER BY OrderCount DESC;
   ```

2. **Test query via MCP**:

   ```text
   Execute this query and show me the execution plan: [paste query]
   ```

3. **Optimize using MCP feedback**:

   ```text
   Analyze the performance of this query and suggest optimizations
   ```

4. **Export results**:
   ```text
   Export the results of this query to CSV format
   ```

### Working with Large Datasets

The MCP server includes streaming support for large datasets:

```text
Export the entire Orders table to CSV with batching for memory efficiency
```

The server automatically:

- Detects large result sets
- Enables streaming mode
- Processes data in configurable batches (default: 1000 rows)
- Monitors memory usage

## Security Best Practices

### Development Environment Security

#### 🔒 **Secure Development Setup** (Recommended)

```bash
# In your .env file
SQL_SERVER_READ_ONLY=false                     # Allow writes for development
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true   # Allow data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false         # Block schema changes
```

**Security Status**: `⚠️ UNSAFE (RW, DML+, DDL-)`

#### 🛡️ **Maximum Security Setup** (Production Monitoring)

```bash
# In your .env file
SQL_SERVER_READ_ONLY=true                      # Only SELECT allowed
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false  # No data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false         # No schema changes
```

**Security Status**: `🔒 SECURE (RO, DML-, DDL-)`

### Database User Permissions

Create a dedicated database user for MCP access:

```sql
-- For development (read/write without schema changes)
CREATE LOGIN mcp_dev_user WITH PASSWORD = 'SecurePassword123!';
CREATE USER mcp_dev_user FOR LOGIN mcp_dev_user;
ALTER ROLE db_datareader ADD MEMBER mcp_dev_user;
ALTER ROLE db_datawriter ADD MEMBER mcp_dev_user;

-- For production monitoring (read-only)
CREATE LOGIN mcp_read_user WITH PASSWORD = 'SecurePassword123!';
CREATE USER mcp_read_user FOR LOGIN mcp_read_user;
ALTER ROLE db_datareader ADD MEMBER mcp_read_user;
```

### Environment Security

⚠️ **Never commit `.env` files** - they're already git-ignored.

For team collaboration, create `.env.example`:

```bash
# Copy current .env to example template (remove actual values)
cp .env .env.example
# Edit .env.example to remove actual credentials
```

## Database Development Workflow

### Test-Driven Development (TDD)

This project follows strict TDD practices. When developing new features:

#### 1. 🔴 **RED Phase**: Write Failing Tests

```bash
# Open test file in VS Code
code test/sqlserver-mcp.test.js

# Run tests in watch mode
npm run test:watch
```

#### 2. 🟢 **GREEN Phase**: Make Tests Pass

Write minimal code to make tests pass:

```javascript
// Example: Adding new MCP tool
test('should handle new_tool operation', async () => {
  const result = await mcpServer.handleTool('new_tool', {
    /* params */
  });
  expect(result).toBeDefined();
  expect(result.content).toContain('expected_output');
});
```

#### 3. 🟡 **REFACTOR Phase**: Improve Code Quality

```bash
# Run code quality checks
npm run lint:fix
npm run format
npm run test:coverage
```

### Git Workflow in VS Code

#### Pre-commit Quality Gates

The project includes automatic git hooks that run before commits:

1. **ESLint** code quality checks
2. **Prettier** formatting validation
3. **Markdownlint** documentation checks
4. **Full test suite** execution

#### Using Source Control Panel

1. **Stage Changes**: Use VS Code's Source Control panel (`Ctrl+Shift+G`)
2. **Commit**: Git hooks automatically run
3. **Push**: Additional quality checks run

If hooks fail:

```bash
# Fix issues automatically
npm run lint:fix
npm run format
npm run markdown:fix

# Re-run tests
npm test

# Then retry commit
```

### Debugging in VS Code

#### 1. **Debug MCP Server**

1. Set breakpoints in VS Code
2. Press `F5` or use "Debug MCP Server" configuration
3. Server starts with debugger attached
4. Test MCP interactions from Warp

#### 2. **Debug Tests**

1. Set breakpoints in test files
2. Use "Run Tests" configuration or:
   ```bash
   # Debug specific test
   npm run test -- --reporter=verbose specific-test-name
   ```

#### 3. **Debug SQL Queries**

Enable debug logging:

```bash
# In .env file
SQL_SERVER_LOG_LEVEL=debug
ENABLE_SECURITY_AUDIT=true
```

View logs in VS Code terminal:

```bash
# Tail log files
tail -f /var/log/sql-server-mcp.log
tail -f /var/log/security-audit.log
```

## Database Schema Development

### Schema Development Workflow

#### 1. **Schema Discovery**

Use MCP to explore existing database structure:

```text
List all databases on this server
```

```text
Show me all tables in the AdventureWorks database
```

```text
Describe the schema for the Products table
```

```text
Show me all foreign key relationships in the dbo schema
```

#### 2. **Query Development**

1. **Create SQL files** in VS Code:

   ```sql
   -- queries/product-analysis.sql
   SELECT
       p.ProductID,
       p.Name,
       p.ListPrice,
       c.Name as CategoryName
   FROM Production.Product p
   JOIN Production.ProductSubcategory ps ON p.ProductSubcategoryID = ps.ProductSubcategoryID
   JOIN Production.ProductCategory c ON ps.ProductCategoryID = c.ProductCategoryID
   WHERE p.ListPrice > 100
   ORDER BY p.ListPrice DESC;
   ```

2. **Test via MCP**:

   ```text
   Execute this query and show me the first 10 results: [paste query]
   ```

3. **Performance Analysis**:

   ```text
   Explain the execution plan for this query: [paste query]
   ```

4. **Export Results**:
   ```text
   Export this query results to CSV: [paste query]
   ```

#### 3. **Data Analysis Workflow**

1. **Sample Data Exploration**:

   ```text
   Show me sample data from the Orders table with CustomerID > 1000
   ```

2. **Data Quality Checks**:

   ```text
   Execute query: SELECT COUNT(*) as TotalRows, COUNT(DISTINCT CustomerID) as UniqueCustomers FROM Orders
   ```

3. **Performance Monitoring**:
   ```text
   Get performance statistics for recent queries
   ```

### Working with Multiple Databases

The MCP server supports database switching:

```text
List tables in the AdventureWorks database
```

```text
Switch to the TestDB database and show me all tables
```

```text
Execute this query on the Analytics database: SELECT COUNT(*) FROM Reports
```

## Advanced Configuration

### Cloud Secret Management

#### AWS Secrets Manager Integration

1. **Configure AWS credentials** in VS Code:

   ```bash
   # Install AWS CLI extension or configure locally
   aws configure
   ```

2. **Update environment**:

   ```bash
   SECRET_MANAGER_TYPE=aws
   AWS_REGION=us-east-1
   # Secret stored in AWS Secrets Manager
   ```

3. **Test connection**:
   ```text
   Get connection health status
   ```

#### Azure Key Vault Integration

1. **Configure Azure CLI**:

   ```bash
   az login
   ```

2. **Update environment**:

   ```bash
   SECRET_MANAGER_TYPE=azure
   AZURE_KEY_VAULT_URL=https://your-vault.vault.azure.net/
   ```

3. **Test connection**:
   ```text
   Get connection health status
   ```

### Performance Monitoring

#### Enable Advanced Monitoring

```bash
# In .env file
ENABLE_PERFORMANCE_MONITORING=true
SLOW_QUERY_THRESHOLD=5000              # 5 seconds
PERFORMANCE_SAMPLING_RATE=1.0          # 100% sampling
MAX_METRICS_HISTORY=1000
```

#### Monitor Performance in VS Code

1. **View Performance Stats**:

   ```text
   Get overall performance statistics for recent queries
   ```

2. **Analyze Slow Queries**:

   ```text
   Show me slow queries from the last session
   ```

3. **Tool-Specific Analysis**:
   ```text
   Get query performance breakdown for the execute_query tool
   ```

### Streaming Configuration

For large dataset handling:

```bash
# In .env file
ENABLE_STREAMING=true
STREAMING_BATCH_SIZE=1000              # Rows per batch
STREAMING_MAX_MEMORY_MB=50            # Memory limit
STREAMING_MAX_RESPONSE_SIZE=1000000   # Response size limit
```

## Troubleshooting

### Common VS Code Issues

#### 1. **Extension Conflicts**

**Problem**: SQL extensions conflict with MCP functionality
**Solution**:

- Disable conflicting extensions
- Use workspace-specific extension settings
- Configure extension priorities in settings

#### 2. **Terminal Integration Issues**

**Problem**: Warp terminal not working in VS Code
**Solution**:

```bash
# Set Warp as default terminal
# In VS Code settings.json:
{
  "terminal.integrated.defaultProfile.osx": "warp"
}
```

#### 3. **Environment Variable Loading**

**Problem**: `.env` variables not loading in debug mode
**Solution**: Ensure `launch.json` includes all required environment variables explicitly.

### MCP Connection Issues

#### 1. **Server Not Starting**

Check VS Code's integrated terminal:

```bash
# Test server manually
npm run dev

# Check logs
npm run dev 2>&1 | tee server.log
```

#### 2. **Authentication Failures**

**SQL Server Authentication**:

```bash
# Test connection manually
sqlcmd -S localhost,1433 -U your_username -P your_password -Q "SELECT @@VERSION"
```

**Windows Authentication**:

```bash
# Test Windows auth
sqlcmd -S localhost,1433 -E -Q "SELECT @@VERSION"
```

#### 3. **Permission Denied Errors**

Check database user permissions:

```sql
-- Check current user permissions
SELECT
    p.state_desc,
    p.permission_name,
    s.name AS principal_name
FROM sys.database_permissions p
LEFT JOIN sys.database_principals s ON p.grantee_principal_id = s.principal_id
WHERE s.name = 'your_mcp_user';
```

### Performance Issues

#### 1. **Slow Query Response**

Enable performance monitoring:

```text
Get query performance breakdown and show me slow queries
```

#### 2. **Memory Issues with Large Results**

Enable streaming mode:

```bash
# In .env
ENABLE_STREAMING=true
STREAMING_BATCH_SIZE=500  # Reduce batch size
```

#### 3. **Connection Pool Issues**

Check connection health:

```text
Get connection health status
```

## VS Code Tips & Tricks

### Productivity Features

#### 1. **Command Palette Integration**

Create custom VS Code commands for common MCP operations:

```json
// In .vscode/settings.json
{
  "macros": {
    "testMCPConnection": [
      "workbench.action.terminal.new",
      {
        "command": "workbench.action.terminal.sendSequence",
        "args": { "text": "Get connection health status\n" }
      }
    ]
  }
}
```

#### 2. **Code Snippets**

Create SQL snippets for common MCP queries in VS Code:

1. `Cmd+Shift+P` → "Preferences: Configure User Snippets"
2. Select "sql.json"
3. Add MCP-specific snippets:

```json
{
  "MCP List Databases": {
    "prefix": "mcp-list-db",
    "body": ["-- Query via MCP: List all databases", "-- Usage: List all databases on the server"],
    "description": "MCP command to list databases"
  },
  "MCP Describe Table": {
    "prefix": "mcp-describe",
    "body": [
      "-- Query via MCP: Describe table schema",
      "-- Usage: Describe the schema for the ${1:table_name} table"
    ],
    "description": "MCP command to describe table schema"
  }
}
```

#### 3. **Workspace Shortcuts**

Configure keyboard shortcuts for common tasks:

```json
// In keybindings.json
[
  {
    "key": "cmd+shift+m",
    "command": "workbench.action.tasks.runTask",
    "args": "Start MCP Server"
  },
  {
    "key": "cmd+shift+t",
    "command": "workbench.action.tasks.runTask",
    "args": "Run Tests"
  }
]
```

### File Organization

#### Recommended Folder Structure

```text
your-project/
├── 📁 sql/
│   ├── 📁 queries/          # Reusable SQL queries
│   ├── 📁 schemas/          # Schema definitions
│   └── 📁 migrations/       # Database migrations
├── 📁 mcp-configs/          # MCP configuration files
│   ├── 📄 development.json  # Dev environment config
│   ├── 📄 staging.json      # Staging environment config
│   └── 📄 production.json   # Production environment config
└── 📁 docs/
    ├── 📄 database-schema.md # Database documentation
    └── 📄 query-examples.md  # Common query patterns
```

#### Multi-Environment Configuration

Create environment-specific MCP configurations:

**Development** (`mcp-configs/development.json`):

```json
{
  "SQL_SERVER_HOST": "localhost",
  "SQL_SERVER_PORT": "1433",
  "SQL_SERVER_DATABASE": "TestDB",
  "SQL_SERVER_USER": "dev_user",
  "SQL_SERVER_PASSWORD": "dev_password",
  "SQL_SERVER_READ_ONLY": "false",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false",
  "SQL_SERVER_LOG_LEVEL": "debug"
}
```

**Production Monitoring** (`mcp-configs/production.json`):

```json
{
  "SECRET_MANAGER_TYPE": "azure",
  "AZURE_KEY_VAULT_URL": "https://prod-vault.vault.azure.net/",
  "SQL_SERVER_HOST": "prod-sql-server.company.com",
  "SQL_SERVER_PORT": "1433",
  "SQL_SERVER_DATABASE": "ProductionDB",
  "SQL_SERVER_READ_ONLY": "true",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "false",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false",
  "SQL_SERVER_ENCRYPT": "true",
  "SQL_SERVER_TRUST_CERT": "false",
  "ENABLE_PERFORMANCE_MONITORING": "true",
  "SLOW_QUERY_THRESHOLD": "3000"
}
```

## Integration Examples

### Example 1: Database Documentation Generation

Use MCP to generate database documentation:

```text
List all tables in the AdventureWorks database and describe each one
```

```text
Show me all foreign key relationships in the Sales schema
```

Save the results to document your database schema in VS Code.

### Example 2: Data Quality Assessment

```text
Execute query: SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' ORDER BY TABLE_NAME, ORDINAL_POSITION
```

```text
Get sample data from each table to assess data quality
```

### Example 3: Performance Analysis

```text
Explain the execution plan for my slowest queries
```

```text
Get performance statistics for the last hour
```

```text
Show me queries that took longer than 5 seconds to execute
```

## Best Practices

### Security Guidelines

1. **Always use least privilege** database accounts
2. **Use different credentials** for different environments
3. **Enable SSL encryption** for remote connections:
   ```bash
   SQL_SERVER_ENCRYPT=true
   SQL_SERVER_TRUST_CERT=false
   ```
4. **Regular security audits**:
   ```text
   Get performance statistics and check for any suspicious query patterns
   ```

### Performance Guidelines

1. **Monitor query performance**:

   ```text
   Get query performance breakdown for slow queries only
   ```

2. **Use appropriate limits** for data exploration:

   ```text
   Get sample data from large_table with limit 100
   ```

3. **Enable streaming** for large datasets:
   ```bash
   ENABLE_STREAMING=true
   STREAMING_BATCH_SIZE=1000
   ```

### Development Guidelines

1. **Write tests first** (TDD approach)
2. **Use meaningful commit messages**
3. **Keep environment configs separate** for different stages
4. **Document database queries** with comments
5. **Regular dependency updates**:
   ```bash
   npm audit
   npm update
   ```

## Getting Help

### Documentation Resources

- 📖 **[Complete Documentation](../README.md)** - Full project documentation
- 🚀 **[Quick Start Guide](../QUICKSTART.md)** - 5-minute setup walkthrough
- 🔒 **[Security Guide](../SECURITY.md)** - Comprehensive security documentation
- 🏗️ **[Architecture Guide](../ARCHITECTURE.md)** - Technical architecture details
- ☁️ **[AWS Secrets Guide](AWS-SECRETS-GUIDE.md)** - AWS Secrets Manager integration
- 🔑 **[Azure Secrets Guide](AZURE-SECRETS-GUIDE.md)** - Azure Key Vault integration

### Support Channels

- 🐛 **[GitHub Issues](https://github.com/egarcia74/warp-sql-server-mcp/issues)** - Bug reports and feature requests
- 📚 **[API Documentation](https://egarcia74.github.io/warp-sql-server-mcp/tools.html)** - Tool reference
- 💬 **Community Support** - Use GitHub Issues for questions and community discussion

### Common VS Code Workflows

#### Daily Development Routine

1. **Start VS Code**: `code .`
2. **Pull latest changes**: `Cmd+Shift+P` → "Git: Pull"
3. **Start MCP server**: `Ctrl+Shift+P` → "Tasks: Run Task" → "Start MCP Server"
4. **Run tests**: `Ctrl+Shift+P` → "Tasks: Run Task" → "Run Tests"
5. **Begin development** with TDD approach

#### Code Review Preparation

1. **Run full CI pipeline**:

   ```bash
   npm run ci
   ```

2. **Check test coverage**:

   ```bash
   npm run test:coverage
   open coverage/index.html
   ```

3. **Validate documentation**:

   ```bash
   npm run markdown:lint
   ```

4. **Create pull request** from VS Code Source Control panel

---

## 🎯 **Ready to Build Enterprise-Grade Database Solutions!**

This VS Code integration guide provides everything you need to develop, test, and deploy secure
SQL Server MCP solutions. The combination of VS Code's powerful development environment and
Warp's MCP capabilities creates an unparalleled database development experience.

**Next Steps:**

- 🚀 **[Try the Quick Start Guide](../QUICKSTART.md)** for immediate setup
- 🔒 **[Review Security Best Practices](../SECURITY.md)** for production deployment
- 🏗️ **[Explore the Architecture](../ARCHITECTURE.md)** to understand the enterprise patterns

---

_This guide is part of the comprehensive documentation for the [warp-sql-server-mcp](https://github.com/egarcia74/warp-sql-server-mcp) project - an enterprise-grade reference implementation showcasing production-ready software development practices._
