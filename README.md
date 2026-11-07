# SQL Server MCP - AI-Powered Database Integration

Connect AI assistants to your SQL Server databases with enterprise-grade security and performance.

> **🤖 AI-First Database Access**: Enable GitHub Copilot, Warp AI, and other assistants to interact with your SQL
> Server databases through natural language queries, with comprehensive security controls and production-ready reliability.

[![CI](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml)
[![Node.js Version](https://img.shields.io/badge/Node.js-22.12%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://spdx.org/licenses/MIT.html)

---

## 🚀 Quick Start

This package runs a **local stdio MCP server**. Configure SQL Server access once, then register it
with your client below. It does not provide an HTTP URL for hosted chat connectors.

### Install and configure once

Install Node.js **22.12+** and the scoped package on the machine that runs your MCP client:

```bash
npm install -g @egarcia74/warp-sql-server-mcp
warp-sql-server-mcp --version
warp-sql-server-mcp init
```

Edit `~/.warp-sql-server-mcp.json` locally with your approved SQL host, database and least-privilege
SQL authentication credentials. On native Windows, the usual location is
`%USERPROFILE%\.warp-sql-server-mcp.json`; an explicitly set `HOME` takes precedence.

New configurations enable TLS and certificate validation, with read-only mode on and destructive
operations/schema changes off. Keep those defaults. Existing files are **not overwritten** by `init`.
The file stores credentials in **plaintext**, with POSIX mode `0600` requested; review Windows ACLs
separately. Never commit it or put passwords in shell commands or chat.

Use the scoped package `@egarcia74/warp-sql-server-mcp`. The deprecated unscoped package stopped at
1.7.10 and lacks later security fixes. See the [complete setup guide](docs/user/MCP-CLIENT-SETUP.md)
for the configuration template, version pinning and certificate guidance.

### Choose your client

| Client                    | Native setup                              | Detailed guide                                                               |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| Codex                     | [CLI](#codex)                             | [TOML, scope and verification](docs/user/MCP-CLIENT-SETUP.md#codex)          |
| Claude Code               | [CLI](#claude-code)                       | [User/project scope](docs/user/MCP-CLIENT-SETUP.md#claude-code)              |
| Claude Desktop            | [JSON](#claude-desktop)                   | [Config locations](docs/user/MCP-CLIENT-SETUP.md#claude-desktop)             |
| Cursor                    | [JSON](#cursor)                           | [User/project configuration](docs/user/MCP-CLIENT-SETUP.md#cursor)           |
| Gemini CLI                | [CLI](#gemini-cli)                        | [Scope and secret handling](docs/user/MCP-CLIENT-SETUP.md#gemini-cli)        |
| GitHub Copilot CLI        | [Interactive setup](#github-copilot-cli)  | [JSON and version caveats](docs/user/MCP-CLIENT-SETUP.md#github-copilot-cli) |
| OpenCode                  | [JSON](#opencode)                         | [Configuration and verification](docs/user/MCP-CLIENT-SETUP.md#opencode)     |
| Warp                      | [MCP settings](#warp)                     | [Warp quickstart](docs/user/QUICKSTART.md)                                   |
| GitHub Copilot in VS Code | [MCP command](#github-copilot-in-vs-code) | [VS Code quickstart](docs/user/QUICKSTART-VSCODE.md)                         |

The commands below assume macOS/Linux and an executable on the client's PATH. For **Windows or GUI
PATH problems**, use the [absolute Node and cli.js recipe](docs/user/MCP-CLIENT-SETUP.md#windows-and-gui-launchers).
Merge JSON entries with existing configuration, preserving other servers. Enabling a server makes
its tools available under that client's permission policy; retain its trust and approval controls.

#### Codex

```bash
codex mcp add sql-server -- warp-sql-server-mcp start
codex mcp list
```

Inspect `/mcp` in a new session. User configuration lives in `~/.codex/config.toml`.

#### Claude Code

```bash
claude mcp add --transport stdio --scope user sql-server -- warp-sql-server-mcp start
claude mcp get sql-server
```

This explicitly selects cross-project user scope. Inspect `/mcp` in a new session.

#### Claude Desktop

Open **Settings → Developer → Edit Config**, merge this entry, then fully quit and reopen:

```json
{
  "mcpServers": {
    "sql-server": {
      "command": "warp-sql-server-mcp",
      "args": ["start"]
    }
  }
}
```

#### Cursor

Add to `~/.cursor/mcp.json` for user scope, or `.cursor/mcp.json` for the project, then enable the server:

```json
{
  "mcpServers": {
    "sql-server": {
      "type": "stdio",
      "command": "warp-sql-server-mcp",
      "args": ["start"]
    }
  }
}
```

#### Gemini CLI

```bash
gemini mcp add --scope user --transport stdio sql-server warp-sql-server-mcp start
gemini mcp list
```

This explicitly selects user scope instead of the project default. Inspect `/mcp`; do not add `--trust`.

#### GitHub Copilot CLI

Enter **`/mcp add`** in an interactive session. Choose local/stdio, name `sql-server`, command
`warp-sql-server-mcp start`, and set `HOME` in the server environment to the actual directory
containing your saved config. Select the needed tools, including `get_server_info` and `execute_query`
for verification. Inspect **`/mcp show sql-server`**. These interactive commands are documented in
older CLI help too; newer noninteractive `copilot mcp` subcommands are version-dependent.

#### OpenCode

Merge into user `~/.config/opencode/opencode.json` or project `opencode.json`:

```json
{
  "mcp": {
    "sql-server": {
      "type": "local",
      "command": ["warp-sql-server-mcp", "start"],
      "enabled": true
    }
  }
}
```

Start a new session and inspect `opencode mcp list`.

#### Warp

In **Settings → MCP**, add name `sql-server`, command `warp-sql-server-mcp`, arguments `["start"]`.
Start/enable the server and inspect its available tools.

#### GitHub Copilot in VS Code

Run **MCP: Add Server → Command (stdio)**, enter command `warp-sql-server-mcp`, argument `start`,
and name `sql-server`. Choose user/global or workspace scope. Workspace configuration belongs in
`.vscode/mcp.json` under **`servers`**, not `mcpServers`. Start the entry, select Copilot Agent mode
and enable the needed tools.

### Verify the connection

Use an approved non-production database for initial setup.

First ask your client to call `get_server_info`. Confirm the intended host/database, TLS settings,
and read-only `true`, destructive `false`, schema changes `false`. Then ask it to call
`execute_query` in your approved database with:

```sql
SELECT 1 AS mcp_ok
```

A returned row proves SQL access; an MCP “connected” indicator alone does not. Startup establishes
stdio, while a database operation opens the SQL connection. Read-only results can still contain
sensitive information, so follow your organization's AI/data policies.

These are documented recipes, not a claim that every client/OS combination was tested. See
[verification status and version caveats](docs/user/MCP-CLIENT-SETUP.md#compatibility-and-maintenance).

---

## ✨ What You Get

- 🤖 **Natural language to SQL** - Ask questions, get queries
- 🔒 **Enterprise security** - Three-tier safety system with secure defaults
- 📊 **Performance insights** - Query optimization and bottleneck detection
- 🚀 **Streaming support** - Memory-efficient handling of large datasets
- 📈 **16 Database Tools** - Complete database operations through AI

---

## 🔒 Security Levels (Quick Reference)

| Security Level                | Environment Variable                      | Default | Impact                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🔒 Read-Only Mode**         | `SQL_SERVER_READ_ONLY`                    | `true`  | Only SELECT queries allowed                                                                                                                                                                                                                             |
| **⚠️ Destructive Operations** | `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | Controls INSERT/UPDATE/DELETE/MERGE/TRUNCATE, EXEC, WRITETEXT/UPDATETEXT, Service Broker RECEIVE, and administrative operations (SHUTDOWN, KILL, BACKUP/RESTORE, DBCC, RECONFIGURE, CHECKPOINT, SETUSER, `xp_*`/`sp_*`, linked-server rowset functions) |
| **🚨 Schema Changes**         | `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | Controls CREATE/DROP/ALTER, GRANT/REVOKE/DENY, ENABLE/DISABLE TRIGGER, and `SELECT ... INTO`                                                                                                                                                            |

`NEXT VALUE FOR` consumes sequence state, so read-only mode and the destructive-operations
restriction block it even inside a `SELECT`. Use a SQL login without sequence `UPDATE`
permission for read-only tools as an additional database-level boundary.

Every statement in a batch is checked against these tiers — T-SQL does not require `;` between
statements — and batches with unterminated string literals, identifiers, or comments are rejected.

**🔒 Maximum Security (Default - Production Recommended):**

```bash
SQL_SERVER_READ_ONLY=true                      # Only SELECT allowed
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false  # No data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false         # No schema changes
```

---

## 📋 Essential Environment Variables

> **📖 Complete Reference**: See **[docs/reference/ENV-VARS.md](docs/reference/ENV-VARS.md)** for comprehensive documentation of all environment variables, defaults, and context-aware behavior.

| Variable                | Required     | Default                              | Description              |
| ----------------------- | ------------ | ------------------------------------ | ------------------------ |
| `SQL_SERVER_HOST`       | No           | `localhost`                          | SQL Server hostname      |
| `SQL_SERVER_PORT`       | No           | `1433`                               | SQL Server port          |
| `SQL_SERVER_DATABASE`   | No           | `master`                             | Initial database         |
| `SQL_SERVER_USER`       | For SQL Auth | -                                    | Database username        |
| `SQL_SERVER_PASSWORD`   | For SQL Auth | -                                    | Database password        |
| `SQL_SERVER_ENCRYPT`    | No           | `true`                               | Enable SSL/TLS           |
| `SQL_SERVER_TRUST_CERT` | No           | _context-aware_; CLI `init`: `false` | Trust server certificate |

> **💡 Authentication**: The cross-platform quickstart uses SQL authentication. The implementation has an NTLM branch, but integrated Windows sign-on must be validated separately for your environment.
> **💡 SSL Certificates**: New CLI configs explicitly set `SQL_SERVER_TRUST_CERT=false`.
> Direct environment-only starts use context-aware defaults unless it is exactly `true` or `false`.
> Set an explicit lowercase value for predictable behavior.

---

## 🎯 Use Cases

### **🔍 Database Analysis & Exploration**

- **Schema Discovery**: Reverse engineer legacy databases without documentation
- **Data Quality Assessment**: Spot-check data integrity across tables
- **New Team Onboarding**: Rapidly explore unfamiliar database schemas

### **📊 Business Intelligence & Reporting**

- **Ad-hoc Analysis**: Quick business questions through natural language
- **Data Export**: Export filtered datasets to CSV for analysis
- **Revenue Analysis**: AI-powered business insights

### **🛠️ Development & DevOps**

- **Query Performance Tuning**: Execution plan analysis and optimization
- **API Development**: Quickly test database queries during development
- **Database Troubleshooting**: Debug slow queries and identify bottlenecks

### **🚀 AI-Powered Operations**

- **Natural Language to SQL**: Ask questions like "Show me customers who haven't placed orders"
- **Query Optimization**: "Why is this query running slowly?"
- **Automated Insights**: Generate business reports through conversational queries

---

## 📚 Complete Documentation

**[📋 Complete Documentation Index](docs/README.md)** - Navigate all documentation in one place

### **User Guides**

- **[Environment Variables Reference](docs/reference/ENV-VARS.md)** - Complete environment variables documentation
- **[Security Guide](docs/architecture/SECURITY.md)** - Comprehensive security configuration and threat model
- **[Security Threat Analysis Process](WARP.md#security-threat-analysis--response-process)** - Workflows for reviewing and responding to security alerts
- **[Architecture Guide](docs/architecture/ARCHITECTURE.md)** - Technical deep-dive and system design
- **[All MCP Tools](https://egarcia74.github.io/warp-sql-server-mcp/tools.html)** - Complete API reference (16 tools)

### **Setup Guides**

- **[Native MCP Client Setup](docs/user/MCP-CLIENT-SETUP.md)** - Nine client recipes, Windows/PATH guidance, credential handling and verification
- **[VS Code Integration Guide](docs/user/VSCODE-INTEGRATION-GUIDE.md)** - Advanced workflows and configuration

### **Developer Resources**

- **[Software Engineering Manifesto](MANIFESTO.md)** - Philosophy and engineering practices
- **[Quality No-Compromise Case Study](docs/developer/QUALITY-NO-COMPROMISE.md)** - Real-world analysis of zero-tolerance quality standards
- **[Testing Guide](test/README.md)** - Comprehensive test documentation (1,694 automated unit tests)
- **[Contributing Guide](CONTRIBUTING.md)** - Development workflow and standards
- **[Git Commit Checklist](docs/developer/GIT-COMMIT-CHECKLIST.md)** - Pre-commit quality gates and guidelines
- **[Git Push Checklist](docs/developer/GIT-PUSH-CHECKLIST.md)** - Pre-push validation and deployment guidelines
- **[Git Release Checklist](docs/developer/GIT-RELEASE-CHECKLIST.md)** - Step-by-step release guide (automation + npm)

---

## 🧪 Production Validation

**✅ PRODUCTION-VALIDATED**: This MCP server has been **fully tested** through:

- **1,761 Tests**: All MCP tools, security boundaries, error scenarios - **every one of them runs
  automatically on every pull request** (1,694 unit + 27 integration + 40 live-database against a
  Docker SQL Server CI starts itself)
- **40 Live-Database Integration Tests**: Live database validation across all security phases, run in CI
- **MCP Protocol Validation**: `test/protocol/mcp-server-startup-test.js` checks server startup and
  the JSON-RPC initialize handshake. `npm run test:integration:protocol` runs it in CI;
  `npm run docker:test -- protocol` runs the same file against a container it starts for you
- **100% Success Rate**: All security phases validated in production scenarios

### 🐳 **Quick Testing with Docker** (Recommended for Development)

```bash
# One-command testing with automated SQL Server container
npm run test:integration

# This will:
# 1. 🐳 Start SQL Server 2022 container
# 2. ⏱️ Wait for database initialization (2-3 minutes)
# 3. 🧪 Run all integration tests
# 4. 🔄 Clean up and stop container
```

**Benefits:** ✨ Zero configuration, 🛡️ Complete isolation, ⚡ Fast setup, 📋 Consistent environment

**[Complete Docker Testing Guide →](test/docker/README.md)**

### 🔧 **Manual Setup Testing** (Production Validation)

**Security Phases Tested:**

- **Phase 1 (Read-Only)**: Maximum security - 20/20 tests ✅
- **Phase 2 (DML Operations)**: Selective permissions - 10/10 tests ✅
- **Phase 3 (DDL Operations)**: Full development mode - 10/10 tests ✅

```bash
# Quick Start - Get comprehensive help
npm run help               # Show all commands with detailed descriptions

# Run tests locally
npm test                   # All automated unit + integration tests
npm run test:coverage      # Coverage report with detailed metrics
npm run test:integration   # 🚀 Complete integration test suite with Docker
npm run test:integration:ci  # For CI environments with external database
npm run test:integration:performance  # ⭐ Fast performance validation (~2s)

# View logs and monitor activity
npm run logs               # Show recent server logs
npm run logs:tail          # Follow logs in real-time
npm run logs:audit         # Show security audit logs
```

---

## 🔧 Usage Examples

Once configured, you can use natural language with your AI assistant:

### **VS Code + GitHub Copilot**

```text
List all databases on the SQL Server
Show me tables in the AdventureWorks database
Generate a query to find the top 10 customers by sales
Analyze the performance of this query: SELECT * FROM Orders WHERE OrderDate > '2023-01-01'
```

### **Warp Terminal**

```text
Please list all databases on the SQL Server
Execute this SQL query: SELECT TOP 10 * FROM Users ORDER BY CreatedDate DESC
Can you describe the structure of the Orders table?
Show me 50 rows from the Products table where Price > 100
```

---

## 🚨 Troubleshooting

### **Common Issues**

**Connection Problems:**

- Verify SQL Server is running on the specified port: `telnet localhost 1433`
- Check firewall settings on both client and server
- Enable TCP/IP protocol in SQL Server Configuration Manager

**Authentication Issues:**

- For SQL Server Auth: Verify `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD`
- Integrated authentication needs separate validation; use approved SQL authentication for the cross-platform quickstart
- Ensure the connecting user has appropriate database permissions

**Configuration Issues:**

- Keep `SQL_SERVER_ENCRYPT=true`; for an isolated local server with a self-signed certificate,
  explicitly set `SQL_SERVER_TRUST_CERT=true` or install a trusted test certificate
- Nonempty environment values override the home config; working-directory `.env` can fill absent values. See [configuration precedence](docs/reference/ENV-VARS.md#environment-variable-precedence)
- Read your client's captured MCP stderr. Global npm installs do not include repository `npm run logs*` scripts
- For explicit log files and other failures, see [client troubleshooting](docs/user/MCP-CLIENT-SETUP.md#troubleshooting)

### **Platform-Specific**

**Windows:**

- Enable TCP/IP in SQL Server Configuration Manager
- Start SQL Server Browser service for named instances
- Use the [native Windows launcher recipe](docs/user/MCP-CLIENT-SETUP.md#windows-and-gui-launchers); do not assume integrated authentication works without a separate test

**macOS/Linux:**

- Remote SQL Server connections often require SQL Server Authentication
- Keep `SQL_SERVER_ENCRYPT=true` and `SQL_SERVER_TRUST_CERT=false` for remote connections
- Test connectivity: `nc -zv localhost 1433` or `nmap -p 1433 localhost`

---

## 🤝 Contributing

This project demonstrates enterprise-grade software engineering practices. We welcome contributions that maintain our high standards:

1. **Fork the repository** and create a feature branch
2. **Follow TDD practices** - write tests first!
3. **Maintain code quality** - all commits trigger automated quality checks
4. **Add comprehensive tests** for new functionality
5. **Update documentation** as needed
6. **Submit a pull request** with detailed description

**Development Commands:**

```bash
# Get comprehensive help for all available commands
npm run help               # Show organized command reference with descriptions

# Core development
npm run dev                # Development mode with auto-restart
npm test                   # Run all tests
npm run lint:fix          # Fix linting issues
npm run format            # Format code
npm run ci                 # Full CI pipeline locally

# Log viewing and monitoring
npm run logs               # Show recent server logs
npm run logs:tail          # Follow server logs in real-time
npm run logs:audit         # Show security audit logs
npm run logs:tail:audit    # Follow audit logs in real-time

# System maintenance and cleanup
npm run cleanup            # List leftover test processes (reports only)
npm run cleanup:processes  # Same as cleanup (alias)
npm run cleanup -- --kill <pid>   # Terminate a listed process by PID
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Copyright (c) 2025 Eduardo Garcia-Prieto

---

## 🌟 About This Project

While this appears to be an MCP server for SQL Server integration, it's fundamentally **a comprehensive framework
demonstrating enterprise-grade software development practices**. Every component, pattern, and principle here
showcases rigorous engineering standards that can be applied to any production system.

**Key Engineering Highlights:**

- 🔬 **1,761 Tests** covering all functionality and edge cases - every one of them runs automatically on every pull request
- 🛡️ **Multi-layered Security** with defense-in-depth architecture
- 📊 **Production Observability** with structured logging and performance monitoring
- ⚡ **Enterprise Reliability** featuring connection pooling and graceful error handling
- 🏛️ **Clean Architecture** with dependency inversion and modular design
- 📚 **Living Documentation** that auto-syncs with code changes

**[→ Read the Complete Engineering Philosophy](MANIFESTO.md)**
