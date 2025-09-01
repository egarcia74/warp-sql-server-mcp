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

## What You Can Do

**Ask Warp about your database:**

- `Show me all foreign key relationships`
- `Export the top 100 customers to CSV`
- `Explain this query: SELECT * FROM Orders`
- `What tables are in my database?`

## Need Help?

**Not connecting?**

- Check that SQL Server is running: `telnet localhost 1433`
- Verify your username/password in the config file

**Want more features?** See the [complete documentation](README.md)

---

**🚀 Enjoy AI-powered database queries!**
