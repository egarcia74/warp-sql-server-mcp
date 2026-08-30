# SQL Server MCP - AI-Powered Database Integration

Connect AI assistants to your SQL Server databases with enterprise-grade security and performance.

> **🤖 AI-First Database Access**: Enable GitHub Copilot, Warp AI, and other assistants to interact with your SQL
> Server databases through natural language queries, with comprehensive security controls and production-ready reliability.

[![CI](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml)
[![Node.js Version](https://img.shields.io/badge/Node.js-20.19%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## 🚀 Quick Start - Choose Your AI Assistant

**New to this project?** Get up and running in under 5 minutes!

### **🤖 GitHub Copilot in VS Code** (⭐ Most Popular)

Perfect for developers who want AI-powered SQL assistance directly in their IDE.

**[→ 5-Minute VS Code Setup Guide](docs/QUICKSTART-VSCODE.md)**

- ✅ **GitHub Copilot** can query your databases directly
- ✅ **Context-aware suggestions** based on your actual schema
- ✅ **Natural language** to SQL query generation
- ✅ **Real-time insights** while coding

### **💬 Warp Terminal**

Ideal for terminal-based workflows and command-line database interactions.

**[→ 5-Minute Warp Setup Guide](docs/QUICKSTART.md)**

- ✅ **AI-powered terminal** with SQL Server integration
- ✅ **Natural language** database queries
- ✅ **Fast iteration** for analysis and debugging
- ✅ **Cross-platform** terminal experience

### **🔧 Advanced Integration**

**[Complete VS Code Integration Guide →](docs/VSCODE-INTEGRATION-GUIDE.md)** - Advanced workflows and configuration

> **Using another AI assistant?** This MCP server works with any MCP-compatible system.

---

## ✨ What You Get

- 🤖 **Natural language to SQL** - Ask questions, get queries
- 🔒 **Enterprise security** - Three-tier safety system with secure defaults
- 📊 **Performance insights** - Query optimization and bottleneck detection
- ☁️ **Cloud-ready** - AWS/Azure secret management
- 🚀 **Streaming support** - Memory-efficient handling of large datasets
- 📈 **16 Database Tools** - Complete database operations through AI

---

## 🔒 Security Levels (Quick Reference)

| Security Level                | Environment Variable                      | Default | Impact                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🔒 Read-Only Mode**         | `SQL_SERVER_READ_ONLY`                    | `true`  | Only SELECT queries allowed                                                                                                                                                                                                                             |
| **⚠️ Destructive Operations** | `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | Controls INSERT/UPDATE/DELETE/MERGE/TRUNCATE, EXEC, WRITETEXT/UPDATETEXT, Service Broker RECEIVE, and administrative operations (SHUTDOWN, KILL, BACKUP/RESTORE, DBCC, RECONFIGURE, CHECKPOINT, SETUSER, `xp_*`/`sp_*`, linked-server rowset functions) |
| **🚨 Schema Changes**         | `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | Controls CREATE/DROP/ALTER, GRANT/REVOKE/DENY, ENABLE/DISABLE TRIGGER, and `SELECT ... INTO`                                                                                                                                                            |

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

> **📖 Complete Reference**: See **[docs/ENV-VARS.md](docs/ENV-VARS.md)** for comprehensive documentation of all environment variables, defaults, and context-aware behavior.

| Variable                | Required     | Default         | Description              |
| ----------------------- | ------------ | --------------- | ------------------------ |
| `SQL_SERVER_HOST`       | No           | `localhost`     | SQL Server hostname      |
| `SQL_SERVER_PORT`       | No           | `1433`          | SQL Server port          |
| `SQL_SERVER_DATABASE`   | No           | `master`        | Initial database         |
| `SQL_SERVER_USER`       | For SQL Auth | -               | Database username        |
| `SQL_SERVER_PASSWORD`   | For SQL Auth | -               | Database password        |
| `SQL_SERVER_ENCRYPT`    | No           | `true`          | Enable SSL/TLS           |
| `SQL_SERVER_TRUST_CERT` | No           | _context-aware_ | Trust server certificate |

> **💡 Authentication**: For Windows Authentication, leave `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD` empty.
> **💡 SSL Certificates**: `SQL_SERVER_TRUST_CERT` automatically adapts to your environment (trusts in development, requires valid certificates in production).

---

## 🛠️ Installation & Configuration

> Note: As of v1.7.11 the package is published under the scoped name
> `@egarcia74/warp-sql-server-mcp`. The previous unscoped package `warp-sql-server-mcp` is
> deprecated: it was last published at 1.7.10 and predates the security fixes in 1.7.16-1.7.18,
> so installing it is not supported. Use the scoped name.

### ⭐ **Recommended: Global npm Installation**

```bash
# Install globally via npm (easiest method)
npm install -g @egarcia74/warp-sql-server-mcp

# Initialize configuration
warp-sql-server-mcp init

# Edit config file with your SQL Server details
# Config file location: ~/.warp-sql-server-mcp.json
```

**Benefits:**

- ✅ No manual path configuration
- ✅ Secure credential storage with file permissions (600)
- ✅ Easy configuration updates without touching AI assistant settings
- ✅ Password masking and validation

### Alternative: Manual Installation

```bash
# Clone and install manually
git clone https://github.com/egarcia74/warp-sql-server-mcp.git
cd warp-sql-server-mcp
npm install
```

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

- **[Environment Variables Reference](docs/ENV-VARS.md)** - Complete environment variables documentation
- **[Security Guide](docs/SECURITY.md)** - Comprehensive security configuration and threat model
- **[Security Threat Analysis Process](WARP.md#security-threat-analysis--response-process)** - Workflows for reviewing and responding to security alerts
- **[Architecture Guide](docs/ARCHITECTURE.md)** - Technical deep-dive and system design
- **[All MCP Tools](https://egarcia74.github.io/warp-sql-server-mcp/tools.html)** - Complete API reference (16 tools)

### **Setup Guides**

- **[VS Code Integration Guide](docs/VSCODE-INTEGRATION-GUIDE.md)** - Advanced workflows and configuration
- **[Azure Key Vault Guide](docs/AZURE-SECRETS-GUIDE.md)** - Cloud secret management setup
- **[AWS Secrets Manager Guide](docs/AWS-SECRETS-GUIDE.md)** - Enterprise credential management

### **Developer Resources**

- **[Software Engineering Manifesto](MANIFESTO.md)** - Philosophy and engineering practices
- **[Quality No-Compromise Case Study](docs/QUALITY-NO-COMPROMISE.md)** - Real-world analysis of zero-tolerance quality standards
- **[Testing Guide](test/README.md)** - Comprehensive test documentation (1,100 automated unit tests)
- **[Contributing Guide](CONTRIBUTING.md)** - Development workflow and standards
- **[Git Commit Checklist](docs/GIT-COMMIT-CHECKLIST.md)** - Pre-commit quality gates and guidelines
- **[Git Push Checklist](docs/GIT-PUSH-CHECKLIST.md)** - Pre-push validation and deployment guidelines
- **[Git Release Checklist](docs/GIT-RELEASE-CHECKLIST.md)** - Step-by-step release guide (automation + npm)

---

## 🧪 Production Validation

**✅ PRODUCTION-VALIDATED**: This MCP server has been **fully tested** through:

- **1,187 Tests**: All MCP tools, security boundaries, error scenarios - **1,167 run automatically
  on every pull request** (1,100 unit + 27 integration + 40 live-database against a Docker SQL
  Server CI starts itself); only the 20 MCP protocol smoke tests are run on demand
- **40 Live-Database Integration Tests**: Live database validation across all security phases, run in CI
- **20 Protocol Tests**: End-to-end MCP communication validation, run on demand via
  `npm run docker:test -- protocol` (a bare `npm run docker:test` defaults to `phase1` and never
  reaches them)
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
@sql-server List all databases
@sql-server Show me tables in the AdventureWorks database
@sql-server Generate a query to find the top 10 customers by sales
@sql-server Analyze the performance of this query: SELECT * FROM Orders WHERE OrderDate > '2023-01-01'
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
- For Windows Auth: Leave user/password empty, optionally set `SQL_SERVER_DOMAIN`
- Ensure the connecting user has appropriate database permissions

**Configuration Issues:**

- Set `SQL_SERVER_ENCRYPT=false` for local development
- MCP servers require explicit environment variables (`.env` files are not loaded automatically)
- Check MCP server logs: `npm run logs` or `npm run logs:tail` for real-time monitoring
- View audit logs for security-related issues: `npm run logs:audit`

### **Platform-Specific**

**Windows:**

- Enable TCP/IP in SQL Server Configuration Manager
- Start SQL Server Browser service for named instances
- Windows Authentication works seamlessly with domain accounts

**macOS/Linux:**

- Remote SQL Server connections often require SQL Server Authentication
- May need `SQL_SERVER_ENCRYPT=true` for remote connections
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
npm run cleanup            # Clean up leftover test processes
npm run cleanup:processes  # Same as cleanup (alias)
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

- 🔬 **1,187 Tests** covering all functionality and edge cases - all but 20 run automatically on every pull request
- 🛡️ **Multi-layered Security** with defense-in-depth architecture
- 📊 **Production Observability** with structured logging and performance monitoring
- ⚡ **Enterprise Reliability** featuring connection pooling and graceful error handling
- 🏛️ **Clean Architecture** with dependency inversion and modular design
- 📚 **Living Documentation** that auto-syncs with code changes

**[→ Read the Complete Engineering Philosophy](MANIFESTO.md)**
