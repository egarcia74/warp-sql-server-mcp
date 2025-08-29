# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a **secure** and **enterprise-ready** Model Context Protocol (MCP) server that enables Warp to interact with
Microsoft SQL Server databases safely and securely. The project provides a bridge between
Warp's AI capabilities and SQL Server through the MCP standard, featuring a revolutionary
**three-tier graduated safety system** for production database security, **advanced query validation**,
**streaming support for large datasets**, **comprehensive performance monitoring**, and **cloud-ready
secret management**. Built with a modular architecture for enterprise-scale deployments.

**🚀 Quick Start**: New users should begin with the [Quick Start Guide](QUICKSTART.md) for a 5-minute setup walkthrough.

## Architecture

### Core Components

- **SqlServerMCP Class** (`index.js`): Main MCP server implementation that handles
  database connections, security validation, and tool execution
- **🔒 Three-Tier Safety System**: Revolutionary security architecture with graduated safety levels
- **Query Validation Engine**: Intelligent SQL parsing and security policy enforcement
- **MCP Tools**: 8 different database operation tools exposed through the MCP interface
- **Connection Management**: Handles both SQL Server authentication and Windows authentication
- **Security Monitoring**: Runtime security status reporting and startup security summaries
- **Error Handling**: Comprehensive error handling with structured MCP error responses

### MCP Tools Available

1. **execute_query**: Execute arbitrary SQL queries
2. **list_databases**: List all user databases (excludes system databases)
3. **list_tables**: List tables in a specific database/schema
4. **describe_table**: Get detailed table schema information
5. **get_table_data**: Retrieve sample data with filtering/limiting
6. **explain_query**: Analyze query performance with execution plans
7. **list_foreign_keys**: Discover foreign key relationships
8. **export_table_csv**: Export table data in CSV format

### Authentication Methods

- **SQL Server Authentication**: Username/password based
- **Windows Authentication**: NTLM-based (when user/password not provided)

## Enhanced Architecture (v1.4.0+)

### 🏗️ Modular Architecture

Starting with v1.4.0, the project follows a modular architecture with specialized components:

```text
lib/
├── config/
│   └── secret-manager.js     # 🔐 Universal secret management
├── security/
│   └── query-validator.js    # 🔒 Enhanced SQL validation
└── utils/
    ├── logger.js             # 📝 Structured logging
    ├── performance-monitor.js # ⚡ Performance tracking
    ├── response-formatter.js  # 📊 Response formatting
    └── streaming-handler.js   # 📈 Large data streaming
```

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

### 🔒 Advanced Query Validation

**AST-Based SQL Analysis**: Replaces regex-based validation with proper SQL parsing:

- **SQL Parser Integration**: Uses `node-sql-parser` for comprehensive AST analysis
- **Multi-Statement Validation**: Validates each statement in complex queries
- **Dangerous Function Detection**: Blocks `xp_cmdshell`, `openrowset`, `sp_configure`, etc.
- **SQL Injection Protection**: Advanced pattern detection in string literals
- **Graceful Fallback**: Regex validation for edge cases where parsing fails

#### New Security Features

```javascript
// Enhanced validation detects:
- Dangerous system functions (xp_cmdshell, openrowset)
- SQL injection patterns in AST nodes
- Multi-statement queries with mixed permissions
- Complex CTE and subquery security boundaries
```

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
# Run all tests
npm test

# Run tests in watch mode (reruns on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with UI interface
npm run test:ui
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
```

### Git Hooks and CI

```bash
# Install git hooks (pre-commit and pre-push)
npm run hooks:install

# Run the full CI pipeline locally
npm run ci

# Run pre-commit checks manually
npm run precommit
```

### Environment Setup

```bash
# Copy environment template and configure
cp .env.example .env
# Then edit .env with your SQL Server connection details
```

## Environment Configuration

### Environment Variables (Required)

- `SQL_SERVER_HOST`: SQL Server hostname (default: localhost)
- `SQL_SERVER_PORT`: SQL Server port (default: 1433)
- `SQL_SERVER_DATABASE`: Initial database to connect to (default: master)

### Authentication Variables

For SQL Server Authentication:

- `SQL_SERVER_USER`: Database username
- `SQL_SERVER_PASSWORD`: Database password

For Windows Authentication (leave user/password empty):

- `SQL_SERVER_DOMAIN`: Optional Windows domain

### Security Options

- `SQL_SERVER_ENCRYPT`: Enable SSL encryption (default: false)
- `SQL_SERVER_TRUST_CERT`: Trust server certificate (default: true)

### Timeout and Retry Configuration

- `SQL_SERVER_CONNECT_TIMEOUT_MS`: Connection timeout in milliseconds (default: 10000)
- `SQL_SERVER_REQUEST_TIMEOUT_MS`: Query request timeout in milliseconds (default: 30000)
- `SQL_SERVER_MAX_RETRIES`: Maximum connection retry attempts (default: 3)
- `SQL_SERVER_RETRY_DELAY_MS`: Delay between retries in milliseconds (default: 1000)

### Connection Pool Settings

- `SQL_SERVER_POOL_MAX`: Maximum pool connections (default: 10)
- `SQL_SERVER_POOL_MIN`: Minimum pool connections (default: 0)
- `SQL_SERVER_POOL_IDLE_TIMEOUT_MS`: Pool idle timeout in milliseconds (default: 30000)

### 🔒 Security Configuration (NEW - CRITICAL)

**⚠️ BREAKING CHANGE**: Starting with v1.3.0, the MCP server defaults to maximum security.

#### Three-Tier Safety System

| Variable                                  | Default | Security Level | Impact                      |
| ----------------------------------------- | ------- | -------------- | --------------------------- |
| `SQL_SERVER_READ_ONLY`                    | `true`  | **SECURE**     | Only SELECT queries allowed |
| `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | **SECURE**     | Blocks INSERT/UPDATE/DELETE |
| `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | **SECURE**     | Blocks CREATE/DROP/ALTER    |

#### Security Configurations

**🔒 Maximum Security (Default - Production Recommended):**

```bash
SQL_SERVER_READ_ONLY=true                      # Only SELECT allowed
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false  # No data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false         # No schema changes
```

**📊 Data Analysis Mode:**

```bash
SQL_SERVER_READ_ONLY=false                     # Enable write operations
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true   # Allow data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false         # Block schema changes
```

**🛠️ Full Development Mode (Use with Caution):**

```bash
SQL_SERVER_READ_ONLY=false                     # Enable write operations
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true   # Allow data modifications
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true          # Allow schema changes
```

#### Security Status Monitoring

The MCP server displays security status at startup:

```bash
# Maximum Security (Default)
Security: 🔒 SECURE (RO, DML-, DDL-)

# Unsafe Configuration
Security: ⚠️ UNSAFE (RW, DML+, DDL+)
WARNING: Read-write mode, DML allowed, DDL allowed - consider stricter settings for production
```

## Warp Integration

**⚠️ CRITICAL**: MCP servers run in isolated environments and do NOT
automatically load `.env` files. All configuration must be explicitly provided
through Warp's MCP configuration.

### Required MCP Configuration

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
- **Comprehensive Coverage**: 56 tests cover all MCP tools, connection handling, and error scenarios
- **Test Data**: Structured test data and realistic mock responses for consistent testing

### Test Structure

```text
test/
├── README.md              # 📖 Comprehensive test documentation
├── setup.js               # Global mocks and test data definitions
├── sqlserver-mcp.test.js   # Main test suite (56 tests)
└── ../vitest.config.js     # Test configuration
```

### Test Categories (56 total tests)

- **Database Connection Tests** (4): Connection handling, authentication, error scenarios
- **Query Execution Tests** (3): SQL query execution and database switching
- **Database/Table Operations** (6): Listing databases, tables, and schema information
- **Data Retrieval with Filtering** (10): Comprehensive WHERE clause testing
- **Query Analysis Tests** (4): Execution plans and performance analysis
- **Foreign Key Tests** (3): Relationship discovery and schema filtering
- **CSV Export Tests** (14): CSV generation with advanced filtering capabilities
- **Server Startup and Runtime** (7): Connection pool initialization, error handling scenarios
- **Error Handling and Edge Cases** (10): Comprehensive error condition testing

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
- **17 features** organized by priority and implementation phase
- **Strategic alignment** with enterprise-grade software framework vision
- **Regular updates**: Weekly status, monthly priority adjustments, quarterly roadmap reviews

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

#### **Phase 1 (0-3 months)**: User Experience Focus

- Advanced Data Export Options (Excel, JSON, Parquet)
- Query Builder & Template System

#### **Phase 2 (3-6 months)**: Analytics & Performance

- Enhanced Data Visualization Support
- Query Optimization & Performance Tools
- Data Quality & Validation Framework

#### **Phase 3 (6-12 months)**: Enterprise Features

- Real-time Data Monitoring
- Advanced Security & Audit Features
- Database Comparison & Synchronization

#### **Phase 4 (12+ months)**: Platform Expansion

- Multi-Database Support
- Natural Language Query Interface
- AI/ML Integration

### Backlog Management Process

1. **Feature Request**: Use GitHub issue template for new features
2. **Backlog Review**: Monthly priority adjustments based on user feedback
3. **Planning**: Quarterly roadmap reviews and phase adjustments
4. **Implementation**: Follow TDD process with comprehensive testing
5. **Documentation**: Update backlog status and maintain synchronization

## Development Workflow

### Code Quality Standards

This project maintains high code quality through automated tooling:

- **ESLint**: Modern flat config setup for JavaScript linting with focus on code
  quality (formatting handled by Prettier)
- **Prettier**: Authoritative code formatter handling all style concerns
  including indentation
- **Markdownlint**: Documentation formatting and consistency
- **Vitest**: Fast, modern testing framework with coverage reporting
- **Git Hooks**: Automated pre-commit and pre-push quality checks

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

### ESLint and Prettier Integration

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

#### 4. Update package.json Version

```json
{
  "version": "X.Y.Z"
}
```

#### 5. Commit Version Changes

```bash
git add CHANGELOG.md package.json
git commit -m "chore: bump version to vX.Y.Z

- Update CHANGELOG.md with vX.Y.Z release notes
- Update package.json version to X.Y.Z
- Include summary of key changes"
git push origin main
```

**Note**: Pre-commit hooks will run automatically and must pass.

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
3. Select release type: `auto`, `patch`, `minor`, `major`, or `prerelease`
4. Optionally enable "Dry run" to preview without creating the release
5. Click "Run workflow"

**Note**: The automated workflow is currently set to `workflow_dispatch`
(manual trigger) to provide better control over releases.

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
- Optional SSL/TLS encryption support (disable for local development)
- Least privilege principle recommended for database accounts
- Proper authentication method selection (SQL Server vs Windows/NTLM)

### Common Configuration Issues

- **NTLM Authentication Errors**: Ensure proper authentication method is selected based on provided credentials
- **Connection Timeouts**: Disable SSL encryption (`SQL_SERVER_ENCRYPT=false`) for local development
- **Missing Environment Variables**: MCP servers require explicit configuration -
  `.env` files are not loaded
- **First Request Delays**: Connection pool initialization at startup eliminates timeout issues
