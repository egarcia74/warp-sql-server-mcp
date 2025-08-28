# Warp SQL Server MCP

## Build & Quality Status

[![CI](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml)

## Automation & Monitoring

[![Performance Monitoring](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/performance.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/performance.yml)
[![Documentation](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/docs.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/docs.yml)
[![Auto Label](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/auto-label.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/auto-label.yml)

## Project Info

[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/egarcia74/warp-sql-server-mcp/pulls)
[![Issues](https://img.shields.io/github/issues/egarcia74/warp-sql-server-mcp.svg)](https://github.com/egarcia74/warp-sql-server-mcp/issues)
[![Last Commit](https://img.shields.io/github/last-commit/egarcia74/warp-sql-server-mcp.svg)](https://github.com/egarcia74/warp-sql-server-mcp/commits/main)
[![GitHub Stars](https://img.shields.io/github/stars/egarcia74/warp-sql-server-mcp.svg?style=social)](https://github.com/egarcia74/warp-sql-server-mcp/stargazers)

A Model Context Protocol (MCP) server that provides Warp with the ability to connect to and
interact with Microsoft SQL Server databases.

## Features

- **Database Connection**: Connect to SQL Server on localhost:1433 (configurable)
- **Query Execution**: Execute arbitrary SQL queries
- **Schema Inspection**: List databases, tables, and describe table structures
- **Data Retrieval**: Get sample data from tables with filtering and limiting
- **Authentication**: Support for both SQL Server authentication and Windows authentication

## Available Tools

### Database Operations

1. **execute_query**: Execute any SQL query on the connected database
2. **list_databases**: List all user databases on the SQL Server instance
3. **list_tables**: List all tables in a specific database/schema
4. **describe_table**: Get detailed schema information for a table
5. **get_table_data**: Retrieve sample data from tables with optional filtering
6. **explain_query**: Analyze query performance with execution plans and cost information
7. **list_foreign_keys**: Discover foreign key relationships and constraints in a schema
8. **export_table_csv**: Export table data in CSV format with optional filtering

## Prerequisites

- **Node.js 18.0.0 or higher** (works on Windows, macOS, and Linux)
- **SQL Server instance** running on localhost:1433 (or configured host/port)
- **Appropriate database permissions** for the connecting user

## Platform-Specific Setup

### 🪟 **Windows Setup**

**Advantages on Windows:**

- Native SQL Server integration
- Superior Windows Authentication support
- Seamless domain integration
- Fewer cross-platform authentication issues

**Prerequisites:**

1. **Node.js 18+**: Download from [nodejs.org](https://nodejs.org/)
2. **SQL Server**: SQL Server Express (free) or full SQL Server
3. **SQL Server Configuration**:
   - Enable TCP/IP protocol in SQL Server Configuration Manager
   - Start SQL Server Browser service (for named instances)
   - Configure Windows Firewall if needed

**Installation:**

```powershell
# Clone the repository
git clone <repository-url>
cd warp-sql-server-mcp

# Install dependencies
npm install

# Copy environment template
copy .env.example .env
```

**Configuration (.env file):**

```bash
# For Windows Authentication (Recommended)
SQL_SERVER_HOST=localhost
SQL_SERVER_PORT=1433
SQL_SERVER_DATABASE=master
# Leave these empty for Windows auth:
SQL_SERVER_USER=
SQL_SERVER_PASSWORD=
SQL_SERVER_DOMAIN=YOURDOMAIN  # Optional: your Windows domain

# For SQL Server Authentication
# SQL_SERVER_USER=your_sql_username
# SQL_SERVER_PASSWORD=your_sql_password

# Connection settings
SQL_SERVER_ENCRYPT=false
SQL_SERVER_TRUST_CERT=true
```

### 🍎🐧 **macOS/Linux Setup**

**Installation:**

```bash
# Clone the repository
git clone <repository-url>
cd warp-sql-server-mcp

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

**Configuration (.env file):**

```bash
# For SQL Server Authentication (Most common on macOS/Linux)
SQL_SERVER_HOST=localhost  # or remote SQL Server IP
SQL_SERVER_PORT=1433
SQL_SERVER_DATABASE=master
SQL_SERVER_USER=your_username
SQL_SERVER_PASSWORD=your_password

# For Windows Authentication (if connecting to domain SQL Server)
# SQL_SERVER_USER=
# SQL_SERVER_PASSWORD=
# SQL_SERVER_DOMAIN=YOURDOMAIN

# Connection settings
SQL_SERVER_ENCRYPT=false  # Set to true for remote/production
SQL_SERVER_TRUST_CERT=true
```

## Common Configuration

## Configuration for Warp and MCP Clients

> **⚠️ CRITICAL:** MCP servers run in isolated environments and **do not automatically load
> `.env` files**. You must explicitly provide all configuration through environment variables in
> your MCP client configuration.

### Method 1: Warp MCP Settings (Recommended)

1. **Open Warp Settings**:
   - Open Warp Terminal
   - Press `Cmd+,` or go to `Warp → Settings`
   - Navigate to the **MCP** section

2. **Add New MCP Server**:
   - Click "Add MCP Server"
   - **Name**: `sql-server`
   - **Command**: `node`
   - **Args** (choose based on your platform):
     - **Windows**: `["C:\\Users\\YourName\\path\\to\\warp-sql-server-mcp\\index.js"]`
     - **macOS/Linux**: `["/Users/YourName/path/to/warp-sql-server-mcp/index.js"]`

3. **Environment Variables** (Click "Add Environment Variable" for each):

   ```json
   {
     "SQL_SERVER_HOST": "localhost",
     "SQL_SERVER_PORT": "1433",
     "SQL_SERVER_DATABASE": "master",
     "SQL_SERVER_USER": "your_username",
     "SQL_SERVER_PASSWORD": "your_password",
     "SQL_SERVER_ENCRYPT": "false",
     "SQL_SERVER_TRUST_CERT": "true",
     "SQL_SERVER_CONNECT_TIMEOUT_MS": "10000",
     "SQL_SERVER_REQUEST_TIMEOUT_MS": "30000",
     "SQL_SERVER_MAX_RETRIES": "3",
     "SQL_SERVER_RETRY_DELAY_MS": "1000"
   }
   ```

4. **Authentication Options**:
   - **For SQL Server Authentication**: Include `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD`
   - **For Windows Authentication**: Omit `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD`,
     optionally add `SQL_SERVER_DOMAIN`

5. **Save Configuration** and restart the MCP server

### Method 2: JSON Configuration File

Create or update your MCP configuration file (e.g., `warp-mcp-config.json`):

```json
{
  "mcpServers": {
    "sql-server": {
      "command": "node",
      "args": ["/path/to/your/warp-sql-server-mcp/index.js"],
      "env": {
        "SQL_SERVER_HOST": "localhost",
        "SQL_SERVER_PORT": "1433",
        "SQL_SERVER_DATABASE": "master",
        "SQL_SERVER_USER": "your_username",
        "SQL_SERVER_PASSWORD": "your_password",
        "SQL_SERVER_ENCRYPT": "false",
        "SQL_SERVER_TRUST_CERT": "true",
        "SQL_SERVER_CONNECT_TIMEOUT_MS": "10000",
        "SQL_SERVER_REQUEST_TIMEOUT_MS": "30000",
        "SQL_SERVER_MAX_RETRIES": "3",
        "SQL_SERVER_RETRY_DELAY_MS": "1000"
      }
    }
  }
}
```

**Import into Warp**:

1. Save the JSON configuration file
2. In Warp Settings → MCP, click "Import Configuration"
3. Select your JSON file

### Configuration for Other MCP Clients

For other MCP-compatible systems (Claude Desktop, etc.), use a similar JSON structure:

```json
{
  "mcpServers": {
    "sql-server": {
      "command": "node",
      "args": ["/absolute/path/to/index.js"],
      "env": {
        // Environment variables as shown above
      }
    }
  }
}
```

### Environment Variables Reference

| Variable                        | Required         | Default     | Description               |
| ------------------------------- | ---------------- | ----------- | ------------------------- |
| `SQL_SERVER_HOST`               | Yes              | `localhost` | SQL Server hostname       |
| `SQL_SERVER_PORT`               | Yes              | `1433`      | SQL Server port           |
| `SQL_SERVER_DATABASE`           | Yes              | `master`    | Initial database          |
| `SQL_SERVER_USER`               | For SQL Auth     | -           | Database username         |
| `SQL_SERVER_PASSWORD`           | For SQL Auth     | -           | Database password         |
| `SQL_SERVER_DOMAIN`             | For Windows Auth | -           | Windows domain            |
| `SQL_SERVER_ENCRYPT`            | No               | `false`     | Enable SSL/TLS            |
| `SQL_SERVER_TRUST_CERT`         | No               | `true`      | Trust server certificate  |
| `SQL_SERVER_CONNECT_TIMEOUT_MS` | No               | `10000`     | Connection timeout        |
| `SQL_SERVER_REQUEST_TIMEOUT_MS` | No               | `30000`     | Query timeout             |
| `SQL_SERVER_MAX_RETRIES`        | No               | `3`         | Connection retry attempts |
| `SQL_SERVER_RETRY_DELAY_MS`     | No               | `1000`      | Retry delay               |

### Troubleshooting Configuration

**Common Issues:**

1. **"NTLM authentication error"**
   - Ensure `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD` are set for SQL Server auth
   - Or omit both for Windows authentication

2. **"Connection timeout"**
   - Set `SQL_SERVER_ENCRYPT=false` for local development
   - Verify SQL Server is running on the specified port
   - Check firewall settings

3. **"Server not found"**
   - Verify `SQL_SERVER_HOST` and `SQL_SERVER_PORT` are correct
   - Test connectivity: `telnet localhost 1433`

4. **"Login failed"**
   - Verify username/password in `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD`
   - Ensure the user has database access permissions

**Verification Steps:**

1. Check MCP server logs in Warp for startup messages
2. Look for: "Database connection pool initialized successfully"
3. Test with simple query: "List all databases"
4. Check Warp's MCP server status in Settings

## Usage Examples

Once configured, you can use the MCP tools in Warp:

### List all databases

```text
Please list all databases on the SQL Server
```

### Execute a query

```text
Execute this SQL query: SELECT TOP 10 * FROM Users ORDER BY CreatedDate DESC
```

### Describe a table structure

```text
Can you describe the structure of the Orders table?
```

### Get sample data with filtering

```text
Show me 50 rows from the Products table where Price > 100
```

## Security Considerations

- **Environment Variables**: Store sensitive connection details in environment variables, not in code
- **Least Privilege**: Use database accounts with minimal required permissions
- **Network Security**: Ensure your SQL Server is properly configured for your network environment
- **SSL/TLS**: Consider enabling encryption for production environments

## Authentication Methods

### SQL Server Authentication

Set these environment variables:

```bash
SQL_SERVER_USER=your_username
SQL_SERVER_PASSWORD=your_password
```

### Windows Authentication

Leave `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD` empty. Optionally set:

```bash
SQL_SERVER_DOMAIN=your_domain
```

## Error Handling

The MCP server includes comprehensive error handling for:

- Connection failures
- Authentication issues
- SQL syntax errors
- Permission denied errors
- Network timeouts

All errors are returned as structured MCP error responses with descriptive messages.

## Development

To run in development mode with auto-restart:

```bash
npm run dev
```

To test the server standalone:

```bash
npm start
```

## Testing

This project includes comprehensive unit tests for all functionality using Vitest.

📖 **For detailed test documentation, see [test/README.md](test/README.md)**

### Quick Start

```bash
# Run all tests
npm test

# Run tests in watch mode (reruns on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with UI (if available)
npm run test:ui
```

### Test Overview

- **Total Tests**: 56 tests covering all MCP tools and functionality
- **Test Framework**: Vitest with comprehensive mocking
- **Coverage**: 60.25% statements, 78.04% branches, 83.33% functions
- **Architecture**: Unit tests with mocked SQL Server connections for reliability and speed

### Test Categories

The test suite covers:

- **Core functionality**: All 8 MCP tools (execute_query, list_databases, etc.)
- **Connection handling**: Database connection logic and authentication methods
- **Error scenarios**: Comprehensive error handling and edge cases
- **Advanced features**: Query analysis, foreign keys, CSV export with filtering
- **WHERE clause filtering**: 16 comprehensive filtering tests preventing parameter bugs

### Documentation

For complete test documentation including:

- Detailed test breakdowns by category
- Test architecture and mocking strategy
- Development workflow and best practices
- Coverage analysis and debugging guides

**👉 See [test/README.md](test/README.md)**

## Troubleshooting

### 🪟 **Windows-Specific Troubleshooting**

**SQL Server Configuration:**

1. **Enable TCP/IP Protocol**:
   - Open "SQL Server Configuration Manager"
   - Navigate to "SQL Server Network Configuration" → "Protocols for [Instance]"
   - Enable "TCP/IP" protocol
   - Restart SQL Server service

2. **SQL Server Browser Service**:
   - Open "Services" (services.msc)
   - Start "SQL Server Browser" service
   - Set to "Automatic" startup type

3. **Windows Firewall**:
   - Add inbound rule for port 1433
   - Or temporarily disable firewall for testing

4. **Windows Authentication**:
   - Works seamlessly with domain accounts
   - Run Warp as the user who needs database access
   - No username/password required in configuration

**Testing Connection:**

```powershell
# Test SQL Server connectivity
telnet localhost 1433

# Check SQL Server services
Get-Service -Name "*SQL*"

# Verify port is listening
netstat -an | findstr :1433
```

### 🍎🐧 **macOS/Linux-Specific Troubleshooting**

**Connection Testing:**

```bash
# Test SQL Server connectivity
telnet localhost 1433
# or
nc -zv localhost 1433

# Check if port is reachable
nmap -p 1433 localhost
```

**Common Issues:**

1. **Remote SQL Server**: Often requires SQL Server Authentication
2. **SSL/TLS**: May need `SQL_SERVER_ENCRYPT=true` for remote connections
3. **Network**: Check firewall rules on SQL Server host
4. **Docker**: If using SQL Server in Docker, ensure port mapping

### General Connection Issues

- **Verify SQL Server is running** and accepting connections on port 1433
- **Check firewall settings** on both client and server
- **Ensure TCP/IP protocol is enabled** in SQL Server Configuration Manager
- **Verify authentication credentials** are correct

### Permission Issues

- **Ensure the connecting user has appropriate database permissions**
- **For Windows Authentication**: Run the process with appropriate user context
- **For SQL Server Authentication**: Verify the SQL login exists and has permissions

### Network Issues

- **Test connectivity** using tools like `telnet localhost 1433`
- **Check SQL Server network configuration**
- **Verify named pipes vs TCP/IP settings**
- **Check for VPN or proxy interference**

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2025 Eduardo Garcia-Prieto
