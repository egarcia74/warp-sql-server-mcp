# Quick Start Guide

Get your **Secure SQL Server MCP** running in Warp in under 5 minutes! 🚀

## Prerequisites (30 seconds)

- ✅ **Node.js 18+** installed
- ✅ **SQL Server** running (localhost:1433)
- ✅ **Warp Terminal** installed

## Step 1: Install (1 minute)

```bash
# Clone and install
git clone https://github.com/egarcia74/warp-sql-server-mcp.git
cd warp-sql-server-mcp
npm install
```

## Step 2: Configure for Warp (2 minutes)

### Option A: SQL Server Authentication (Most Common)

1. **Open Warp Settings**: `Cmd+,` → **MCP** tab
2. **Add New Server**:
   - **Name**: `sql-server`
   - **Command**: `node`
   - **Args**: `["/full/path/to/warp-sql-server-mcp/index.js"]`

3. **Add Environment Variables**:

```json
{
  "SQL_SERVER_HOST": "localhost",
  "SQL_SERVER_PORT": "1433",
  "SQL_SERVER_DATABASE": "master",
  "SQL_SERVER_USER": "your_username",
  "SQL_SERVER_PASSWORD": "your_password",
  "SQL_SERVER_ENCRYPT": "false",
  "SQL_SERVER_TRUST_CERT": "true"
}
```

### Option B: Windows Authentication

Same as above, but **omit** `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD`.

## Step 3: Test It! (1 minute)

1. **Restart** Warp or reload MCP settings
2. **Try these commands** in Warp:

```text
List all databases
```

```text
Show me tables in the master database
```

```text
What's the structure of the sys.databases table?
```

## 🎉 Success

If you see database results, you're all set!

## 🔒 Security Notice

**By default, your MCP runs in MAXIMUM SECURITY mode:**

- ✅ **Read-only**: Only SELECT queries allowed
- ❌ **No data changes**: INSERT/UPDATE/DELETE blocked
- ❌ **No schema changes**: CREATE/DROP/ALTER blocked

You'll see this in your logs:

```
Security: 🔒 SECURE (RO, DML-, DDL-)
```

## Need Write Access?

Add these to your environment variables:

```json
{
  "SQL_SERVER_READ_ONLY": "false",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "true"
}
```

⚠️ **Production Warning**: Only disable security for development environments!

## What's Next?

### 📖 **Learn More**

- **[Complete Setup Guide](README.md#configuration)** - Detailed configuration options
- **[Security Documentation](SECURITY.md)** - Understanding the safety system
- **[All Available Tools](README.md#available-tools)** - 8 powerful database operations

### 🛠️ **Advanced Usage**

- **Query Analysis**: `Explain why this query is slow: SELECT * FROM big_table`
- **Schema Discovery**: `Show me all foreign key relationships`
- **Data Export**: `Export the top 100 orders to CSV format`
- **Performance Tuning**: `Analyze the execution plan for my query`

### 🔧 **Customize Security**

- **[Production Deployment](SECURITY.md#production-deployment-guidelines)** - Enterprise security settings
- **[Security Configurations](README.md#security-configurations)** - Different security levels
- **[Migration Guide](README.md#migration-from-previous-versions)** - Upgrading existing setups

## Troubleshooting

**Connection Issues?**

- Verify SQL Server is running: `telnet localhost 1433`
- Check credentials in environment variables
- Review [troubleshooting guide](README.md#troubleshooting-configuration)

**Permission Errors?**

- Ensure database user has appropriate permissions
- Check authentication method (SQL vs Windows)

**Security Blocks?**

- Review security settings in environment variables
- See [security documentation](SECURITY.md) for configuration options

## Get Help

- 📋 **[Issues](https://github.com/egarcia74/warp-sql-server-mcp/issues)** - Report bugs or request features
- 💬 **[Discussions](https://github.com/egarcia74/warp-sql-server-mcp/discussions)** - Community help
- 📖 **[Full Documentation](README.md)** - Complete setup and usage guide

---

**🚀 Ready to supercharge your database work with AI-powered SQL operations!**
