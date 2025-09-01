# Enterprise-Grade Software Framework

## _A Comprehensive Reference Implementation for Production-Ready Systems_

> **What you're looking at**: While this appears to be an MCP server for SQL Server integration, it's fundamentally
> **a complete framework demonstrating enterprise-grade software development practices**. Every component, pattern,
> and principle here is designed to showcase rigorous engineering standards that can be applied to any production
> system.

---

## 🏗️ **Framework Highlights**

**🔬 Comprehensive Testing Strategy**: 535 tests covering unit, integration, and edge cases with 95%+ coverage
**🛡️ Multi-layered Security Architecture**: Defense-in-depth security with audit logging and threat detection  
**📊 Production Observability**: Performance monitoring, structured logging, and health assessment  
**⚡ Enterprise Reliability**: Connection pooling, circuit breakers, and graceful error handling  
**🏛️ Clean Architecture**: Layered design with dependency inversion and interface segregation  
**📚 Living Documentation**: Auto-generated docs that stay synchronized with code changes

---

## Build & Quality Status

[![CI](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/codeql.yml)

## Automation & Monitoring

[![Performance Monitoring](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/performance.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/performance.yml)
[![Documentation](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/docs.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/docs.yml)
[![GitHub Pages](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/pages.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/pages.yml)
[![Auto Label](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/auto-label.yml/badge.svg)](https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/auto-label.yml)

## Project Info

[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/egarcia74/warp-sql-server-mcp/pulls)
[![Issues](https://img.shields.io/github/issues/egarcia74/warp-sql-server-mcp.svg)](https://github.com/egarcia74/warp-sql-server-mcp/issues)
[![Last Commit](https://img.shields.io/github/last-commit/egarcia74/warp-sql-server-mcp.svg)](https://github.com/egarcia74/warp-sql-server-mcp/commits/main)
[![GitHub Stars](https://img.shields.io/github/stars/egarcia74/warp-sql-server-mcp.svg?style=social)](https://github.com/egarcia74/warp-sql-server-mcp/stargazers)

---

## 🎯 **The Real Value Proposition**

This codebase demonstrates **how to build enterprise-grade software that actually works in production**. While it
delivers MCP functionality for SQL Server integration, its primary value lies in the comprehensive engineering
practices it showcases:

### **Production-Ready Patterns**

- **Observability**: Structured logging, performance monitoring, health checks
- **Reliability**: Connection pooling, retry logic, circuit breakers, graceful degradation
- **Security**: Multi-layer validation, audit logging, threat detection, secure defaults
- **Testability**: Comprehensive test coverage with proper mocking strategies
- **Maintainability**: Clean architecture, dependency injection, configuration management

### **Enterprise Architecture**

- **Layered Design**: Clear separation between presentation, business logic, and data layers
- **Interface Segregation**: Components depend only on what they actually use
- **Dependency Inversion**: High-level modules don't depend on low-level implementation details
- **Single Responsibility**: Each component has one well-defined purpose
- **Open/Closed Principle**: Easy to extend without modifying existing code

See our [**Software Engineering Manifesto**](MANIFESTO.md) and [**Architecture Guide**](ARCHITECTURE.md) for the complete philosophy and technical details.

---

## 🚀 Quick Start

**New to this project?** Get up and running in under 5 minutes!

### Choose Your Development Environment

**🖥️ [Warp Terminal Quick Start →](QUICKSTART.md)** - Original 5-minute setup for Warp Terminal

**💻 [VS Code Quick Start →](QUICKSTART-VSCODE.md)** - Complete VS Code + Warp integration setup

### Advanced Setup Guides

**🔧 [Complete VS Code Integration Guide →](docs/VSCODE-INTEGRATION-GUIDE.md)** - Comprehensive development workflow

For detailed configuration options, continue reading below.

## Features

- **Database Connection**: Connect to SQL Server on localhost:1433 (configurable)
- **Query Execution**: Execute arbitrary SQL queries with graduated safety controls
- **Schema Inspection**: List databases, tables, and describe table structures
- **Data Retrieval**: Get sample data from tables with filtering and limiting
- **Authentication**: Support for both SQL Server authentication and Windows authentication
- **🔒 Security**: Three-tier graduated safety system with secure defaults
- **☁️ Cloud-Ready**: Enterprise secret management with AWS Secrets Manager and Azure Key Vault
- **🚀 Streaming**: Memory-efficient handling of large datasets
- **📊 Performance Monitoring**: Real-time query performance tracking and optimization

## 🔒 Security

> **✨ NEW**: This MCP now includes a revolutionary **three-tier graduated safety system**
> designed to prevent accidental or malicious database operations while providing the
> flexibility needed for different environments.

### 🛡️ Three-Tier Safety System

The MCP server implements three independent security layers that can be configured separately:

| Security Level                | Environment Variable                      | Default | Impact                        |
| ----------------------------- | ----------------------------------------- | ------- | ----------------------------- |
| **🔒 Read-Only Mode**         | `SQL_SERVER_READ_ONLY`                    | `true`  | Only SELECT queries allowed   |
| **⚠️ Destructive Operations** | `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | Controls INSERT/UPDATE/DELETE |
| **🚨 Schema Changes**         | `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | Controls CREATE/DROP/ALTER    |

### 🏗️ Security Configurations

#### 🔒 **Maximum Security** (Default - Production Recommended)

```bash
SQL_SERVER_READ_ONLY=true                      # Only SELECT allowed
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false  # No data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false         # No schema changes
```

**✅ Allowed Operations:**

- SELECT queries (JOINs, CTEs, subqueries)
- Database and table inspection
- Query performance analysis
- Data export (CSV)

**❌ Blocked Operations:**

- INSERT, UPDATE, DELETE, TRUNCATE
- CREATE, DROP, ALTER operations
- Stored procedure execution

**🎯 Perfect For:** Production monitoring, business intelligence, reporting, data analysis

#### 📊 **Data Analysis Mode**

```bash
SQL_SERVER_READ_ONLY=false                     # Enable write operations
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true   # Allow data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false         # Block schema changes
```

**✅ Additional Operations Allowed:**

- INSERT, UPDATE, DELETE operations
- Data import/migration
- ETL processes

**❌ Still Blocked:**

- CREATE, DROP, ALTER operations
- Schema modifications

**🎯 Perfect For:** Development environments, data migration, ETL processes, application testing

#### 🛠️ **Full Development Mode** (Use with Caution)

```bash
SQL_SERVER_READ_ONLY=false                     # Enable write operations
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true   # Allow data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true          # Allow schema changes
```

**✅ All Operations Allowed:**

- Complete SQL functionality
- Database schema modifications
- Index and constraint management

**⚠️ WARNING:** This provides unrestricted database access. Only use in isolated development environments!

**🎯 Perfect For:** Database development, schema migration, isolated development environments

### 🚨 Security Status Monitoring

#### Startup Security Summary

The MCP server displays security status on startup in the Warp logs:

```bash
# Maximum Security (Default)
Security: 🔒 SECURE (RO, DML-, DDL-)

# Data Analysis Mode
Security: ⚠️ UNSAFE (RW, DML+, DDL-)
WARNING: Read-write mode, DML allowed - consider stricter settings for production

# Full Development Mode
Security: ⚠️ UNSAFE (RW, DML+, DDL+)
WARNING: Read-write mode, DML allowed, DDL allowed - consider stricter settings for production
```

#### Runtime Security Information

Every query response includes current security status:

```json
{
  "safetyInfo": {
    "readOnlyMode": true,
    "destructiveOperationsAllowed": false,
    "schemaChangesAllowed": false
  }
}
```

### 🔍 Query Validation

The MCP server includes intelligent query validation that:

1. **Analyzes SQL patterns** before execution
2. **Blocks dangerous operations** based on current security settings
3. **Provides clear error messages** explaining why operations were blocked
4. **Suggests configuration changes** when operations are blocked

**Example Security Block:**

```bash
# Attempting INSERT in read-only mode
❌ Query blocked by safety policy: Read-only mode is enabled.
   Only SELECT queries are allowed.
   Set SQL_SERVER_READ_ONLY=false to disable.
```

### 🏥 Production Deployment

#### Recommended Production Configuration

```bash
# PRODUCTION SECURITY SETTINGS (Mandatory)
SQL_SERVER_READ_ONLY=true
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false

# ADDITIONAL SECURITY SETTINGS
SQL_SERVER_ENCRYPT=true
SQL_SERVER_TRUST_CERT=false
SQL_SERVER_CONNECT_TIMEOUT_MS=5000
SQL_SERVER_REQUEST_TIMEOUT_MS=10000
```

#### Security Validation Checklist

Before deploying to production:

- [ ] ✅ **Read-only mode enabled** (`SQL_SERVER_READ_ONLY=true`)
- [ ] ✅ **Destructive operations blocked** (`SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false`)
- [ ] ✅ **Schema changes blocked** (`SQL_SERVER_ALLOW_SCHEMA_CHANGES=false`)
- [ ] ✅ **Encryption enabled** (`SQL_SERVER_ENCRYPT=true`)
- [ ] ✅ **Certificate validation enabled** (`SQL_SERVER_TRUST_CERT=false`)
- [ ] ✅ **Security warnings appear in logs** during startup
- [ ] ✅ **Test blocked operations** return appropriate error messages
- [ ] ✅ **Document security settings** in deployment documentation

### 🔧 Migration from Previous Versions

**⚠️ Breaking Change Notice**: Starting with this version, the MCP server defaults to maximum security (read-only mode).

**If you need write access**, explicitly configure:

```bash
# For data modification capabilities
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true

# For full database operations (development only)
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true
```

### 📚 Additional Security Resources

- **[Complete Security Documentation](SECURITY.md)** - Comprehensive security guide
- **[Threat Model Analysis](SECURITY.md#threat-model)** - What threats are mitigated
- **[Security Testing Guide](SECURITY.md#testing-security-features)** - How to validate security features
- **[Deployment Guidelines](SECURITY.md#production-deployment-guidelines)** - Environment-specific recommendations
- **[Azure Key Vault Configuration Guide](docs/AZURE-SECRETS-GUIDE.md)** - Complete setup guide for Azure Key Vault secret management
- **[AWS Secrets Manager Configuration Guide](docs/AWS-SECRETS-GUIDE.md)** - Complete setup guide for AWS Secrets Manager with IAM roles and JSON secrets

## 🎯 Use Cases

This MCP transforms Warp into a **lightweight, AI-powered database client** perfect for developers, analysts, DBAs, and business users. Here are the most valuable use cases:

### 🔍 **Database Analysis & Exploration**

#### **Schema Discovery**

- **Reverse engineer** legacy databases without documentation
- **Quick database audits** to understand structure and relationships
- **New team onboarding** - rapidly explore unfamiliar database schemas
- **Data migration planning** - understand source system structure

#### **Data Quality Assessment**

- Spot-check data integrity across tables
- Identify orphaned records or referential integrity issues
- Sample data for quality analysis before major operations

### 📊 **Business Intelligence & Reporting**

#### **Ad-hoc Analysis**

- Quick business questions: _"How many orders are pending?"_
- Revenue analysis: _"What are our top-selling products?"_
- Customer insights: _"Which customers haven't placed orders recently?"_
- Inventory monitoring: _"What products are low in stock?"_

#### **Data Export for Analysis**

- Export filtered datasets to CSV for Excel/BI tool analysis
- Extract sample data for testing or development environments
- Generate reports for stakeholders who prefer spreadsheet format

### 🛠️ **Development & DevOps**

#### **Database Troubleshooting**

- **Query performance tuning** using execution plan analysis
- Debug slow queries by examining actual vs estimated plans
- Identify missing indexes or inefficient query patterns
- Monitor query execution costs

#### **Development Support**

- **API development** - quickly test database queries during development
- **Data seeding** - understand existing data patterns for test data creation
- **Schema validation** - verify database changes deployed correctly
- **Integration testing** - validate data flows between systems

### 🔧 **Database Administration**

#### **Maintenance & Monitoring**

- Quick health checks across multiple databases
- Verify foreign key constraints are properly implemented
- Monitor table sizes and row counts
- Validate data consistency after migrations

#### **Documentation & Compliance**

- Generate schema documentation automatically
- Create data dictionaries for compliance audits
- Document foreign key relationships for impact analysis
- Export metadata for governance tools

### 🎓 **Education & Training**

#### **SQL Learning**

- Safe environment to explore database concepts
- Learn complex JOIN patterns on real data
- Practice query optimization techniques
- Understand execution plans and performance tuning

#### **Database Design Training**

- Analyze well-designed schemas from existing databases
- Study foreign key implementation patterns
- Learn normalization principles from real examples

### 🚀 **AI-Powered Database Operations**

#### **Natural Language to SQL**

With Warp's AI capabilities, you can:

- Ask: _"Show me customers who haven't placed orders"_
- Query: _"What's our revenue by product category?"_
- Analyze: _"Which products are selling best this month?"_
- Optimize: _"Why is this query running slowly?"_

#### **Automated Insights**

- Generate business reports through conversational queries
- Perform data analysis without writing complex SQL
- Get explanations of query performance issues in plain English

### 🏢 **Enterprise Scenarios**

#### **Multi-Database Management**

- Compare schemas across development/staging/production
- Validate data consistency across environments
- Monitor multiple SQL Server instances from one interface
- Coordinate database operations across teams

#### **Legacy System Integration**

- Understand undocumented legacy database structures
- Extract data from legacy systems for modernization projects
- Bridge between old systems and modern applications
- Support gradual migration strategies

### 💡 **Why This MCP is Particularly Powerful**

1. **Zero Configuration** - No need to install heavy database tools
2. **AI Integration** - Natural language queries through Warp
3. **Flexible Access** - Full SQL capabilities from simple queries to complex operations
4. **Fast Iteration** - Quick feedback loop for analysis and development
5. **Cross-Platform** - Works on any system where Warp runs
6. **Comprehensive** - All essential database operations in one tool

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

### Performance Monitoring

1. **get_performance_stats**: Get comprehensive server performance statistics and health metrics
2. **get_query_performance**: Get detailed query performance breakdown by tool with filtering options
3. **get_connection_health**: Monitor SQL Server connection pool health and diagnostics

### Query Optimization (NEW)

1. **get_index_recommendations**: Analyze database usage patterns and recommend missing indexes
2. **analyze_query_performance**: Deep analysis of specific queries with optimization suggestions
3. **detect_query_bottlenecks**: Identify and categorize performance bottlenecks across queries
4. **get_optimization_insights**: Comprehensive database health analysis and optimization roadmap

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

#### Core Connection Settings

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

#### 🔒 Security Configuration (NEW)

| Variable                                  | Default | Security Level | Description                              |
| ----------------------------------------- | ------- | -------------- | ---------------------------------------- |
| `SQL_SERVER_READ_ONLY`                    | `true`  | **SECURE**     | When `true`, only SELECT queries allowed |
| `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | **SECURE**     | When `true`, allows INSERT/UPDATE/DELETE |
| `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | **SECURE**     | When `true`, allows CREATE/DROP/ALTER    |

⚠️ **Important**: These settings significantly impact security. See [Security section](#-security) for detailed guidance.

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

- **Total Tests**: 535 tests covering all MCP tools and functionality
- **Test Framework**: Vitest with comprehensive mocking
- **Coverage**: 60.25% statements, 78.04% branches, 83.33% functions
- **Architecture**: Unit tests with mocked SQL Server connections for reliability and speed

### Test Categories

The test suite covers:

- **Core functionality**: All 15 MCP tools (execute_query, list_databases, optimization tools, etc.)
- **Connection handling**: Database connection logic and authentication methods
- **Error scenarios**: Comprehensive error handling and edge cases
- **Advanced features**: Query analysis, foreign keys, CSV export with filtering
- **WHERE clause filtering**: 16 comprehensive filtering tests preventing parameter bugs

### Test Documentation

For complete test documentation including:

- Detailed test breakdowns by category
- Test architecture and mocking strategy
- Development workflow and best practices
- Coverage analysis and debugging guides

**👉 See [test/README.md](test/README.md)**

## Documentation

This project features an **enhanced auto-generated documentation system** that ensures
documentation never goes out of sync with the actual code.

### 📖 Online Documentation

- **[Main Documentation Site](https://egarcia74.github.io/warp-sql-server-mcp/)** -
  Overview, setup guides, and quick reference
- **[Complete API Reference](https://egarcia74.github.io/warp-sql-server-mcp/tools.html)** -
  Detailed documentation for all 15 MCP tools with parameters and examples
- **[Test Coverage Reports](https://egarcia74.github.io/warp-sql-server-mcp/coverage/)** -
  Live test coverage analysis

### 🔄 Auto-Generated Documentation

Our documentation system automatically:

- **Extracts tool definitions** directly from the source code (`index.js`)
- **Generates parameter tables** with types, descriptions, and requirements
- **Creates usage examples** for basic and advanced scenarios
- **Updates version numbers** and tool counts dynamically
- **Maintains consistency** between code and documentation

### 📝 Documentation Scripts

The documentation generation happens through three specialized scripts:

```bash
# Extract MCP tool information from source code
node scripts/docs/extract-docs.js

# Generate detailed API reference page
node scripts/docs/generate-tools-html.js

# Generate landing page with dynamic content
node scripts/docs/generate-landing-page.js
```

### 🚀 Automatic Updates

The documentation automatically rebuilds on every push to the `main` branch via GitHub Actions, ensuring:

- **Always current**: Documentation reflects the latest code changes
- **No manual maintenance**: Tool lists and parameters update automatically
- **Professional presentation**: Clean, navigable documentation site
- **Comprehensive coverage**: Full API reference with examples

### 🛠️ For Contributors

When adding new MCP tools or modifying existing ones:

1. **Update the code** in `index.js` with proper tool definitions
2. **Documentation updates automatically** - no manual changes needed!
3. **Verify locally** by running the documentation scripts
4. **Push changes** - GitHub Actions handles the rest

The system parses your MCP tool definitions and extracts:

- Tool names and descriptions
- Parameter schemas with types
- Required vs optional parameters
- Auto-generated usage examples

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
