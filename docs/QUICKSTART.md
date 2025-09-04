# Quick Start Guide

Get your **SQL Server MCP** running in Warp in under 3 minutes! 🚀

## Prerequisites

- ✅ **Node.js 18+** installed
- ✅ **SQL Server** running (localhost:1433)
- ✅ **Warp Terminal** installed

## Step 1: Install

```bash
# Install globally via npm
npm install -g @egarcia74/warp-sql-server-mcp
```

## Step 2: Configure

1. **Initialize configuration**:

   ```bash
   warp-sql-server-mcp init
   ```

2. **Edit the config file** with your SQL Server details:

   ```bash
   # Opens ~/.warp-sql-server-mcp.json
   # Update these values:
   #   "SQL_SERVER_USER": "your_username"
   #   "SQL_SERVER_PASSWORD": "your_password"
   ```

   > **📖 Need more configuration options?** See the [Complete Environment Variables Reference](ENV-VARS.md) for all available settings including SSL, security, performance, and cloud deployment options.

3. **Add to Warp**:
   - Open Warp Settings: `Cmd+,` → **MCP** tab
   - Click "Add New Server"
   - **Name**: `sql-server`
   - **Command**: `warp-sql-server-mcp`
   - **Args**: `["start"]`

## Step 3: Test It

**Try these commands in Warp:**

```text
List all databases
```

```text
Show me tables in the master database
```

## 🎉 You're Done

Your SQL Server is now connected to Warp's AI! 🤖

> **💻 Using VS Code?** Check out our [VS Code + GitHub Copilot Guide](QUICKSTART-VSCODE.md) for AI-powered database development directly in your IDE!

## What You Can Do

**Ask Warp about your database using natural language:**

- `Show me all foreign key relationships`
- `Export the top 100 customers to CSV`
- `Explain this query: SELECT * FROM Orders`
- `What tables are in my database?`
- `Get performance stats for my database`
- `Show me the server configuration`
- `Analyze bottlenecks in my queries`

## Available MCP Tools (16 Total)

**📊 Database Operations:**

- **execute_query** - Execute SQL queries
- **list_databases** - List all databases
- **list_tables** - List tables in database
- **describe_table** - Get table schema
- **get_table_data** - Get sample data
- **list_foreign_keys** - Show relationships
- **export_table_csv** - Export data as CSV
- **explain_query** - Analyze query plans

**⚡ Performance & Monitoring:**

- **get_performance_stats** - Server performance metrics
- **get_query_performance** - Query performance breakdown
- **get_connection_health** - Connection pool status
- **analyze_query_performance** - Query optimization analysis
- **get_index_recommendations** - Index optimization suggestions
- **detect_query_bottlenecks** - Performance bottleneck detection
- **get_optimization_insights** - Database health analysis
- **get_server_info** - Server configuration and status

> **📋 Complete API Documentation**: See [MCP Tools Reference](https://egarcia74.github.io/warp-sql-server-mcp/tools.html) for detailed parameters and examples.

## Need Help?

**Not connecting?**

- Check that SQL Server is running: `telnet localhost 1433`
- Verify your username/password in the config file
- Review SSL settings if using remote servers

> **🔧 Advanced configuration?** Check the [Environment Variables Reference](ENV-VARS.md) for detailed troubleshooting, SSL settings, security configuration, and performance tuning options.

**Want more features?** See the [complete documentation](README.md)

---

**🚀 Enjoy AI-powered database queries!**
