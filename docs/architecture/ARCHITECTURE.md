# Architecture Guide: A Framework for Enterprise-Grade Software

> **Audience**: Engineers evaluating the system design and its layering

## Overview

This document describes the architectural design of what appears to be an MCP (Model Context Protocol) server but is
fundamentally **a comprehensive framework for building production-ready, enterprise-grade software systems**. The
architecture demonstrates advanced software engineering principles through practical implementation.

> **How to read this document.** "System Architecture" and "Core Components" describe the
> code as it exists - every component named there maps to a file in this repository. The
> sections from "Error Handling Architecture" onward are a **design rationale and
> aspiration**: they set out the patterns the project is built toward, and they name
> patterns (circuit breakers, distributed tracing, blue-green deployment, hot reload,
> schema-validated configuration) that are **not implemented**. Sections in that half carry
> an explicit marker. Do not read them as a description of runtime behaviour.

## Architectural Philosophy

The system is built on several key architectural principles:

1. **Layered Architecture**: Clear separation between presentation, business, and data layers
2. **Dependency Inversion**: High-level modules don't depend on low-level modules
3. **Single Responsibility**: Each component has one well-defined purpose
4. **Open/Closed Principle**: Components are open for extension, closed for modification
5. **Interface Segregation**: Components depend only on interfaces they actually use

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                          MCP Layer                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │        SqlServerMCP  (index.js, orchestrator)           │    │
│  │  • Tool registration and dispatch                       │    │
│  │  • Request/response handling                            │    │
│  │  • Error boundary management (McpError)                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Tool Handler Layer                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ DatabaseTools   │  │  QueryOptimizer │  │   Bottleneck    │  │
│  │    Handler      │  │                 │  │    Detector     │  │
│  │ (BaseToolHandler)│ │                 │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Infrastructure Layer                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Connection    │  │  Query Safety   │  │  Performance    │  │
│  │    Manager      │  │     Guards      │  │    Monitor      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │     Logger      │  │  ServerConfig   │  │   Streaming     │  │
│  │                 │  │                 │  │    Handler      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Data Layer                             │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │   SQL Server    │  │   File System   │                       │
│  │  (mssql pool)   │  │  (logs, CSV)    │                       │
│  └─────────────────┘  └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

> Every component below maps to a file in this repository. The list is exhaustive for the
> startup path: `index.js` constructs exactly `Logger`, `ConnectionManager`,
> `PerformanceMonitor`, `DatabaseToolsHandler`, `QueryOptimizer` and `BottleneckDetector`,
> against the module-level `serverConfig` singleton. One implemented module -
> `SecretManager` (`lib/config/secret-manager.js`) - is **not** constructed anywhere and
> takes no part in request handling; see
> [ENV-VARS.md](../reference/ENV-VARS.md) for what that means for its environment
> variables, and [#1152](https://github.com/egarcia74/warp-sql-server-mcp/issues/1152)
> for the wiring work.

### 1. SqlServerMCP (Orchestration Layer)

**File**: `index.js`

**Purpose**: Central orchestrator that owns the MCP `Server`, registers tools and routes
each call to a handler.

**Responsibilities**:

- Registers the tool catalogue from `lib/tools/tool-registry.js`
- Dispatches `CallToolRequest` to the matching handler method
- Applies the safety policy before any SQL reaches the database
  (`validateQuery`, `validateWhereClause`)
- Converts failures into `McpError` so no raw driver error escapes
- Exposes runtime diagnostics through `get_server_info`

Its constructor is the whole dependency graph:

```javascript
class SqlServerMCP {
  constructor() {
    this.config = serverConfig; // module-level ServerConfig singleton
    this.config.reload();
    this.logger = new Logger({ ... });
    this.connectionManager = new ConnectionManager(this.config.getConnectionConfig());
    this.performanceMonitor = new PerformanceMonitor(this.config.getPerformanceConfig());
    this.databaseTools = new DatabaseToolsHandler(this.connectionManager, this.performanceMonitor);
    this.queryOptimizer = new QueryOptimizer(this.connectionManager);
    this.bottleneckDetector = new BottleneckDetector(this.connectionManager);
    this.setupToolHandlers();
  }
}
```

### 2. ConnectionManager (Data Access Layer)

**File**: `lib/database/connection-manager.js`

**Purpose**: Owns the single `mssql` connection pool and everything about reaching the
server.

**Responsibilities**:

- Builds the driver config from `ServerConfig.getConnectionConfig()`, including the
  context-aware SSL decision (`_buildConnectionConfig`, `_isLikelyDevEnvironment`)
- Connects with retry (`connect`) and hands the pool to callers (`getPool`)
- Reports pool and TLS state for `get_connection_health`
  (`getConnectionHealth`, `_extractSSLInfo`)
- Closes the pool on shutdown (`close`)

There is no separate health-monitor object and no circuit breaker: health is computed on
demand from the live pool, and failure handling is bounded retry plus a surfaced error.

### 3. ServerConfig (Configuration Layer)

**File**: `lib/config/server-config.js`

**Purpose**: Single source of truth for environment-derived configuration, exported as a
module-level singleton and reloaded at startup.

**Responsibilities**:

- Parses and range-clamps every environment variable
  (`_safeParseInt`, `_safeParseFloat`)
- Groups configuration into connection, security, performance, streaming and logging
  sections consumed by the components above
- Derives the context-aware `SQL_SERVER_TRUST_CERT` default and records why it chose what
  it chose
- Renders the startup configuration summary, with the password masked

### 4. Tool Handlers (Business Logic Layer)

**Files**: `lib/tools/handlers/base-handler.js`, `lib/tools/handlers/database-tools.js`,
`lib/tools/tool-registry.js`

**Purpose**: Implement the individual MCP tools.

- **`BaseToolHandler`** holds the shared plumbing: acquiring the pool
  (`getConnection`), running a query while recording metrics (`executeQuery`), and
  rendering results as a text table or CSV (`formatResults`, `formatAsTable`,
  `formatAsCsv`).
- **`DatabaseToolsHandler`** extends it with the schema and data tools -
  `listDatabases`, `listTables`, `describeTable`, `listForeignKeys`, `getTableData`,
  `exportTableCsv`, `explainQuery`.
- **`tool-registry.js`** is the declarative catalogue (`getAllTools`, `getTool`,
  `getToolsByCategory`) that `index.js` registers with the MCP server.

Analysis tools live beside these: `QueryOptimizer` (`lib/analysis/query-optimizer.js`)
and `BottleneckDetector` (`lib/analysis/bottleneck-detector.js`) query DMVs through the
same `ConnectionManager`.

### 5. PerformanceMonitor and Logger (Observability Layer)

**Files**: `lib/utils/performance-monitor.js`, `lib/utils/logger.js`

**`PerformanceMonitor`** records per-query timings and pool statistics, bounded by
`MAX_METRICS_HISTORY` (default `1000`) and sampled at `PERFORMANCE_SAMPLING_RATE`. It
classifies a query as slow past `SLOW_QUERY_THRESHOLD` (default `5000` ms) and backs
`get_performance_stats`, `get_query_performance` and `detect_query_bottlenecks`. It is an
in-memory ring of samples - there is no alert manager and no external metrics backend.

**`Logger`** wraps Winston to provide levelled structured logging plus a separate security
audit channel. File transports are **opt-in**: `index.js` passes a path only when
`LOG_FILE` or `SECURITY_LOG_FILE` is set, so the default is console-only. See
[DEBUG-LOGGING.md](../developer/DEBUG-LOGGING.md).

### 6. Query Safety Guards (Validation Layer)

**Purpose**: Enforce the graduated safety tiers on SQL queries to prevent security
vulnerabilities. Enforcement is lexical and fail-closed — not AST/SQL parsing, whose
T-SQL dialect coverage is partial.

**Layers**:

- **`validateQuery` (`index.js`)**: Classifies a statement by its anchored prefix
  (`^\s*SELECT`, `^\s*DELETE`, …) and applies the active tier (read-only →
  destructive-operations → schema-changes). Delegates the whole batch to the batch
  guard whenever any restriction is active.
- **`sql-batch-guard.js` (`findForbiddenBatchStatement`)**: Scans the entire batch —
  after stripping string literals, quoted/bracketed identifiers and comments — for
  statement keywords the active tier forbids, wherever they appear, then requires the
  batch to open with a recognised T-SQL statement keyword. Fails closed on an
  unterminated literal, identifier or block comment (closes `GHSA-qhf4-jmhq-73c8`).
- **`where-clause-guard.js` (`findForbiddenWhereClauseSyntax`)**: Validates the
  caller-supplied WHERE clause for `get_table_data`/`export_table_csv`, requiring a
  single predicate on the requested table and rejecting batch separators, comments,
  statement keywords, top-level set operators/`SELECT` and unbalanced parentheses.

**Design Approach**:

- **Single-pass lexical scanning**: No regex backtracking on untrusted input
- **Fail-closed**: Malformed or unterminated input is rejected, never approved
- **Tiered enforcement**: Each guard consults the active read-only/destructive/schema tier

## Data Flow Architecture

### Request Processing Flow

```text
Request → Validation → Security Check → Business Logic → Data Access → Response
    ↓         ↓             ↓              ↓              ↓           ↓
  Logging  Metrics    Audit Log    Performance   Connection   Response
                                   Monitoring      Pool       Formatting
```

### 1. **Request Ingress**

- Protocol validation (MCP compliance)
- Input sanitization
- Request logging
- Metrics initiation

### 2. **Security Processing**

- Query safety validation against the active tier (`validateQuery`, `validateWhereClause`)
- Audit event generation (`Logger.security`)

There is no per-request authentication or authorization layer in the MCP server itself: the
process holds one set of database credentials, and access control is whatever the SQL
Server login is granted plus the read-only/DML/DDL tier. Least-privilege database accounts
are the intended control - see [SECURITY.md](SECURITY.md).

### 3. **Business Logic Execution**

- Tool-specific processing in the handler
- Error handling and normalisation into `McpError`
- Result formatting (text table or CSV)

Tools issue single statements against the pool; there is no explicit transaction
management layer.

### 4. **Data Layer Operations**

- Connection acquisition
- Query execution
- Result processing
- Connection release

### 5. **Response Egress**

- Response validation
- Performance metrics
- Audit logging
- Error normalization

## Error Handling Architecture

### As Implemented

There is no error class hierarchy. Every failure that leaves a tool is normalised into the
MCP SDK's `McpError` with an `ErrorCode`, so the client sees a protocol-level error and
never a raw `mssql` or Node error object. Connection failures are retried with backoff in
`ConnectionManager.connect()`; a safety-policy rejection is raised immediately by
`validateQuery` / `validateWhereClause` and audit-logged before it is thrown.

### Aspirational Patterns

> **Not implemented.** The following are design goals, not current behaviour. In
> particular there is no circuit breaker and no graceful-degradation path: a database that
> is unreachable produces an error per call.

1. **Fail Fast**: Detect errors as early as possible - _implemented_ for query validation
2. **Error Boundaries**: Prevent error propagation between layers - _implemented_ via `McpError`
3. **Graceful Degradation**: Maintain partial functionality during failures - _aspirational_
4. **Circuit Breaker**: Prevent cascade failures - _aspirational_
5. **Retry with Backoff**: Handle transient failures - _implemented_ for connection setup only

## Configuration Architecture

### As Implemented

Configuration comes from the process environment, loaded via `dotenv` and parsed by
`ServerConfig` at startup (`ServerConfig.reload()`). Each value is range-clamped to a safe
band rather than schema-validated, and there is no file-based or runtime configuration
layer: changing a variable requires restarting the server.

```text
Environment variables (.env or process env) → ServerConfig.reload() → component configs
```

### Aspirational Patterns

> **Not implemented.** Schema validation, a file configuration layer and hot reload do not
> exist today.

1. **Schema Validation**: All configuration validated against schema - _aspirational_ (values are range-clamped)
2. **Environment Parity**: Same configuration structure across environments - _implemented_
3. **Secure Defaults**: Safe operational defaults - _implemented_ (read-only by default)
4. **Hot Reload**: Runtime configuration updates where safe - _aspirational_

## Monitoring and Observability

### Metrics Architecture

```text
Application Metrics → Aggregation → Storage → Visualization/Alerting
       ↓
   System Metrics → Collection → Processing → Analysis
       ↓
  Business Metrics → Calculation → Reporting → Decision Support
```

### Observability Patterns

> **Partly aspirational.** There is no metrics backend, no tracing and no alerting: metrics
> live in an in-memory ring inside `PerformanceMonitor` and are read back through MCP tools.

1. **Structured Logging**: Consistent, searchable log format - _implemented_ (`Logger`, Winston)
2. **Distributed Tracing**: Request flow across components - _aspirational_
3. **Metrics Collection**: Quantitative system measurements - _implemented_, in-memory only
4. **Health Checks**: Automated system health assessment - _implemented_ (`get_connection_health`)
5. **Alerting**: Automated incident response - _aspirational_

## Testing Architecture

### Test Pyramid

```text
                    ▲
                   /E\     End-to-End Tests
                  /___\    (Integration validation)
                 /     \
                / Unit  \   Unit Tests
               /  Tests  \  (Component behavior)
              /___________\
```

### Testing Patterns

1. **Test Isolation**: Each test runs independently
2. **Mock Strategy**: External dependencies mocked consistently
3. **Behavior Verification**: Tests verify behavior, not implementation
4. **Edge Case Coverage**: Comprehensive error condition testing
5. **Performance Testing**: Load and stress testing included

## Security Architecture

### Security Layers

```text
Network Security → Authentication → Authorization → Input Validation →
Data Access Control → Audit Logging → Threat Detection
```

### Security Patterns

1. **Defense in Depth**: Multiple security layers
2. **Principle of Least Privilege**: Minimal necessary access
3. **Security by Default**: Secure default configurations
4. **Audit Trail**: Comprehensive security event logging
5. **Threat Modeling**: Systematic security analysis

## Scalability Considerations

### Horizontal Scaling Patterns

> **Partly aspirational.** The server is a single stdio process launched by one MCP client;
> load balancing and circuit breaking are design goals for a future deployment shape, not
> current behaviour.

1. **Connection Pooling**: Efficient database connection reuse - _implemented_ (`mssql` pool)
2. **Stateless Design**: No server-side session state - _implemented_
3. **Load Balancing**: Request distribution across instances - _aspirational_
4. **Circuit Breaker**: Fault isolation and recovery - _aspirational_

### Performance Optimization

1. **Query Optimization**: SQL performance monitoring and tuning
2. **Caching Strategy**: Intelligent data caching
3. **Resource Management**: Efficient resource utilization
4. **Asynchronous Processing**: Non-blocking operations where possible

## Deployment Architecture

### Environment Progression

```text
Development → Testing → Staging → Production
     ↓           ↓        ↓          ↓
   Local DB → Test DB → Staging → Production
              Mock     Database   Database
              Services
```

### Deployment Patterns

> **Aspirational.** The server ships as an npm package that an MCP client spawns locally.
> There is no deployment pipeline of its own beyond the release workflow, so blue-green
> deployment and rollback describe a target shape rather than anything implemented here.

1. **Blue-Green Deployment**: Zero-downtime deployments - _aspirational_
2. **Configuration Management**: Environment-specific configuration - _implemented_
3. **Health Checks**: Automated deployment validation - _implemented_ (`get_connection_health`)
4. **Rollback Capability**: Quick failure recovery - _aspirational_ (npm version pinning only)

## Future Extensibility

### Extension Points

> **Aspirational.** None of these extension points exists yet. Adding a tool today means
> editing `lib/tools/tool-registry.js` and a handler; there is no plugin loader, event bus
> or provider interface.

1. **Plugin Architecture**: Modular tool additions
2. **Event System**: Extensible event handling
3. **Configuration Providers**: Multiple configuration sources - the unwired `SecretManager` is the closest thing
4. **Monitoring Backends**: Pluggable monitoring systems
5. **Authentication Providers**: Multiple auth mechanisms - SQL and Windows auth are supported today

### Design for Change

1. **Interface-Based Design**: Dependencies on abstractions
2. **Configuration-Driven Behavior**: Runtime behavior modification
3. **Modular Architecture**: Independent component evolution
4. **Versioned APIs**: Backward-compatible interface evolution

## Conclusion

This architecture represents a comprehensive approach to building enterprise-grade software systems. It demonstrates how rigorous engineering principles can be applied to create software that is:

- **Reliable**: Consistent behavior under various conditions
- **Maintainable**: Clear structure enables safe modifications
- **Scalable**: Architecture supports growth in load and complexity
- **Secure**: Multiple layers of security controls
- **Observable**: Comprehensive monitoring and debugging capabilities
- **Testable**: Architecture facilitates comprehensive testing

The patterns and principles demonstrated here are transferable to any software engineering project requiring enterprise-grade quality and operational characteristics.
