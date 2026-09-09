# VS Code Copilot + SQL Server MCP Guide

> **Audience**: First-time users wiring the server into VS Code + GitHub Copilot

Connect **GitHub Copilot** in VS Code directly to your **SQL Server** using MCP! 🤖

## What You Get

- ✅ **GitHub Copilot** can query your SQL Server databases
- ✅ **Context-aware suggestions** based on your actual schema
- ✅ **Natural language** to SQL query generation
- ✅ **Real-time database insights** while coding

## Prerequisites

- ✅ **Node.js 20.19+** installed
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

> **📖 Need more configuration options?** See the
> [Complete Environment Variables Reference](../reference/ENV-VARS.md) for SSL settings, security
> configuration, performance tuning, and cloud deployment options.

## Step 2: Register the MCP Server with VS Code

MCP servers live in an `mcp.json` file, **not** in `settings.json`. There are two routes to
the same result.

**Guided (recommended)**: `Cmd+Shift+P` (`Ctrl+Shift+P` on Windows/Linux) → **MCP: Add
Server** → **Command (stdio)** → command `warp-sql-server-mcp`, arguments `start` → server
ID `sql-server` → then pick **Global** (available in every workspace) or **Workspace**
(this project only, written to `.vscode/mcp.json`).

**Manual**: run **MCP: Open User Configuration** for the user-level `mcp.json`, or create
`.vscode/mcp.json` at the root of your project, and add:

```json
{
  "servers": {
    "sql-server": {
      "type": "stdio",
      "command": "warp-sql-server-mcp",
      "args": ["start"]
    }
  }
}
```

## Step 3: Start the Server

Open `mcp.json` and select the **Start** action shown above the `sql-server` entry; the
label changes to **Running**. If you edit the file later, use **Restart** rather than
restarting VS Code.

## Step 4: Test Copilot Integration

1. **Open Chat**: `Cmd+Shift+I` (or click the chat icon) and switch the mode selector to
   **Agent** - MCP tools are surfaced in agent mode, not in Ask mode.

2. **Enable the tools**: click the tools icon in the prompt box and tick the `sql-server`
   entry. Newly added MCP tools start unchecked.

3. **Test database connectivity** - ask in natural language, or name a tool with `#`:

```text
List all databases on the SQL Server
```

1. **Try schema exploration**:

```text
Show me the tables in the AdventureWorks database
```

1. **Ask for query help**:

```text
Find the top 10 customers by sales
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
What's the structure of the Users table?
```

### Query Generation

**Ask Copilot:**

```text
Create a query to find users who registered in the last 30 days
```

### Performance Analysis

**Ask Copilot:**

```text
Analyze the performance of this query: SELECT * FROM Orders WHERE OrderDate > '2023-01-01'
```

### Data Export

**Ask Copilot:**

```text
Export the top 100 products to CSV format
```

## Available MCP Tools (16 Total)

Ask for these in natural language, or reference one directly in the prompt with `#`
(for example `#list_databases`):

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

> **🔒 Security configuration details:** See the [Environment Variables Reference](../reference/ENV-VARS.md#database-security-settings)
> for complete security options, including examples for production, data analysis, and development modes.

## Troubleshooting

**📋 Get comprehensive help:**

```bash
warp-sql-server-mcp help   # Show all available commands
```

**📊 Monitor server activity:**

You installed the server globally, so the `npm run logs*` scripts are not available -
they live in the git repository, and `scripts/` is not part of the published package.
VS Code captures the MCP server's output for you: open the **Output** panel
(`View` → `Output`) and select the GitHub Copilot channel.

To get log files of your own, set `LOG_FILE` (and `SECURITY_LOG_FILE` with
`ENABLE_SECURITY_AUDIT=true`) in the server's `env` block, then read that path directly.

**Copilot not finding the MCP server?**

1. Verify the server is installed: `warp-sql-server-mcp config`
2. Check VS Code settings have the correct MCP configuration
3. Restart VS Code completely
4. Check VS Code Developer Console (`Help` → `Toggle Developer Tools`)
5. Watch the Copilot **Output** channel while you send a query

**Connection issues?**

- Verify SQL Server is running: `telnet localhost 1433`
- Check your config file credentials: `warp-sql-server-mcp config`
- Test the MCP server directly: `warp-sql-server-mcp start`
- Review the Copilot **Output** channel for errors

**Permission errors?**

- Ensure your SQL Server user has appropriate permissions
- Check the security settings in your config file
- Review the MCP server logs in VS Code Developer Console

> **🔧 Detailed troubleshooting:** Check the [Environment Variables Reference](../reference/ENV-VARS.md#troubleshooting)
> for comprehensive troubleshooting guides covering connection issues, SSL problems, and performance
> optimization.
>
> **💬 Terminal user?** Try our [Warp Terminal Guide](QUICKSTART.md) for command-line workflows and
> AI-powered database operations!

---

**🤖 Enjoy AI-powered database development with GitHub Copilot!**
