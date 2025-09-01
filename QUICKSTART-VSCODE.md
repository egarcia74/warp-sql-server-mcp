# VS Code + SQL Server MCP Guide

Use **VS Code database tools** alongside **Warp's AI** for the ultimate database experience! 🚀

## What You Get

- ✅ **VS Code SQL Extensions** - Write and execute queries directly
- ✅ **Warp AI Integration** - Ask questions about your database
- ✅ **Best of Both Worlds** - Traditional tools + AI assistance

## Prerequisites

- ✅ **Node.js 18+** installed
- ✅ **SQL Server** running (localhost:1433)
- ✅ **VS Code** installed
- ✅ **Warp Terminal** installed

## Step 1: Install MCP Server

```bash
# Install the MCP server globally
npm install -g @egarcia74/warp-sql-server-mcp

# Configure it
warp-sql-server-mcp init
# Edit ~/.warp-sql-server-mcp.json with your database credentials
```

## Step 2: Install VS Code SQL Extensions

**Open VS Code Command Palette** (`Cmd+Shift+P`) and run:

```text
ext install ms-mssql.mssql
```

Optionally, also install:

```text
ext install mtxr.sqltools
ext install mtxr.sqltools-driver-mssql
```

## Step 3: Connect Warp to Your Database

1. **Open Warp Settings**: `Cmd+,` → **MCP** tab
2. **Add New Server**:
   - **Name**: `sql-server`
   - **Command**: `warp-sql-server-mcp`
   - **Args**: `["start"]`

## Step 4: Test Both Tools

### Test Warp AI Integration

**In Warp, try these commands:**

```text
List all databases
```

```text
Show me tables in the master database
```

### Test VS Code SQL Extension

1. **Connect to database**:
   - `Cmd+Shift+P` → "MS SQL: Connect"
   - Enter your connection details (same as MCP config)

2. **Create a test query**:
   - New file: `test-query.sql`
   - Add: `SELECT @@VERSION;`
   - Execute: `Cmd+Shift+E`

## 🎉 You're All Set

Now you have:

- ✅ **Warp AI** for natural language database queries
- ✅ **VS Code** for traditional SQL development
- ✅ **Best of both worlds** for database work!

## Typical Workflow

### Database Exploration

**Use Warp AI:**

```text
What tables are in my AdventureWorks database?
```

### Query Development

**Use VS Code:**

1. Write SQL in `.sql` files
2. Test with `Cmd+Shift+E`
3. Save for reuse

### Query Analysis

**Use Warp AI:**

```text
Explain this query performance: SELECT * FROM Orders WHERE OrderDate > '2023-01-01'
```

## Need Help?

**Connection issues?**

- Verify SQL Server is running: `telnet localhost 1433`
- Check your MCP config file credentials
- Ensure VS Code and Warp use the same connection details

**Want more features?** See the [complete documentation](README.md)

---

**🚀 Enjoy the best of both worlds: traditional SQL tools + AI assistance!**
