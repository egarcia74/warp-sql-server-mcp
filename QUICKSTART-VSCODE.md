# VS Code Quick Start Guide

Get your **Secure SQL Server MCP** running in VS Code in under 5 minutes! 🚀

## Prerequisites (30 seconds)

- ✅ **Node.js 18+** installed
- ✅ **SQL Server** running (localhost:1433)
- ✅ **VS Code** with recommended extensions
- ✅ **Warp Terminal** (for MCP functionality)

## Step 1: Install (1 minute)

```bash
# Clone and install
git clone https://github.com/egarica74/warp-sql-server-mcp.git
cd warp-sql-server-mcp
npm install

# Open in VS Code
code .
```

## Step 2: VS Code Setup (1 minute)

### Install Essential Extensions

**Quick Install via Command Palette** (`Cmd+Shift+P`):

```text
ext install ms-mssql.mssql
ext install mtxr.sqltools
ext install mtxr.sqltools-driver-mssql
ext install esbenp.prettier-vscode
ext install dbaeumer.vscode-eslint
```

### Configure Environment

1. **Copy environment template**:

   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` in VS Code** with your SQL Server details:

   ```bash
   # Basic connection settings
   SQL_SERVER_HOST=localhost
   SQL_SERVER_PORT=1433
   SQL_SERVER_DATABASE=master
   SQL_SERVER_USER=your_username
   SQL_SERVER_PASSWORD=your_password

   # Development security settings
   SQL_SERVER_READ_ONLY=false
   SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
   SQL_SERVER_ALLOW_SCHEMA_CHANGES=false

   # Local development settings
   SQL_SERVER_ENCRYPT=false
   SQL_SERVER_TRUST_CERT=true
   ```

## Step 3: Configure Warp MCP (2 minutes)

### Option A: SQL Server Authentication (Most Common)

1. **Open Warp Settings**: `Cmd+,` → **MCP** tab
2. **Add New Server**:
   - **Name**: `sql-server`
   - **Command**: `node`
   - **Args**: `["/full/path/to/warp-sql-server-mcp/index.js"]`

     💡 **Tip**: Use `pwd` in VS Code terminal to get the full path

3. **Add Environment Variables**:

```json
{
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
```

### Option B: Windows Authentication

Same as above, but **omit** `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD`.

## Step 4: Test Everything! (1 minute)

### Test the MCP Server

1. **In VS Code terminal** (`Ctrl+` ` `):

   ```bash
   npm run dev
   ```

2. **Look for success message**:
   ```bash
   ✅ SQL Server MCP Server started
   🔗 Connected to SQL Server
   ⚠️ Security: UNSAFE (RW, DML+, DDL-)
   ```

### Test Warp Integration

1. **Open Warp terminal** (separate from VS Code or integrated)
2. **Try these MCP commands**:

```text
List all databases
```

```text
Show me tables in the master database
```

```text
What's the structure of the sys.databases table?
```

### Test VS Code SQL Extension

1. **Connect to database**:
   - `Cmd+Shift+P` → "MS SQL: Connect"
   - Enter your connection details

2. **Create a test query**:
   - New file: `test-query.sql`
   - Add: `SELECT @@VERSION;`
   - Execute: `Cmd+Shift+E`

## 🎉 Success

If you see:

- ✅ MCP server running without errors
- ✅ Database results from Warp commands
- ✅ SQL query results in VS Code
- ✅ No connection errors

**You're all set for enterprise-grade database development!**

## 🔒 Understanding Security Settings

**Your setup defaults to SAFE DEVELOPMENT mode:**

- ✅ **Read/Write**: Data modifications allowed
- ✅ **DML Operations**: INSERT/UPDATE/DELETE allowed
- ❌ **Schema Changes**: CREATE/DROP/ALTER blocked

**Security Status**: `⚠️ UNSAFE (RW, DML+, DDL-)`

### Need Maximum Security?

For production monitoring or read-only analysis:

```json
{
  "SQL_SERVER_READ_ONLY": "true",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "false",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
}
```

**Security Status**: `🔒 SECURE (RO, DML-, DDL-)`

## 🚀 Quick Development Workflow

### Database Exploration

```text
List all databases on this server
```

```text
Show me all tables in AdventureWorks database
```

```text
Describe the schema for the Users table
```

### Query Development

1. **Write SQL in VS Code**: Create `.sql` files
2. **Test via MCP**: Copy query to Warp for AI-powered analysis
3. **Optimize**: Use MCP's execution plan analysis
4. **Execute**: Run final query in VS Code SQL extension

### Performance Analysis

```text
Explain the execution plan for this query: SELECT * FROM Orders WHERE OrderDate > '2023-01-01'
```

```text
Get performance statistics for recent queries
```

### Data Export

```text
Export the top 100 customers to CSV format
```

## 🛠️ VS Code Power Features

### Debugging Setup

**Launch Configuration** (already included):

- `F5` to debug the MCP server
- Set breakpoints in VS Code
- Debug MCP tool execution

### Integrated Testing

```bash
# Watch mode testing (great for TDD)
npm run test:watch

# Coverage reports
npm run test:coverage
```

### Code Quality

```bash
# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format

# Run full CI pipeline
npm run ci
```

## Common VS Code Workflows

### Daily Development

1. **Open VS Code**: `code .`
2. **Start MCP server**: `npm run dev` in terminal
3. **Run tests**: `npm run test:watch` in second terminal
4. **Begin TDD development**

### Database Query Development

1. **Create `.sql` file** in VS Code
2. **Write and test query** using SQL extension
3. **Analyze via MCP**: Copy to Warp for AI analysis
4. **Optimize based on MCP feedback**
5. **Finalize in VS Code**

### Database Schema Work

1. **Explore via MCP**: Use Warp for schema discovery
2. **Document in VS Code**: Create `.md` files with findings
3. **Create queries**: Build `.sql` files for analysis
4. **Test and validate**: Use both VS Code and MCP tools

## Troubleshooting

### Connection Issues

**MCP Server Won't Start**:

```bash
# Check Node.js version
node --version  # Should be 18+

# Test SQL Server connection
telnet localhost 1433
```

**VS Code SQL Extension Issues**:

- Verify connection settings match `.env` file
- Check SQL Server is accepting connections
- Try Windows vs SQL Server authentication

**Warp MCP Not Responding**:

- Restart Warp
- Check MCP server logs in VS Code terminal
- Verify environment variables in Warp settings

### Permission Errors

```sql
-- Check user permissions
SELECT
    dp.class_desc,
    dp.permission_name,
    dp.state_desc,
    pr.name as principal_name
FROM sys.database_permissions dp
JOIN sys.database_principals pr ON dp.grantee_principal_id = pr.principal_id
WHERE pr.name = 'your_username';
```

### Performance Issues

**Slow Queries**:

```text
Get query performance breakdown for slow queries only
```

**Memory Issues**:

```bash
# Enable streaming for large datasets
ENABLE_STREAMING=true
STREAMING_BATCH_SIZE=1000
```

## What's Next?

### 🏗️ Advanced Development

- **[Complete VS Code Guide](docs/VSCODE-INTEGRATION-GUIDE.md)** - Comprehensive development setup
- **[Architecture Guide](ARCHITECTURE.md)** - Understanding the enterprise patterns
- **[Security Documentation](SECURITY.md)** - Production deployment guidelines

### 📊 Database Work

- **[All Available Tools](README.md#available-tools)** - 11 powerful database operations
- **[Performance Monitoring](README.md#performance-monitoring)** - Advanced analytics
- **[Cloud Integration](docs/)** - AWS Secrets Manager & Azure Key Vault

### 🧪 Testing & Quality

- **[Test Documentation](test/README.md)** - Comprehensive testing guide
- **[Development Workflow](WARP.md#development-workflow)** - TDD practices

## Get Help

- 📋 **[GitHub Issues](https://github.com/egarcia74/warp-sql-server-mcp/issues)** - Bug reports & features
- 📖 **[Full Documentation](README.md)** - Complete setup guide
- 🚀 **[Quick Start (Warp)](QUICKSTART.md)** - Original Warp-focused guide

---

## 💡 Pro Tips

### Keyboard Shortcuts

- `Cmd+Shift+P`: Command palette (your best friend)
- `Cmd+Shift+E`: Execute SQL query
- `Ctrl+` ` `: Toggle terminal
- `F5`: Start debugging

### Workspace Organization

```text
your-project/
├── sql/queries/     # Reusable SQL queries
├── docs/            # Database documentation
├── mcp-configs/     # Environment-specific configs
└── .vscode/         # VS Code settings (auto-created)
```

### Multi-Environment Setup

- Use separate MCP configurations for dev/staging/prod
- Keep connection details in environment-specific files
- Use VS Code's multi-root workspaces for complex projects

---

**🚀 Ready to build enterprise-grade database solutions with the power of VS Code + Warp MCP!**
