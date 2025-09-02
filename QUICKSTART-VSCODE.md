# VS Code Copilot + SQL Server MCP Guide

Connect **GitHub Copilot** in VS Code directly to your **SQL Server** using MCP! 🤖

## What You Get

- ✅ **GitHub Copilot** can query your SQL Server databases
- ✅ **Context-aware suggestions** based on your actual schema
- ✅ **Natural language** to SQL query generation
- ✅ **Real-time database insights** while coding

## Prerequisites

- ✅ **Node.js 18+** installed
- ✅ **SQL Server** running (localhost:1433)
- ✅ **VS Code** with **GitHub Copilot** extension
- ✅ **GitHub Copilot subscription** (required for MCP support)

## Step 1: Install MCP Server

```bash
# Install the MCP server globally
npm install -g @egarcia74/warp-sql-server-mcp

# Initialize configuration
warp-sql-server-mcp init

# Edit the config file with your SQL Server credentials
# File: ~/.warp-sql-server-mcp.json
```

## Step 2: Configure VS Code MCP Settings

1. **Open VS Code Settings**: `Cmd+,` (or `Ctrl+,` on Windows)

2. **Search for**: `copilot.chat.experimental.mcp`

3. **Enable MCP**: Check the box for "Enable MCP support"

4. **Add MCP Server Configuration**:
   - Click "Edit in settings.json"
   - Add the MCP server configuration:

```json
{
  "github.copilot.chat.experimental.mcp.servers": {
    "sql-server": {
      "command": "warp-sql-server-mcp",
      "args": ["start"]
    }
  }
}
```

## Step 3: Restart VS Code

**Important**: Restart VS Code completely to load the MCP server.

## Step 4: Test Copilot Integration

1. **Open GitHub Copilot Chat**: `Cmd+Shift+I` (or click the chat icon)

2. **Test database connectivity**:

```text
@sql-server List all databases
```

1. **Try schema exploration**:

```text
@sql-server Show me tables in the AdventureWorks database
```

1. **Ask for query help**:

```text
@sql-server Generate a query to find the top 10 customers by sales
```

## 🎉 You're All Set

Now GitHub Copilot can:

- ✅ **Query your databases** directly through chat
- ✅ **Generate SQL** based on your actual schema
- ✅ **Provide insights** about your data
- ✅ **Help optimize** existing queries

## Typical Workflow

### Schema Discovery

**Ask Copilot:**

```text
@sql-server What's the structure of the Users table?
```

### Query Generation

**Ask Copilot:**

```text
@sql-server Create a query to find users who registered in the last 30 days
```

### Performance Analysis

**Ask Copilot:**

```text
@sql-server Analyze the performance of this query: SELECT * FROM Orders WHERE OrderDate > '2023-01-01'
```

### Data Export

**Ask Copilot:**

```text
@sql-server Export the top 100 products to CSV format
```

## Available MCP Commands

You can use these commands with `@sql-server`:

- `List databases` - Show all available databases
- `List tables in [database]` - Show tables in a specific database
- `Describe [table]` - Get schema information for a table
- `Get sample data from [table]` - Retrieve sample rows
- `Export [table] to CSV` - Export table data
- `Explain query: [SQL]` - Get execution plan analysis
- `Get performance stats` - Server performance metrics
- `Get foreign key relationships` - Database relationships

## Security Configuration

The MCP server runs in **secure mode** by default:

- 🔒 **Read-only**: Only SELECT queries allowed
- 🔒 **No destructive operations**: No INSERT/UPDATE/DELETE
- 🔒 **No schema changes**: No CREATE/DROP/ALTER

To modify security settings, edit your config file:

```json
{
  "SQL_SERVER_READ_ONLY": "false",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
}
```

## Troubleshooting

**Copilot not finding the MCP server?**

1. Verify the server is installed: `warp-sql-server-mcp config`
2. Check VS Code settings have the correct MCP configuration
3. Restart VS Code completely
4. Check VS Code Developer Console (`Help` → `Toggle Developer Tools`)

**Connection issues?**

- Verify SQL Server is running: `telnet localhost 1433`
- Check your config file credentials: `warp-sql-server-mcp config`
- Test the MCP server directly: `warp-sql-server-mcp start`

**Permission errors?**

- Ensure your SQL Server user has appropriate permissions
- Check the security settings in your config file
- Review the MCP server logs in VS Code Developer Console

> **💬 Terminal user?** Try our [Warp Terminal Guide](QUICKSTART.md) for command-line workflows and AI-powered database operations!

**Want more features?** See the [complete documentation](README.md)

---

**🤖 Enjoy AI-powered database development with GitHub Copilot!**
