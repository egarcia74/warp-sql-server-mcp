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

> **📖 Need more configuration options?** See the [Complete Environment Variables Reference](ENV-VARS.md) for SSL settings, security configuration, performance tuning, and cloud deployment options.

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

## Available MCP Tools (16 Total)

You can use these with `@sql-server` in natural language or directly:

### 📊 Database Operations

- `List databases` / **list_databases** - Show all available databases
- `List tables in [database]` / **list_tables** - Show tables in a specific database
- `Describe [table]` / **describe_table** - Get schema information for a table
- `Get sample data from [table]` / **get_table_data** - Retrieve sample rows
- `Export [table] to CSV` / **export_table_csv** - Export table data
- `Show foreign key relationships` / **list_foreign_keys** - Database relationships
- `Execute query: [SQL]` / **execute_query** - Execute SQL queries
- `Explain query: [SQL]` / **explain_query** - Get execution plan analysis

### ⚡ Performance & Monitoring

- `Get performance stats` / **get_performance_stats** - Server performance metrics
- `Show query performance` / **get_query_performance** - Query performance breakdown
- `Check connection health` / **get_connection_health** - Connection pool status
- `Analyze query performance` / **analyze_query_performance** - Query optimization analysis
- `Get index recommendations` / **get_index_recommendations** - Index optimization suggestions
- `Detect query bottlenecks` / **detect_query_bottlenecks** - Performance bottleneck detection
- `Get optimization insights` / **get_optimization_insights** - Database health analysis
- `Show server info` / **get_server_info** - Server configuration and status

> **📋 Complete API Documentation**: See [MCP Tools Reference](https://egarcia74.github.io/warp-sql-server-mcp/tools.html) for detailed parameters and examples.

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

> **🔒 Security configuration details:** See the [Environment Variables Reference](ENV-VARS.md#database-security-settings)
> for complete security options, including examples for production, data analysis, and development modes.

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

> **🔧 Detailed troubleshooting:** Check the [Environment Variables Reference](ENV-VARS.md#troubleshooting)
> for comprehensive troubleshooting guides covering connection issues, SSL problems, and performance
> optimization.
>
> **💬 Terminal user?** Try our [Warp Terminal Guide](QUICKSTART.md) for command-line workflows and
> AI-powered database operations!

---

**🤖 Enjoy AI-powered database development with GitHub Copilot!**
