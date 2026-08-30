# WARP.md

> **📋 Note for Human Readers**: This file is primarily designed for machine consumption by the
> Warp terminal (warp.dev) for AI context and code indexing. For user-facing documentation,
> please see:
>
> - **[README.md](README.md)** - Main project overview and quick links
> - **[QUICKSTART-VSCODE.md](docs/QUICKSTART-VSCODE.md)** - VS Code + GitHub Copilot setup
> - **[QUICKSTART.md](docs/QUICKSTART.md)** - Warp Terminal setup
> - **[Complete Documentation Site](https://egarcia74.github.io/warp-sql-server-mcp/)**

This file provides comprehensive technical guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a **production-validated** and **enterprise-ready** Model Context Protocol (MCP) server that enables Warp to interact with
Microsoft SQL Server databases safely and securely. The project provides a bridge between
Warp's AI capabilities and SQL Server through the MCP standard, featuring a **comprehensively tested
three-tier graduated safety system** for production database security, **advanced query validation**,
**streaming support for large datasets**, **comprehensive performance monitoring**, and **cloud-ready
secret management**. Built with a modular architecture for enterprise-scale deployments.

**✅ Production Status**: This MCP server has been **fully validated** through 1,187 tests, 1,167 of
which run automatically on every pull request (1,100 unit + 27 integration + 40 live-database);
only the 20 MCP protocol smoke tests are run on demand. Covers all security phases with
**100% success rates**.

**🚀 Quick Start**: New users should begin with the [Quick Start Guide](docs/QUICKSTART.md) for a 5-minute setup walkthrough.

## Architecture

### Core Components

- **SqlServerMCP Class** (`index.js`): Main MCP server implementation that orchestrates all components
- **🔒 Three-Tier Safety System**: Revolutionary security architecture with graduated safety levels
- **Query Validation Engine**: Intelligent SQL parsing and security policy enforcement
- **MCP Tools**: 16 different database operation tools exposed through the MCP interface
- **🏗️ Modular Architecture**: Extracted specialized components for better maintainability:
  - **ServerConfig** (`lib/config/server-config.js`): Centralized configuration management
  - **ConnectionManager** (`lib/database/connection-manager.js`): Database connection handling
  - **DatabaseToolsHandler** (`lib/tools/handlers/database-tools.js`): Database operation implementations
  - **ToolRegistry** (`lib/tools/tool-registry.js`): MCP tool definitions and registration
- **Security Monitoring**: Runtime security status reporting and startup security summaries
- **Error Handling**: Comprehensive error handling with structured MCP error responses

### MCP Tools Available

#### Database Operations

1. **execute_query**: Execute arbitrary SQL queries
2. **list_databases**: List all user databases (excludes system databases)
3. **list_tables**: List tables in a specific database/schema
4. **describe_table**: Get detailed table schema information
5. **get_table_data**: Retrieve sample data with filtering/limiting
6. **explain_query**: Analyze query performance with execution plans
7. **list_foreign_keys**: Discover foreign key relationships
8. **export_table_csv**: Export table data in CSV format with automatic streaming for large datasets

#### Performance Monitoring

1. **get_performance_stats**: Get comprehensive server performance statistics and health metrics (param: `timeframe` — `recent` = last 5 min, `session`/`all` = since startup)
2. **get_query_performance**: Get detailed query performance breakdown by tool (params: `limit`, `tool_filter` — restrict to one MCP tool, `slow_only` — only queries over the slow-query threshold)
3. **get_connection_health**: Monitor SQL Server connection pool health and diagnostics

#### Query Optimization (NEW)

1. **get_index_recommendations**: Recommend missing indexes from `sys.dm_db_missing_index_*` DMVs (params: `database`, `schema` — restrict to one schema, `limit`, `impact_threshold`)
2. **analyze_query_performance**: Static lexical/heuristic analysis of a supplied query — query-type
   classification, complexity scoring, anti-pattern warnings and optimization suggestions, combined with
   operator/access-method extraction from execution-plan data. It is keyword- and pattern-based; there is
   no AST or SQL parser behind it
3. **detect_query_bottlenecks**: Identify and categorize expensive queries from `sys.dm_exec_query_stats` (params: `database`, `limit`, `severity_filter`)
4. **get_optimization_insights**: Aggregate health summary (missing-index + expensive-query counts) with a prioritized roadmap
   (`analysis_period` is accepted but reserved/not applied; the response's `analysisPeriod` field echoes it with `applied: false`)

#### Server Diagnostics (NEW)

1. **get_server_info**: Get comprehensive server diagnostics including configuration, runtime stats, and logging status

### Authentication Methods

- **SQL Server Authentication**: Username/password based
- **Windows Authentication**: NTLM-based (when user/password not provided)

## Enhanced Architecture (v1.4.0+)

### 🏗️ Modular Architecture

Starting with v1.4.0, the project follows a modular architecture with specialized components. This was **significantly enhanced in v1.7.0+** with comprehensive refactoring:

```text
lib/
├── analysis/                 # 🔬 Query optimization & performance analysis
│   ├── bottleneck-detector.js # 🚨 Query bottleneck detection & categorization
│   └── query-optimizer.js     # ⚡ Query analysis & optimization recommendations
├── config/
│   ├── secret-manager.js     # 🔐 Universal secret management
│   └── server-config.js      # ⚙️ Centralized configuration management
├── database/
│   └── connection-manager.js # 🗄️ Database connection pooling & management
├── security/
│   ├── sql-batch-guard.js    # 🔒 Whole-batch keyword scan (fail-closed)
│   └── where-clause-guard.js # 🔒 Single-predicate WHERE-clause validation
├── tools/
│   ├── tool-registry.js      # 📋 MCP tool definitions & registration
│   └── handlers/
│       ├── base-handler.js   # 🧩 Base class for tool handlers
│       └── database-tools.js # 🔧 Database operation implementations
└── utils/
    ├── logger.js             # 📝 Structured logging
    ├── performance-monitor.js # ⚡ Performance tracking
    ├── response-formatter.js  # 📊 Response formatting
    └── streaming-handler.js   # 📈 Large data streaming
```

#### **Key Architecture Components (v1.7.0+)**

**🏗️ Modular Refactoring**: The main `index.js` (previously 2,307 lines) has been refactored into specialized modules:

##### **Configuration Management**

- **`lib/config/server-config.js`**: Centralized configuration with environment variable management
  - Secure defaults for production deployment
  - Configuration validation and security warnings
  - Environment variable reloading for testing
  - Redacted logging for sensitive data
  - Configuration summary and health validation

##### **Database Layer**

- **`lib/database/connection-manager.js`**: Extracted database connection handling
  - Connection pooling with retry logic and exponential backoff
  - Windows Authentication and SQL Server Authentication support
  - Connection health monitoring and SSL certificate information
  - Proper connection lifecycle management

##### **Tool System**

- **`lib/tools/tool-registry.js`**: MCP tool definitions and registration
- **`lib/tools/handlers/base-handler.js`**: Base class for all tool handlers
- **`lib/tools/handlers/database-tools.js`**: Database operation implementations
  - Extracted from main class: `listDatabases`, `listTables`, `describeTable`
  - Proper separation of concerns for database operations
  - Consistent error handling and response formatting

##### **Benefits of Modular Architecture**

- **🧪 Improved Testability**: Each component can be tested in isolation
- **📈 Better Maintainability**: Single responsibility principle throughout
- **🚀 Enhanced Development**: Faster IDE performance and better code navigation
- **👥 Team Collaboration**: Multiple developers can work on different modules
- **🔧 Easier Debugging**: Clear separation makes issue identification easier

### 🔐 Enhanced Secret Management

**Multi-Provider Secret Management**:

- **Environment Variables** (default and fallback)
- **AWS Secrets Manager** for AWS deployments
- **Azure Key Vault** for Azure deployments
- **Credential caching** with configurable TTL
- **Health monitoring** for secret providers

#### Configuration

```bash
# Use AWS Secrets Manager
SECRET_MANAGER_TYPE=aws
AWS_REGION=us-east-1

# Use Azure Key Vault
SECRET_MANAGER_TYPE=azure
AZURE_KEY_VAULT_URL=https://your-vault.vault.azure.net/

# Use environment variables (default)
SECRET_MANAGER_TYPE=env
```

**📋 Detailed Cloud Secret Management**:

- **Azure Key Vault**: [Azure Secrets Configuration Guide](docs/AZURE-SECRETS-GUIDE.md) - Complete setup with authentication, secret naming, and troubleshooting
- **AWS Secrets Manager**: [AWS Secrets Configuration Guide](docs/AWS-SECRETS-GUIDE.md) - Comprehensive guide with IAM roles, JSON secrets, and multi-environment deployment

### 🔒 Query Safety Policy

Query safety is enforced by three fail-closed lexical layers — not by AST/SQL parsing.
A parser's T-SQL dialect coverage is partial, so both security guards are deliberate
single-pass scanners with no regex backtracking on untrusted input:

- **`validateQuery` (`index.js`)**: Classifies the statement by its anchored prefix
  (`^\s*SELECT`, `^\s*DELETE`, …) and applies the active safety tier (read-only →
  destructive-operations → schema-changes). When any restriction is active it delegates
  the whole batch to the batch guard.
- **`sql-batch-guard.js` (`findForbiddenBatchStatement`)**: Scans the _entire_ batch —
  after stripping string literals, quoted/bracketed identifiers and comments — for
  statement keywords the active tier forbids, wherever they appear (T-SQL does not
  require `;` between statements), and requires the batch to open with a recognised
  T-SQL statement keyword. It **fails closed** on an unterminated literal, identifier or
  block comment. This blocks `xp_*`/`sp_*` procedures, `openrowset`/`openquery`/`opendatasource`
  and server-administration statements unless the destructive-operations tier is enabled
  (read-only mode blocks them outright), and closes the multi-statement bypass in
  `GHSA-qhf4-jmhq-73c8`.
- **`where-clause-guard.js` (`findForbiddenWhereClauseSyntax`)**: Validates the
  caller-supplied WHERE clause for `get_table_data`/`export_table_csv`, requiring a
  single predicate on the requested table. It rejects batch separators, comments,
  statement keywords, top-level set operators/`SELECT` and unbalanced parentheses, and
  fails closed on unterminated literals or identifiers.

### 🔒 Constructing SQL Safely

The safety policy above governs the _statement_ a caller submits. Beneath it is a
separate rule for the SQL this server _assembles itself_ from caller arguments
(`database`/`schema`/`table_name`/`limit`/`offset`/`where`):

**A caller-controlled value may reach an executed SQL string only through an approved
escaper/coercion helper from `lib/utils/sql-identifier.js`, applied for its exact
context:**

- **`escapeBracketIdentifier(id)`** — a value used inside `[ … ]` bracket quoting
  (database/schema/table identifiers). Doubles `]`.
- **`escapeSqlStringLiteral(v)`** — a value used inside a single-quoted `'…'` literal
  (e.g. `WHERE name = '…'`). Doubles `'`.
- **`sanitizeDbName(db)`** — a database/schema name used inside `DB_ID(N'…')` /
  `OBJECT_SCHEMA_NAME(…) = N'…'`. Doubles `'`, rejects brackets.
- **`parseRowCount(v, …)`** — a `limit`/`offset`/`TOP` value coerced to a bounded
  integer (rejected otherwise).

The caller-supplied `where` clause is the one deliberate exception: it is interpolated
raw but is gated by the `where-clause-guard` policy layer (`validateWhereClause`) before
the statement runs.

This convention is enforced by two complementary tests (#1093):

- **`test/unit/sql-injection-battery.test.js` — the authoritative guard.** It drives the
  real handlers/methods (`list_tables`, `describe_table`, `list_foreign_keys`,
  `get_table_data`, `export_table_csv`, the streaming query + size-probe,
  `get_index_recommendations`, and `execute_query`'s database `USE` switch) with a mocked
  pool, feeds injection payloads into each caller-controlled argument in isolation, and
  asserts the emitted SQL neutralizes them (quotes doubled, `]` doubled, non-integer
  pagination rejected). Because it checks the security property on real output, it is
  immune to source-scanning blind spots. Its scope is precisely the inputs neutralized by
  **escaping/coercion**: `database`, `schema`, `table_name`, `limit`, and `offset` across
  those tools. It does **not** cover `where` — see below.
- **The `where` clause is caller-controlled but protected by a DIFFERENT model, by
  design.** On the `execute_query` / `get_table_data` path (`index.js`) the raw `where`
  string is validated as a single predicate by `validateWhereClause` +
  `lib/security/where-clause-guard.js`; it is **not** escaped, so it is intentionally out
  of the escaping-oriented battery's scope. "Full coverage" therefore means the escaped
  inputs above plus the separately-guarded `where` — not that the battery escapes `where`.
- **`test/unit/sql-construction-guard.test.js` — a best-effort static lint (secondary).**
  A regex/tokenizer scan of the SQL-building sources that fails if a SQL template literal
  interpolates a bare caller argument without an approved escaper. Its file list is
  self-verifying: the lint recursively discovers any production source that BOTH
  interpolates an identifier into a SQL template (`[${…}]` / `'${…}'`) AND executes SQL
  in-file (`.query(`/`.batch(`), and fails if such a file is not registered for scanning.
  So the concrete guarantee is: a new source that both builds identifier SQL and executes
  it is auto-detected and must be registered, after which it is scanned. The honest
  residual (still best-effort): SQL built in one file but executed in another, or assembled
  without a `[${…}]`/`'${…}'` template shape, is not auto-detected and is covered only by
  the behavioral battery. It is a tripwire, not a proof — the battery is the real guarantee.

When adding a new SQL-building site, route the value through the helper above; do not add
its raw variable name to any allow-list. If it is a **new file** that both builds
identifier SQL and executes it, the registration test will fail until you add it to both
`SQL_SOURCE_FILES` and `MIN_SCANNED` in the static lint — and you must **also** add a
behavioral-battery case for each caller-controlled input it accepts. Both steps are
required: registration gets the file scanned; the battery is what actually proves the
inputs are neutralized.

### 📊 Enhanced Response Formatting

**Configurable Output Formats**: Supports different integration patterns:

```bash
# Structured objects (recommended for programmatic use)
SQL_SERVER_RESPONSE_FORMAT=structured

# Compact JSON (minimal bandwidth)
SQL_SERVER_RESPONSE_FORMAT=json

# Pretty-printed JSON (human-readable, original behavior)
SQL_SERVER_RESPONSE_FORMAT=pretty-json
```

**Advanced Features**:

- **Automatic response size limits** with intelligent truncation
- **Column type inference** from sample data
- **Performance metrics** embedded in responses
- **Metadata enrichment** with execution context

### 📈 Streaming Support for Large Data

**Memory-Efficient Processing**: Handles large datasets without memory exhaustion:

- **Intelligent Detection**: Automatically streams based on query patterns and table size
- **Configurable Batching**: Process data in configurable batch sizes (default: 1000 rows)
- **Multiple Formats**: CSV and JSON streaming support
- **Memory Monitoring**: Real-time memory usage tracking and estimation

#### Streaming Configuration

```bash
# Enable/disable streaming
ENABLE_STREAMING=true

# Configure batch sizes
STREAMING_BATCH_SIZE=1000
STREAMING_MAX_MEMORY_MB=50
STREAMING_MAX_RESPONSE_SIZE=1000000
```

#### **Enhanced CSV Export with Streaming (v1.7.0+)**

**Automatic Detection and Streaming**: The `export_table_csv` tool now intelligently detects large datasets and automatically switches to streaming mode:

- **Table Size Analysis**: Queries table statistics to determine if streaming is needed (>10k rows or >10MB)
- **Memory-Efficient Processing**: Processes data in configurable batches (default: 1000 rows)
- **Chunk-Based Output**: Large exports are returned as chunks for memory efficiency
- **Performance Monitoring**: Integrated performance tracking for all streaming operations
- **Automatic CSV Formatting**: Proper CSV escaping and header handling across chunks

**Configuration Options**:

- Uses existing `ENABLE_STREAMING`, `STREAMING_BATCH_SIZE`, and `STREAMING_MAX_MEMORY_MB` settings
- Automatic streaming detection based on table size analysis
- Fallback to regular export for smaller datasets

**Example Usage in Warp**:

```json
// Small table - returns immediately with full CSV
{"name": "export_table_csv", "input": {"table_name": "Categories"}}

// Large table - automatically streams with memory efficiency
{"name": "export_table_csv", "input": {"table_name": "Orders", "database": "Northwind"}}

// With limits - respects streaming settings
{"name": "export_table_csv", "input": {"table_name": "Products", "limit": 5000}}
```

**Performance Benefits**:

- **Memory Efficiency**: Constant memory usage regardless of dataset size
- **Responsive Export**: Large exports don't block other operations
- **Progress Tracking**: Performance metrics track streaming statistics
- **Error Resilience**: Proper error handling for large dataset operations

#### Streaming Security Enhancements (v1.7.4+)

**Secure JSON Reconstruction**: The streaming handler now includes comprehensive security validation for JSON chunk processing:

- **Prototype Pollution Protection**: Detects and blocks `__proto__`, `constructor`, and `prototype` key manipulations
- **Safe JSON Parsing**: Validates JSON structure and prevents malformed data injection
- **Size Limit Enforcement**: 10MB maximum JSON chunk size to prevent DoS attacks
- **Input Type Validation**: Ensures only valid string data is processed for JSON parsing
- **Recursive Security Scanning**: Deep validation of nested object structures

**Security Features**:

```javascript
// Enhanced streaming security validates:
- JSON structure integrity before parsing
- Prototype pollution attempt detection
- Malicious key pattern recognition
- Size-based DoS attack prevention
- Safe reconstruction from trusted chunks
```

**Security Configuration**: Uses existing streaming settings with additional validation layers - no configuration changes required.

### ⚡ Performance Monitoring

**Comprehensive Performance Tracking**: Enterprise-grade monitoring and alerting:

- **Query Execution Tracking**: Duration, memory usage, row counts
- **Connection Pool Monitoring**: Health, utilization, error rates
- **Slow Query Detection**: Configurable thresholds with alerting
- **Performance Recommendations**: AI-powered optimization suggestions
- **Historical Analytics**: Trend analysis and performance insights

#### Performance Configuration

```bash
# Performance monitoring
ENABLE_PERFORMANCE_MONITORING=true
SLOW_QUERY_THRESHOLD=5000          # milliseconds
PERFORMANCE_SAMPLING_RATE=1.0       # 0.0 to 1.0
MAX_METRICS_HISTORY=1000
```

### 📝 Enhanced Logging & Error Handling

**Structured Logging with Winston**: Professional logging system:

- **Configurable Log Levels**: debug, info, warn, error
- **Security Audit Trails**: Dedicated security event logging
- **Context-Aware Errors**: Database name, tool arguments, execution context
- **Structured Output**: JSON logging for production environments
- **Performance Correlation**: Link performance metrics with log events

#### Logging Configuration

```bash
# Logging configuration
SQL_SERVER_LOG_LEVEL=info              # debug, info, warn, error
ENABLE_SECURITY_AUDIT=true
LOG_FILE=/var/log/sql-server-mcp.log
SECURITY_LOG_FILE=/var/log/security-audit.log
```

## Development Commands

### Core Development

```bash
# Install dependencies
npm install

# Run the MCP server in development mode (auto-restart on changes)
npm run dev

# Start the server normally
npm start
```

### Testing

```bash
# Run all automated tests (unit + integration)
npm test

# Run tests in watch mode (reruns on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with UI interface
npm run test:ui

# Run EVERYTHING - complete test suite (recommended for pre-release)
npm run test:all             # 🚀 Unit + Integration tests (complete test suite)
```

Run the live-database integration suites on their own (requires a live database):

```bash
npm run test:integration:manual    # All 3 phases (40 tests)
# Note: Individual phases are run sequentially within the manual test script
# Phase 1: Read-only security (20 tests)
# Phase 2: DML operations (10 tests)
# Phase 3: DDL operations (10 tests)
```

Run performance tests:

```bash
npm run test:integration:performance # ⭐ Fast performance test (~2s, 100% success)
npm run test:integration:warp # Warp MCP integration test (~10s)
```

Run MCP protocol tests (requires a live database):

```bash
npm run test:integration:protocol # MCP server startup + JSON-RPC handshake
```

### Code Quality and Formatting

```bash
# Lint code for issues
npm run lint

# Lint and auto-fix issues
npm run lint:fix

# Format code with Prettier
npm run format

# Check formatting without making changes
npm run format:check

# Lint markdown files
npm run markdown:lint

# Fix markdown formatting issues
npm run markdown:fix

# Check for dead links in markdown files
npm run links:check

# Check links with full CI configuration
npm run links:check:ci
```

## Security and Auditing

```bash
# Run security audit (checks for high-severity vulnerabilities)
npm run security:audit

# Fix security vulnerabilities automatically
npm run audit:fix
```

### Security Threat Analysis & Response Process

This section documents standardized procedures for reviewing and responding to security analysis reports from automated tools.

#### CodeQL Security Analysis Workflow

**When CodeQL reports issues:**

1. **Review Alert Details**: Check GitHub Security → Code scanning alerts for specific vulnerability details
2. **Assess Impact**: Determine if the issue affects production code paths vs. test/development code
3. **Prioritize Response**:
   - **Critical/High**: Address immediately with input validation, bounds checking, or safe parsing methods
   - **Medium**: Schedule for next development cycle
   - **Low/Info**: Document for future consideration

**Common CodeQL Remediation Patterns:**

- **Integer Parsing**: Replace `parseInt()` with safe parsing methods that include range validation
- **Regular Expressions**: Add size limits and timeout protection for ReDoS prevention
- **Input Validation**: Add null checks, type validation, and boundary enforcement
- **Error Handling**: Implement graceful fallbacks and secure error messages

#### npm Security Audit Workflow

**When npm audit reports vulnerabilities:**

1. **Check Report Date**: npm audit reports can include historical vulnerabilities from supply chain incidents
2. **Verify Exploitability**: Review if the reported package/version is actually used in production paths
3. **Research Context**: Check if this is part of a known supply chain incident (e.g., September 8th, 2024 incident)
4. **Response Actions**:
   - **True Positives**: Update dependencies immediately
   - **False Positives**: Document reasoning and monitor for resolution
   - **Development Dependencies**: Lower priority but track for updates

#### GitHub Security Alerts Response

**For Dependabot and Advanced Security alerts:**

1. **Immediate Assessment**: Review severity level and affected components
2. **Impact Analysis**: Check if vulnerability affects runtime dependencies vs. development tools
3. **Remediation Planning**:
   - **Runtime Dependencies**: Update immediately or implement workarounds
   - **Development Dependencies**: Schedule updates during next maintenance window
   - **Test Dependencies**: Update when convenient but monitor for patches

#### Supply Chain Hardening (Containers & CI)

- Docker image pinning: All container images used in tests are pinned by digest to ensure reproducible builds and prevent tag drift.
  - Example: `mcr.microsoft.com/mssql/server:2022-latest@sha256:d1d2fa72786dd255f25ef85a4862510db1d4f9aa844519db565136311c0d7c7f` (see `test/docker/detect-platform.js`).
  - Guidance: Periodically refresh to a newer digest after validation; keep docs in `test/docker/README.md` in sync.
- GitHub Actions pinning: Third‑party actions are pinned to commit SHAs where feasible.
- SAST coverage: CodeQL runs on all branches (push and pull_request) to maximize coverage and satisfy Scorecard SAST checks.
- CI enforcement: Protect `main` by requiring "Tests" and "CodeQL" checks to pass before merge.

#### Security Enhancement Development Process

**When implementing security improvements:**

1. **Create Comprehensive Tests**: Add security-focused test cases before implementing fixes
2. **Apply Defense in Depth**: Implement multiple layers of protection (validation + parsing + error handling)
3. **Maintain Backward Compatibility**: Ensure security improvements don't break existing functionality
4. **Document Changes**: Update relevant documentation and add inline code comments for complex security logic
5. **Verify Integration**: Run full test suite and manual integration tests to validate security improvements

#### Ongoing Security Monitoring

**Regular security maintenance tasks:**

- **Weekly**: Review GitHub Security tab for new alerts
- **Before Releases**: Run `npm run security:audit` and review all findings
- **Monthly**: Review and update security dependencies
- **Quarterly**: Conduct comprehensive security review of authentication and validation logic

**Security Metrics Tracking:**

- CodeQL Advanced Security Analysis pass/fail status
- Number of npm audit vulnerabilities (distinguish true vs. false positives)
- Time to resolution for security alerts
- Test coverage for security-critical code paths

### System Maintenance

```bash
# Clean up leftover test processes to free system memory
npm run cleanup

# Alternative cleanup command (same functionality)
npm run cleanup:processes

# Show current system resource usage
./scripts/cleanup-test-processes.sh
```

### Git Hooks and CI

```bash
# Install git hooks (pre-commit and pre-push with security audit)
npm run hooks:install

# Run the full CI pipeline locally (includes security audit)
npm run ci

# Run pre-commit checks manually
npm run precommit

# Run pre-push checks manually (includes security audit)
npm run prepush
```

#### Git Workflow Documentation

Comprehensive checklists for quality git workflows:

- **[Git Commit Checklist](docs/GIT-COMMIT-CHECKLIST.md)**: Pre-commit quality gates and guidelines
  - Documents actual pre-commit hook behavior (ESLint --fix, Prettier --write, Markdownlint --fix, npm test)
  - Conventional commits format with examples
  - Manual verification steps for security and change review
  - Generic guidelines for consistent development workflow
- **[Git Push Checklist](docs/GIT-PUSH-CHECKLIST.md)**: Pre-push validation and deployment guidelines
  - Documents automated pre-push checks (full test suite, coverage, security audit, linting)
  - Troubleshooting guidance for common push failures
  - Advanced push options and force push safety guidelines
  - Pull request creation and post-push validation steps
- **[Git Release Checklist](docs/GIT-RELEASE-CHECKLIST.md)**: Step-by-step release guide
  - Covers automated Release workflow (dry runs, auto detection, tag-collision handling)
  - Version-bump PR to sync `package.json` and `package-lock.json` with the released tag
  - Manual release fallback and npm publish instructions

### Log Viewing Commands

```bash
# View server logs (smart path detection - development vs production)
npm run logs

# View server logs (explicit)
npm run logs:server

# View security audit logs
npm run logs:audit

# Follow server logs in real-time (like tail -f)
npm run logs:tail
npm run logs:tail:server

# Follow security audit logs in real-time
npm run logs:tail:audit

# Direct script usage with options
./scripts/show-logs.sh server --compact    # Compact format
./scripts/show-logs.sh audit --all         # Show all entries
./scripts/show-logs.sh --help              # Show help
```

**Smart Path Detection:**

- **Development**: Uses `./logs/server.log` and `./logs/security-audit.log`
- **Production**: Uses `~/.local/state/warp-sql-server-mcp/` directory
- **Windows**: Uses `%LOCALAPPDATA%/warp-sql-server-mcp/` directory

### Environment Setup

```bash
# Copy environment template and configure
cp .env.example .env
# Then edit .env with your SQL Server connection details
```

## Environment Configuration

> **📖 Complete Reference**: See **[docs/ENV-VARS.md](docs/ENV-VARS.md)** for comprehensive documentation of all environment variables, defaults, context-aware behavior, and configuration examples.

### Essential Variables (Quick Reference)

**Connection Settings:**

- `SQL_SERVER_HOST`, `SQL_SERVER_PORT`, `SQL_SERVER_DATABASE` - Server connection details
- `SQL_SERVER_USER`, `SQL_SERVER_PASSWORD` - SQL Server authentication (leave empty for Windows Auth)
- `SQL_SERVER_DOMAIN` - Windows domain for NTLM authentication

**SSL/TLS Settings:**

- `SQL_SERVER_ENCRYPT` - Enable SSL encryption (default: `true`)
- `SQL_SERVER_TRUST_CERT` - Context-aware SSL certificate trust (auto-detects dev/prod environments)

**Connection Pool:**

- `SQL_SERVER_CONNECT_TIMEOUT_MS`, `SQL_SERVER_REQUEST_TIMEOUT_MS` - Timeout settings
- `SQL_SERVER_MAX_RETRIES`, `SQL_SERVER_RETRY_DELAY_MS` - Retry configuration
- `SQL_SERVER_POOL_MAX`, `SQL_SERVER_POOL_MIN` - Connection pool sizing

### 🔒 Security Configuration (Three-Tier Safety System)

**⚠️ IMPORTANT**: Starting with v1.3.0, the MCP server defaults to maximum security.

> **📖 Complete Security Guide**: See **[docs/ENV-VARS.md#database-security-settings](docs/ENV-VARS.md#database-security-settings)** for detailed security configuration options.

**Quick Security Levels:**

| Variable                                  | Default | Impact                                                                                                                        |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `SQL_SERVER_READ_ONLY`                    | `true`  | Only SELECT queries allowed                                                                                                   |
| `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | Blocks INSERT/UPDATE/DELETE/MERGE/TRUNCATE, EXEC, WRITETEXT/UPDATETEXT, Service Broker RECEIVE, and administrative operations |
| `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | Blocks CREATE/DROP/ALTER, GRANT/REVOKE/DENY, ENABLE/DISABLE TRIGGER, and `SELECT ... INTO`                                    |

The destructive tier also covers `WRITETEXT`/`UPDATETEXT` and the Service Broker `RECEIVE`
statement. Administrative operations — SHUTDOWN, KILL, BACKUP/RESTORE, DBCC, RECONFIGURE,
CHECKPOINT, SETUSER, `xp_*`/`sp_*` procedures, and the linked-server rowset functions
OPENQUERY/OPENDATASOURCE/OPENROWSET (except `OPENROWSET(BULK ...)` file reads) — are gated by the
destructive-operations tier, and ENABLE/DISABLE TRIGGER counts as a schema change. Note that
read-only mode (the default) is stricter still: it additionally rejects `OPENROWSET(BULK ...)` and
`WAITFOR`, so those are _not_ usable under the default configuration. Every statement in a batch is
checked against these tiers — T-SQL does not require `;` between statements — and batches with
unterminated string literals, identifiers, or comments are rejected.

**Common Configurations:**

- **🔒 Maximum Security** (Default): All three restrictions enabled
- **📆 Data Analysis**: Enable destructive operations, block schema changes
- **🛠️ Full Development**: Disable all restrictions (use with caution)

See **[docs/ENV-VARS.md#security-configuration-examples](docs/ENV-VARS.md#security-configuration-examples)** for complete configuration examples.

## Warp Integration

### ⭐ **Method 1: CLI Tool Configuration (Recommended)**

The easiest way to configure the MCP server with secure, managed credentials:

#### **Installation & Setup**

```bash
# Install globally via npm
npm install -g @egarcia74/warp-sql-server-mcp

# Initialize configuration file
warp-sql-server-mcp init

# Edit the config file with your SQL Server details
# File location: ~/.warp-sql-server-mcp.json
```

#### **Configure Warp MCP Settings**

1. **Open Warp Settings**: `Cmd+,` → **MCP** tab
2. **Add New Server**:
   - **Name**: `sql-server`
   - **Command**: `warp-sql-server-mcp`
   - **Args**: `["start"]`
3. **Environment Variables**: **Not needed!** ✨

**Benefits:**

- ✅ **Secure credential storage** with file permissions (600)
- ✅ **No complex environment variables** in Warp settings
- ✅ **Easy configuration updates** without touching Warp
- ✅ **Password masking** and validation
- ✅ **One-time setup** that works across all environments

### **Method 2: Manual Environment Variables (Advanced)**

**⚠️ NOTE**: MCP servers run in isolated environments and do NOT
automatically load `.env` files. All configuration must be explicitly provided
through Warp's MCP configuration.

#### **Required MCP Configuration**

In Warp's MCP settings, you must provide ALL environment variables:

#### 🔒 Production Configuration (Maximum Security - Recommended)

```json
{
  "SQL_SERVER_HOST": "localhost",
  "SQL_SERVER_PORT": "1433",
  "SQL_SERVER_DATABASE": "master",
  "SQL_SERVER_USER": "your_username",
  "SQL_SERVER_PASSWORD": "your_password",
  "SQL_SERVER_ENCRYPT": "true",
  "SQL_SERVER_TRUST_CERT": "false",
  "SQL_SERVER_CONNECT_TIMEOUT_MS": "10000",
  "SQL_SERVER_REQUEST_TIMEOUT_MS": "30000",
  "SQL_SERVER_MAX_RETRIES": "3",
  "SQL_SERVER_RETRY_DELAY_MS": "1000",
  "SQL_SERVER_READ_ONLY": "true",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "false",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
}
```

#### 📊 Development Configuration (Data Analysis Mode)

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
  "SQL_SERVER_RETRY_DELAY_MS": "1000",
  "SQL_SERVER_READ_ONLY": "false",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
}
```

#### 🛠️ Full Development Configuration (Use with Caution)

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
  "SQL_SERVER_RETRY_DELAY_MS": "1000",
  "SQL_SERVER_READ_ONLY": "false",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "true",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "true"
}
```

### 🚀 Performance Optimization - Full Destruction Mode

**⚡ Revolutionary Performance Enhancement**: When all three safety restrictions are disabled, the MCP server automatically enables "Full Destruction Mode" optimization:

```bash
SQL_SERVER_READ_ONLY=false                      # Enable write operations
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true    # Allow data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true           # Allow schema changes
```

**Performance Benefits:**

- **⚡ Zero Query Validation Overhead**: When all restrictions are disabled, `validateQuery` approves immediately and skips the batch-guard keyword scan
- **🚀 Immediate Query Approval**: Direct execution without security analysis
- **📊 Monitoring Flag**: Adds `optimized: true` flag to validation responses for tracking
- **🔒 Preserved Security**: Validation still applies when any restriction is enabled
- **🛡️ Enterprise DDL Support**: All complex DDL operations work reliably:
  - Multi-line CREATE/ALTER/DROP statements
  - Constraints, foreign keys, and defaults
  - Stored procedures, functions, and triggers
  - Advanced SQL Server features (CTEs, window functions, MERGE, PIVOT)

**Use Cases for Full Destruction Mode:**

- **🏗️ Database Development**: Full DDL capabilities for schema changes
- **📊 Data Engineering**: Complex ETL operations and data transformations
- **🧪 Testing Environments**: Rapid prototyping and testing workflows
- **🔬 Data Science**: Unrestricted analytical queries and model development

### Configuration Methods

1. **Warp MCP Settings**: Configure through Warp's UI with explicit environment variables
2. **Configuration File**: Import `warp-mcp-config.json` with complete environment variables

### Connection Initialization

The MCP server initializes the database connection pool at startup (not on first
request) to eliminate timeout issues during initial MCP tool calls.

The server communicates via stdio transport and provides structured responses
for all database operations.

## Documentation System

### Auto-Generated Documentation

The project features an enhanced auto-generated documentation system that keeps API
documentation perfectly synchronized with the codebase:

#### Documentation Generation Scripts

- **`extract-docs.js`**: Parses MCP tool definitions from source code and extracts
  structured information including tool names, descriptions, parameters, and usage examples
- **`generate-tools-html.js`**: Creates comprehensive HTML documentation with parameter
  tables, required/optional field indicators, and example usages
- **`generate-landing-page.js`**: Generates a dynamic landing page listing all MCP tools
  with tool counts and consistent styling

#### Live Documentation Sites

- **GitHub Pages**: [https://egarcia74.github.io/warp-sql-server-mcp/](https://egarcia74.github.io/warp-sql-server-mcp/)
- **Tool API Reference**: [https://egarcia74.github.io/warp-sql-server-mcp/tools.html](https://egarcia74.github.io/warp-sql-server-mcp/tools.html)

#### Continuous Integration

Documentation is automatically updated:

- **On every push**: GitHub Actions extracts tool definitions and regenerates HTML
- **Zero drift**: Documentation stays perfectly synchronized with code changes
- **Automated deployment**: Generated docs are published to GitHub Pages automatically

#### For Contributors

To update documentation locally:

```bash
# Extract tool definitions from source code
node scripts/docs/extract-docs.js

# Generate comprehensive tools documentation
node scripts/docs/generate-tools-html.js

# Generate landing page with tool listing
node scripts/docs/generate-landing-page.js
```

Generated files:

- `docs/tools.json`: Extracted tool definitions
- `docs/index.html`: Landing page
- `docs/tools.html`: Detailed API documentation

## Testing Architecture

📖 **For comprehensive test documentation, see [test/README.md](test/README.md)**

- **Vitest Framework**: Modern testing with Vitest for fast execution and great DX
- **Mocked Dependencies**: SQL Server connections are mocked for reliable, fast tests
- **Comprehensive Coverage**: 1,187 tests total, split by how they run - **1,167 automated** on every
  pull request: 1,100 unit and 27 integration under Vitest, plus the 40 live-database phase tests
  that `npm test` drives against a Docker SQL Server the CI `Tests` job starts itself. The remaining
  **20 MCP protocol smoke tests** are the only ones no CI job runs (`npm run docker:test` invokes
  them on demand). Together they cover all MCP tools, connection handling, and error scenarios
- **Test Data**: Structured test data and realistic mock responses for consistent testing
- **Production Validation**: 40 comprehensive integration tests validate all three security phases with live database
- **🐳 Docker Testing**: Automated containerized SQL Server for zero-configuration testing

### 🐳 **Docker Testing (Recommended for Development)**

**Automated SQL Server Container Testing**: Complete testing environment in Docker containers for fast, consistent validation.

```bash
# Quick automated testing with container management
# Docker testing is done automatically via test:integration
# These individual docker scripts don't exist as separate commands:
# - All Docker testing is handled through npm run test:integration
# - Docker containers are managed automatically during integration tests

# Manual container management
npm run docker:start                  # Start SQL Server 2022 container
npm run docker:wait                   # Wait for database initialization
npm run docker:stop                   # Stop and cleanup container
npm run docker:clean                  # Remove all data and containers
```

**Docker Benefits:**

- ✅ **Zero Configuration**: Works immediately on any Docker-enabled system
- ✅ **Complete Isolation**: No interference with existing SQL Server instances
- ✅ **Consistent Environment**: SQL Server 2022 with standardized test data
- ✅ **Fast Setup**: 2-3 minutes vs 30+ minutes for manual setup
- ✅ **Automatic Cleanup**: No leftover test databases or configuration

**[Complete Docker Testing Guide →](test/docker/README.md)**

### Test Structure

Counts below are the vitest suite sizes measured with `npm run test:unit`
(25 files, 1,100 tests); the live-database suites are counted from their own runners.

```text
test/
├── README.md                                # Comprehensive test documentation
├── TEST_IMPROVEMENTS.md                     # Test-suite improvement notes
├── setup.js                                 # Vitest global setup
├── unit/                                    # Vitest unit suites - 25 files, 1,100 tests
│   ├── index.test.js                        # 144 - MCP server entry point, dispatch, validateQuery
│   ├── query-optimizer.test.js              # 132 - Query analysis and optimization engine
│   ├── sql-injection-battery.test.js        # 103 - Authoritative behavioural injection guard
│   ├── where-clause-guard.test.js           #  81 - WHERE-clause validation
│   ├── performance-monitor.test.js          #  70 - Metrics collection
│   ├── streaming-handler.test.js            #  60 - Streaming large result sets
│   ├── tool-registry.test.js                #  59 - Tool definitions and input schemas
│   ├── database-tools-handler.test.js       #  55 - Database tool handlers
│   ├── secret-manager.test.js               #  54 - Azure/AWS secret backends
│   ├── logger.test.js                       #  52 - Structured logging and audit trail
│   ├── mcp-security.test.js                 #  38 - Three-tier safety system
│   ├── response-formatter.test.js           #  35 - Output formatting
│   ├── connection-manager.test.js           #  33 - Pooling, retries, auth
│   ├── sql-batch-guard.test.js              #  30 - Whole-batch forbidden-statement scan
│   ├── sql-construction-guard.test.js       #  30 - Dispatch-vs-escaping static guard
│   ├── get-server-info.test.js              #  27 - Server diagnostics tool
│   ├── server-config.test.js                #  24 - Configuration parsing and defaults
│   ├── query-policy.test.js                 #  19 - Safety-tier policy decisions
│   ├── sql-identifier.test.js               #  16 - Identifier/literal escaping helpers
│   ├── query-optimizer-security.test.js     #  13 - Optimizer input hardening
│   ├── bottleneck-detector.test.js          #   9 - Bottleneck categorisation
│   ├── link-checker.test.js                 #   6 - Documentation link validation
│   ├── cli.test.js                          #   4 - cli.js behaviour
│   ├── docker-command-utils.test.js         #   4 - Docker helper argument handling
│   ├── dependabot-config.test.js            #   2 - Dependabot config validation
│   ├── mcp-shared-fixtures.js               # Shared fixtures and mocks (not a suite)
│   ├── mcp-shared-fixtures.js.backup        # Stale tracked backup of the above; unused
│   └── fixtures/modern-fixtures.js          # Additional shared fixtures
├── integration/                             # Vitest integration suites + live-DB scripts
│   ├── error-scenarios-integration.test.js  #  15 tests - failure-path integration
│   ├── sqlserver-mcp-integration.test.js    #  12 tests - component integration
│   ├── test-aws-secrets.js                  # npm run test:integration:aws (live AWS)
│   ├── test-azure-secrets.js                # npm run test:integration:azure (live Azure)
│   ├── shared/config-validator.js           # Shared config assertions
│   └── manual/                              # Live-database tests (40, also run in CI)
│       ├── README.md                        # Manual testing guide
│       ├── test-database-helper.js          # Live-DB fixture helper
│       ├── phase1-readonly-security.test.js #  20 tests - Maximum security
│       ├── phase2-dml-operations.test.js    #  10 tests - DML operations
│       └── phase3-ddl-operations.test.js    #  10 tests - DDL operations
├── protocol/                                # MCP protocol tests (live DB)
│   ├── README.md                            # Protocol testing guide
│   ├── mcp-client-smoke-test.js             #  20 tests - full client/server round trip
│   └── mcp-server-startup-test.js           # Startup + JSON-RPC handshake check
├── manual/                                  # Performance runners
│   ├── improved-performance-test.js         # npm run test:integration:performance
│   └── warp-mcp-performance-test.js         # npm run test:integration:warp
├── docker/                                  # Docker testing infrastructure
│   ├── README.md, PLATFORM-DETECTION.md, QUICK-REFERENCE.md,
│   │   STRESS-TESTING.md, TESTING-SUMMARY.md, MCP-BENEFIT-SUMMARY.md
│   ├── .env.docker                          # Docker environment variables
│   ├── detect-platform.js                   # Generates docker-compose.yml (untracked)
│   ├── command-utils.js, verify-platform-detection.js, troubleshoot-apple-silicon.js
│   ├── init-db.sql, init-db-node.js, wait-for-db.js, test-connectivity.js
│   └── quick-stress-test.js, developer-stress-test.js
└── archived/                                # 8 superseded suites, excluded in vitest.config.js
```

> **Note**: `test/docker/docker-compose.yml` is generated by `npm run docker:detect` and is not tracked.
> `test/unit/mcp-shared-fixtures.js.backup` is tracked but unreferenced.

### Test Categories

#### **Unit Tests (1,100 across 25 files)**

Grouped by area; the group totals sum to 1,100:

- **Core MCP server** (144): `index.test.js` - entry point, tool dispatch, `validateQuery`
- **SQL safety and injection guards** (317): `sql-injection-battery` (103), `where-clause-guard` (81),
  `mcp-security` (38), `sql-batch-guard` (30), `sql-construction-guard` (30), `query-policy` (19),
  `sql-identifier` (16)
- **Infrastructure utilities** (250): `performance-monitor` (70), `streaming-handler` (60),
  `logger` (52), `response-formatter` (35), `connection-manager` (33)
- **Query analysis** (154): `query-optimizer` (132), `query-optimizer-security` (13),
  `bottleneck-detector` (9)
- **Tools and handlers** (141): `tool-registry` (59), `database-tools-handler` (55),
  `get-server-info` (27)
- **Configuration and secrets** (78): `secret-manager` (54), `server-config` (24)
- **Repository and CLI tooling** (16): `link-checker` (6), `cli` (4), `docker-command-utils` (4),
  `dependabot-config` (2)

#### **Integration Tests (27 Vitest + 40 live-database)**

- **Vitest Integration Tests** (27): Mocked, no external dependencies. These live in `test/integration/`
  and run under a bare `vitest run` (`npm run test:coverage`, `npm run ci`); `npm run test:unit` scopes itself
  to `test/unit` and does not include them
- **Live-Database Integration Tests** (40): **Production validation with live database**. They live
  in `test/integration/manual/` because they are not Vitest suites, but they are fully automated:
  `npm test` runs them via `test:integration:manual`, and CI's required `Tests` job runs `npm test`
  against a Docker SQL Server it starts itself
  - **Phase 1 - Read-Only Security** (20 tests): Maximum security configuration validation
  - **Phase 2 - DML Operations** (10 tests): Selective write permissions validation
  - **Phase 3 - DDL Operations** (10 tests): Full development mode validation
  - **Security Boundary Enforcement**: All three phases validated with **100% success rates**
  - **Production Readiness**: SSL/TLS, configuration management, error handling

#### **Protocol Tests (20 tests)**

- **MCP Client-Server Communication Tests** (20): **End-to-end MCP protocol validation** against a
  live database. The only suite no CI job runs: `mcp-client-smoke-test.js` is invoked solely by
  `npm run docker:test` (`scripts/docker-test-runner.sh`, phases `protocol` and `all`), which no
  workflow calls; `npm run test:integration:protocol` runs the separate `mcp-server-startup-test.js`
  handshake check instead
  - MCP server startup and initialization
  - Tool discovery and registration
  - Request/response message formatting
  - Error handling and edge cases
  - Connection lifecycle management
  - Protocol compliance verification
  - **Located in**: `test/protocol/` - [Protocol Testing Guide →](test/protocol/README.md)

**📋 Manual Integration Testing**: Located in `test/integration/manual/` - [Complete Guide →](test/integration/manual/README.md)

**⚠️ Important**: The 20 MCP protocol smoke tests (`mcp-client-smoke-test.js`) are the only suite
no CI job runs. The 40 live-database phase tests do require a SQL Server, but CI supplies one via
Docker and runs them - together with the separate `mcp-server-startup-test.js` handshake check - in
the required `Tests` job.

## Key Implementation Details

### Connection Pooling

- Uses `mssql` package connection pooling for efficient database connections
- **Startup Initialization**: Connection pool established at server startup to eliminate
  first-request delays
- Automatic connection reuse and cleanup
- Configurable connection timeout and exponential backoff retry logic
- Optimized pool settings for MCP server environment

### Error Handling Strategy

- All database errors are caught and converted to structured MCP error responses
- Specific error types for different failure scenarios (connection, authentication, query execution)
- Descriptive error messages for debugging

### SQL Query Construction

- Uses parameterized queries where possible to prevent SQL injection
- Dynamic schema/database switching support
- Proper SQL escaping and quoting for identifiers

## Product Backlog & Roadmap

### Feature Tracking System

The project uses a comprehensive multi-layered tracking system for managing features and development priorities:

#### 📋 **Product Backlog Document**

- **[PRODUCT-BACKLOG.md](PRODUCT-BACKLOG.md)**: Complete prioritized feature list with business value analysis
- **18 features** organized by priority and implementation phase
- **Strategic alignment** with enterprise-grade software framework vision
- **Updated on change**: revised when features ship, priorities move, or new work is planned

#### 🎯 **GitHub Issues Integration**

- **Feature Request Template**: [.github/ISSUE_TEMPLATE/feature-request.md](.github/ISSUE_TEMPLATE/feature-request.md)
- **Comprehensive labeling system**: priority, phase, and category labels
- **Acceptance criteria**: Each issue includes detailed technical and testing requirements
- **Cross-references**: Links between backlog document and GitHub issues

#### 🏷️ **Label System**

- **Priority Labels**: `high-priority`, `medium-priority`, `low-priority`
- **Phase Labels**: `phase-1` (0-3 months), `phase-2` (3-6 months), `phase-3` (6-12 months), `phase-4` (12+ months)
- **Category Labels**: `enhancement`, `backlog`, plus standard GitHub labels

#### 🛠️ **Batch Issue Creation**

- **Script**: `scripts/backlog/create-backlog-issues.sh`
- **Automated issue creation** from backlog items
- **Consistent formatting** and labeling
- **GitHub CLI integration** for streamlined workflow

### Implementation Phases

Phases express ordering, not calendar dates. See
[PRODUCT-BACKLOG.md](PRODUCT-BACKLOG.md) for the numbered items these lists reference.

#### **Phase 1 (Next)**: User Experience Focus

- Advanced Data Export Options (Excel, JSON, Parquet)
- Query Builder & Template System

#### **Phase 2 (Following)**: Analytics & Performance

- Enhanced Data Visualization Support
- Data Quality & Validation Framework
- Automatic Environment Configuration Detection

#### **Phase 3 (Later)**: Enterprise Features

- Real-time Data Monitoring
- Advanced Security & Audit Features
- Database Comparison & Synchronization

#### **Phase 4 (Exploratory)**: Platform Expansion

- API Integration & Webhooks
- Advanced Caching System
- Multi-Database Support
- Natural Language Query Interface
- Machine Learning Integration
- Collaborative Features

#### **Shipped**

- ✅ **Performance Monitoring MCP Tools** (v1.4.0): `get_performance_stats`,
  `get_query_performance`, `get_connection_health`
- ✅ **Query Optimization & Performance Tools** (v1.6.0): `get_index_recommendations`,
  `analyze_query_performance`, `detect_query_bottlenecks`, `get_optimization_insights`

### Backlog Management Process

1. **Feature Request**: Use GitHub issue template for new features
2. **Backlog Review**: Priorities are revisited when features ship or new work arrives, not on a fixed cadence
3. **Planning**: Phase membership is adjusted alongside those reviews
4. **Implementation**: Follow TDD process with comprehensive testing
5. **Documentation**: Update backlog status and maintain synchronization

## Development Workflow

### 🏗️ **Architecture-First Development Process**

**With the new modular architecture (v1.7.0+), development follows a structured approach:**

#### **1. Component-Based Development**

- **Identify the component**: Determine which lib module handles your change
  - `lib/config/` - Configuration and environment management
  - `lib/database/` - Connection handling and database operations
  - `lib/tools/` - MCP tool definitions and handlers
  - `lib/security/` - Query validation and security
  - `lib/utils/` - Shared utilities and helpers

#### **2. Modular Testing Strategy**

```bash
# Test individual components in isolation
npm run test:watch                    # Watch mode for active development
npm run test:coverage                 # Component test coverage
```

Manual validation for database components:

```bash
npm run test:integration:manual      # Security validation (all phases)
npm run test:integration:protocol    # Protocol validation
npm run test:integration:performance # Performance validation
```

End-to-end protocol validation:

```bash
npm run test:integration:protocol # MCP server startup + JSON-RPC handshake
```

#### **3. Development Best Practices**

- **Single Responsibility**: Each module should have one clear purpose
- **Dependency Injection**: Use constructor injection for testability
- **Error Boundaries**: Handle errors at appropriate component boundaries
- **Configuration Isolation**: Keep configuration logic in ServerConfig
- **Database Abstraction**: Use ConnectionManager for all database access

### Code Quality Standards

This project maintains high code quality through automated tooling and architectural principles:

#### **No-Compromise Quality Philosophy**

> **📊 Case Study**: For a comprehensive analysis of the challenges and outcomes of implementing
> **zero-tolerance quality standards**, see [Quality No-Compromise Case Study](docs/QUALITY-NO-COMPROMISE.md).
>
> This document captures real-world metrics from the WARP project including:
>
> - **525 automated tests** with 100% pass rate enforcement (the figure captured by that case study; the
>   suite has since grown to 1,100 automated unit tests)
> - **74% code coverage** with strict quality gates
> - **3x development time** vs. 90% reduction in debugging time
> - **The five critical challenges** teams face with no-compromise quality
> - **Measurable outcomes** and lessons learned from production implementation

#### **Automated Quality Tools**

- **ESLint**: Modern flat config setup for JavaScript linting with focus on code
  quality (formatting handled by Prettier)
- **Prettier**: Authoritative code formatter handling all style concerns
  including indentation
- **Markdownlint**: Documentation formatting and consistency
- **Link Checking**: Automated dead link detection for documentation integrity
- **Vitest**: Fast, modern testing framework with coverage reporting
- **Git Hooks**: Automated pre-commit and pre-push quality checks

#### **Architecture Quality Standards**

- **Modular Design**: Clear separation of concerns across lib/ modules
- **Interface Contracts**: Consistent APIs between components
- **Error Handling**: Structured error responses throughout
- **Security By Design**: Security validation at appropriate layers
- **Performance Awareness**: Monitoring and optimization built-in

### Git Workflow Integration

The project includes automated quality gates:

#### Pre-commit Hook

- Runs ESLint to check for code quality issues
- Validates Prettier formatting
- Executes markdown linting
- Runs full test suite to ensure no regressions

#### Pre-push Hook

- All pre-commit checks plus:
- Full test suite with coverage reporting
- Comprehensive linting validation
- Ensures code meets quality standards before sharing

### Resolving Quality Check Issues

If git hooks block your commit/push:

```bash
# Fix linting issues automatically
npm run lint:fix

# Fix formatting issues
npm run format

# Fix markdown issues
npm run markdown:fix

# Then retry your git operation
git commit -m "Your message"
```

### System Maintenance and Resource Management

The project includes comprehensive system maintenance tools to manage development environment resources effectively:

#### **Process Cleanup Infrastructure**

During intensive testing sessions (like our 1,100-test unit suite), Node.js/Vitest processes can sometimes become orphaned and consume significant system resources.

The project includes automated cleanup tools:

```bash
# Quick cleanup of leftover test processes
npm run cleanup

# Alternative alias
npm run cleanup:processes

# Direct script execution
./scripts/cleanup-test-processes.sh
```

#### **Automated Integration**

- **Pre-Push Hook Integration**: Cleanup runs automatically before comprehensive testing
- **Smart Detection**: Only targets actual Vitest test processes (no false positives)
- **Resource Monitoring**: Reports system load improvements after cleanup
- **Quality Gate Protection**: Prevents system overload during testing

#### **Real-World Validation**

The cleanup infrastructure has been validated under extreme conditions:

- **Tested under 138% CPU load** during comprehensive test execution
- **Freed 1.8GB RAM** from 3 orphaned Vitest processes
- **Maintained quality standards** while managing system resources
- **Integrated seamlessly** with existing quality gates

> **📋 Complete Guide**: See [System Maintenance Guide](docs/MAINTENANCE.md) for comprehensive
> maintenance procedures, troubleshooting, and prevention strategies.

## ESLint and Prettier Integration

The project uses a coordinated approach:

- **ESLint focuses on code quality**: Logic errors, unused variables, best practices
- **Prettier handles formatting**: Indentation, spacing, line breaks, quotes
- **No conflicts**: ESLint's `indent` rule is disabled to prevent formatting
  conflicts

### CI/CD Pipeline

GitHub Actions workflow validates:

- Code linting (ESLint)
- Format checking (Prettier)
- Documentation linting (Markdownlint)
- Full test suite execution
- Coverage reporting with Codecov integration

## Release Process

### Overview

This project follows a structured release process with automated quality gates and
comprehensive documentation. The process ensures consistent, high-quality releases
with proper versioning, changelog maintenance, and artifact creation.

### Release Types

Follows [Semantic Versioning](https://semver.org/):

- **Patch (x.x.X)**: Bug fixes, documentation updates, minor improvements
- **Minor (x.X.x)**: New features, dependency updates, significant enhancements
- **Major (X.x.x)**: Breaking changes, major architectural changes

### Prerequisites

- All development work completed and merged to `main`
- Working directory clean (no uncommitted changes)
- GitHub CLI (`gh`) installed and authenticated
- All tests passing locally

### Step-by-Step Release Process

#### 1. Pre-Release Quality Verification

```bash
# Run the complete CI pipeline locally
npm run ci
```

**Expected Output**: All linting, formatting, markdown checks, and tests should pass.

#### 2. Analyze Changes and Determine Version

Review the `[Unreleased]` section in `CHANGELOG.md` to determine the appropriate version bump:

- **Security updates** (like dependency upgrades): Usually minor or patch
- **New features**: Minor version bump
- **Breaking changes**: Major version bump
- **Bug fixes only**: Patch version bump

#### 3. Update CHANGELOG.md

Move items from `[Unreleased]` section to a new version section:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Security

- List security-related changes

### Added

- List new features

### Fixed

- List bug fixes

### Enhanced

- List improvements and enhancements
```

Update the version links at the bottom:

```markdown
[X.Y.Z]: https://github.com/egarcia74/warp-sql-server-mcp/compare/vPREV...vX.Y.Z
```

#### 4. Update package.json and package-lock.json Versions

Use `npm version` rather than hand-editing `package.json` - it rewrites the version in both
`package.json` and `package-lock.json` consistently, which a manual edit does not
([#1112](https://github.com/egarcia74/warp-sql-server-mcp/issues/1112)):

```bash
npm version X.Y.Z --no-git-tag-version
```

`--no-git-tag-version` suppresses the commit and tag `npm version` would otherwise create, leaving
the commit to step 5 and the tag to step 6 - after the bump has landed on `main`.

#### 5. Land the Version Changes via Pull Request

`main` is protected and requires a reviewed pull request, so the version bump cannot be pushed
to `main` directly. Put it on a branch and merge it:

```bash
git checkout -b chore/release/vX.Y.Z
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): bump version to vX.Y.Z

- Update CHANGELOG.md with vX.Y.Z release notes
- Update package.json and package-lock.json version to X.Y.Z
- Include summary of key changes"
git push -u origin chore/release/vX.Y.Z
gh pr create --base main --title "chore(release): bump version to vX.Y.Z" --fill
# Merge once required checks and review pass
```

**Note**: Pre-commit hooks run automatically and must pass. Both `package.json` and
`package-lock.json` must be staged; step 4's `npm version` command is what keeps them in step
([#1112](https://github.com/egarcia74/warp-sql-server-mcp/issues/1112)).

#### 6. Create and Push Git Tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z

🔒 Security Updates:
- List security changes

✨ New Features:
- List new features

🐛 Bug Fixes:
- List bug fixes

📈 Enhancements:
- List enhancements"

git push origin vX.Y.Z
```

#### 7. Create GitHub Release

```bash
gh release create vX.Y.Z --title "Release vX.Y.Z" --notes "## vX.Y.Z - YYYY-MM-DD

### 🔒 Security Updates
- List security changes

### ✨ Added Features
- List new features

### 🐛 Bug Fixes
- List bug fixes

### 📈 Enhancements
- List enhancements

**Full Changelog**: https://github.com/egarcia74/warp-sql-server-mcp/compare/vPREV...vX.Y.Z"
```

#### 8. Verify Release

Confirm the release was created successfully:

```bash
gh release view vX.Y.Z
git tag --list | grep vX.Y.Z
```

### Alternative: Automated Release Workflow

The project includes a GitHub Actions workflow for releases that can be manually triggered:

1. Go to:
   `https://github.com/egarcia74/warp-sql-server-mcp/actions/workflows/release.yml`
2. Click "Run workflow"
3. Fill in the three dispatch inputs:
   - **`release_type`** (required, default `auto`): `auto`, `patch`, `minor`, `major`, or `prerelease`
   - **`dry_run`** (optional, default `false`): preview the computed version and changelog without
     creating a tag, GitHub Release, or version-bump PR
   - **`create_version_pr`** (optional, default `true`): open a PR that bumps `package.json` **and**
     `package-lock.json` to the released version
4. Click "Run workflow"

**Note**: The automated workflow is currently set to `workflow_dispatch`
(manual trigger) to provide better control over releases.

#### Behavior Notes (Automation Details)

- Auto detection (when `release_type=auto`):
  - `BREAKING CHANGE` or `!:` → major
  - `feat:` / `feature:` → minor
  - `fix:` / `bugfix:` → patch
  - `docs:` / `chore:` → patch (treated as release‑worthy for auditability)
- Tag collision handling: If the computed tag (e.g., `vX.Y.Z`) already exists, the workflow
  automatically increments the patch version until it finds a free tag, then proceeds.
- Version bump on `main`: the `release` job never pushes the bump to `main` directly - branch
  protection forbids it - so the tag and GitHub Release are created from the unbumped commit.
  A separate `version-pr` job then runs when `create_version_pr=true` (the default): it creates
  the branch `chore/release/vX.Y.Z`, then runs
  `npm version <version> --no-git-tag-version --allow-same-version`
  so `package.json` and `package-lock.json` move together, and opens a PR against `main`. Set `create_version_pr=false` to create only the tag and Release and bump the
  version yourself later.
- Dry runs: Set `dry_run=true` to preview the computed version and changelog without creating a
  tag, GitHub Release, or version-bump PR. The run summary includes the preview.

#### Publishing to npm

Publishing is a separate workflow, `.github/workflows/npm-publish.yml`. It is **not** triggered by
the tag or the Release - it triggers on a push to `main` that touches `package.json`, which in
practice means the merge of the version-bump PR above:

- It publishes only when a tag matching the new `package.json` version already exists, and skips if
  that version is already on npm - so a `package.json` edit that is not a release bump is a no-op.
- It runs `npm run test:unit` before publishing.
- It publishes with `npm publish --access public --provenance` under an OIDC `id-token`, so each
  tarball carries a Sigstore provenance attestation binding it to the workflow run and commit that
  built it. Verify an install with `npm audit signatures`; the npm package page shows a Provenance
  badge.
- The package is published as `@egarcia74/warp-sql-server-mcp`.

If `create_version_pr=false` was used, nothing publishes to npm until a `package.json` version bump
lands on `main` by some other route.

### Post-Release Tasks

1. **Verify Artifacts**: Check that the GitHub release contains correct information
2. **Update Documentation**: Ensure any version-specific documentation is updated
3. **Notify Users**: Consider updating README badges or notifying users of significant changes
4. **Monitor**: Watch for any issues reported after the release

### Quality Gates

The release process includes several automated quality gates:

- **Pre-commit hooks**: ESLint, Prettier, Markdownlint, full test suite
- **Pre-push hooks**: All pre-commit checks plus coverage reporting
- **CI/CD Pipeline**: Multi-Node.js version testing, security audits, integration tests
- **Release Workflow**: Automated changelog generation and artifact creation

### Best Practices

1. **Always test locally** before releasing
2. **Keep CHANGELOG.md up to date** throughout development
3. **Use conventional commit messages** to help with automated changelog generation
4. **Version dependencies carefully** - security updates should be released promptly
5. **Document breaking changes clearly** in both changelog and release notes
6. **Tag releases immediately** after version commits to maintain consistency
7. **Verify release artifacts** before announcing to users

### Troubleshooting

#### Pre-commit Hooks Fail

```bash
# Fix linting issues
npm run lint:fix

# Fix formatting issues
npm run format

# Fix markdown issues
npm run markdown:fix

# Re-run tests
npm test

# Then retry the commit
git commit -m "Your message"
```

#### GitHub CLI Authentication

```bash
# Check authentication status
gh auth status

# Login if needed
gh auth login
```

#### Release Workflow Issues

If the automated release workflow fails:

1. Check the GitHub Actions logs for specific errors
2. Ensure all environment variables are properly configured
3. Verify branch protection rules don't conflict with the workflow
4. Fall back to manual release creation using GitHub CLI

### Version History Reference

For reference, recent version history:

- **v1.2.0** (2025-08-28): Security updates, new features, bug fixes, enhancements
- **v1.1.1** (2025-08-28): Release workflow fixes, OSSF scorecard adjustments
- **v1.1.0** (2025-08-28): Enhanced release automation, workflow improvements
- **v1.0.0** (2025-08-28): Initial release with complete MCP server implementation

## Development Notes

### 🧪 Test-Driven Development (TDD) - CRITICAL PRACTICE

**🎯 This project follows strict Test-Driven Development practices. ALWAYS write tests first!**

#### TDD Workflow for New Features

**❗ MANDATORY PROCESS:**

1. **Write the Test First** (🔴 RED phase)

   ```bash
   # Create failing tests that describe the desired behavior
   npm run test:watch  # Keep this running during development
   ```

2. **Write Minimal Code** (🟢 GREEN phase)

   ```bash
   # Write just enough code to make the test pass
   # Don't worry about optimization yet
   ```

3. **Refactor and Optimize** (🟡 REFACTOR phase)

   ```bash
   # Improve code quality while keeping tests passing
   npm run test:coverage  # Verify coverage remains high
   ```

4. **Security Validation** (🔒 SECURITY phase)
   ```bash
   # Test security features for any new functionality
   # Ensure safety mechanisms can't be bypassed
   ```

#### TDD Benefits in This Project

- **🔒 Security Assurance**: Tests validate that safety mechanisms can't be bypassed
- **🛡️ Regression Prevention**: Comprehensive test suite prevents breaking changes
- **📚 Documentation**: Tests serve as living documentation of expected behavior
- **🚀 Confidence**: Deploy with confidence knowing all scenarios are tested

### Adding New MCP Tools (TDD Process)

When adding new database operations, **ALWAYS follow TDD**:

1. **Write comprehensive tests first** (following existing test patterns in `test/sqlserver-mcp.test.js`)
   - Test normal operation
   - Test error conditions
   - Test security boundaries
   - Test edge cases

2. **Add the tool definition** to the `ListToolsRequestSchema` handler
3. **Implement the corresponding method** in the `SqlServerMCP` class
4. **Add the case handler** in the `CallToolRequestSchema` switch statement
5. **Run tests continuously** during development to ensure correctness
6. **Validate security implications** - ensure new tools respect safety settings

#### Security Testing Requirements

For any new functionality that executes SQL:

```javascript
// Example: Test security validation for new tool
describe('new_tool security validation', () => {
  test('should respect read-only mode', async () => {
    // Test that tool is blocked in read-only mode if it modifies data
  });

  test('should respect destructive operations setting', async () => {
    // Test DML restrictions
  });

  test('should respect schema changes setting', async () => {
    // Test DDL restrictions
  });
});
```

### Database Compatibility

- Designed for SQL Server 2016 and later
- Uses standard INFORMATION_SCHEMA views for maximum compatibility
- System views (sys.\*) used only where necessary for advanced features

### Security Considerations

- Environment variables used for all sensitive connection details
- No hardcoded credentials or connection strings
- **Context-aware SSL/TLS encryption** with smart defaults for development vs production
- Least privilege principle recommended for database accounts
- Proper authentication method selection (SQL Server vs Windows/NTLM)

### Common Configuration Issues

- **NTLM Authentication Errors**: Ensure proper authentication method is selected based on provided credentials
- **SSL Certificate Issues**: The MCP server now automatically detects development environments and trusts certificates appropriately. For production deployments, set `SQL_SERVER_TRUST_CERT=false` explicitly.
- **Missing Environment Variables**: MCP servers require explicit configuration - `.env` files are not loaded
- **First Request Delays**: Connection pool initialization at startup eliminates timeout issues
