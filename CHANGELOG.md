# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2025-08-28

### Added - Security Features

- **🔒 Three-Tier Graduated Safety System**: Revolutionary security architecture for production database safety
  - **Read-Only Mode**: `SQL_SERVER_READ_ONLY` (default: `true`) - Restricts to SELECT queries only
  - **Destructive Operations Control**: `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` (default: `false`) - Controls INSERT/UPDATE/DELETE
  - **Schema Changes Control**: `SQL_SERVER_ALLOW_SCHEMA_CHANGES` (default: `false`) - Controls CREATE/DROP/ALTER
  - **Secure by Default**: Maximum security out-of-the-box with explicit opt-in for dangerous operations
  - **Comprehensive Query Validation**: Advanced regex-based SQL parsing to enforce security policies
  - **Clear Security Feedback**: Detailed error messages explaining why operations are blocked
  - **Runtime Security Status**: Every response includes current safety configuration for transparency

- **🛡️ Production Security Features**
  - **Startup Security Summary**: Visual security status display in MCP logs with emoji indicators
  - **Security Level Indicators**: `🔒 SECURE` / `⚠️ UNSAFE` status with detailed breakdown (RO/RW, DML±, DDL±)
  - **Configuration Validation**: Automatic detection and warning of unsafe production configurations
  - **Audit Trail**: Security decisions logged for compliance and troubleshooting
  - **Comprehensive Documentation**: Dedicated `SECURITY.md` with threat model and deployment guidelines

- **📋 Configuration Management**
  - **Enhanced .env.example**: Comprehensive security configuration examples with detailed explanations
  - **Environment-Specific Templates**: Production, staging, and development configuration patterns
  - **Security Checklist**: Production deployment validation checklist
  - **Migration Guide**: Clear upgrade path for existing installations

### Added - Documentation & Tooling

- **Enhanced Auto-Generated Documentation System**: Complete overhaul of documentation generation
  - `scripts/extract-docs.js` - Automatically parses MCP tool definitions from source code
  - `scripts/generate-tools-html.js` - Creates comprehensive API reference with parameters and examples
  - `scripts/generate-landing-page.js` - Generates dynamic landing page with current tool counts
  - Documentation now auto-extracts all 8 MCP tools with full parameter details and usage examples
  - Landing page displays dynamic version numbers and tool counts from actual code
  - Detailed API reference page with parameter tables, required/optional indicators, and code examples
  - Ensures documentation never goes out of sync with actual code changes
  - Professional styling with table of contents, navigation, and responsive design
  - Automatic rebuilds on every push via GitHub Actions integration

### Security

- **🚨 BREAKING CHANGE**: Default behavior now prioritizes security over functionality
  - **New installations default to read-only mode** - only SELECT queries allowed
  - **Existing configurations may need updates** - see migration guide in SECURITY.md
  - **Explicit configuration required** for write operations in production
- **Comprehensive Security Testing**: 100% coverage of security validation logic
- **Threat Model Documentation**: Detailed analysis of mitigated and unmitigated threats
- **Security Response Process**: Formal vulnerability disclosure and response procedures

### Enhanced Documentation

- Enhanced online documentation site with auto-generated content
- Complete API reference at `/tools.html` with detailed parameter documentation
- Dynamic tool counting and version display throughout documentation
- Professional documentation layout with improved navigation and styling
- Added comprehensive documentation section to README.md explaining the auto-generation system

### Added - User Experience

- **🚀 Quick Start Guide**: New QUICKSTART.md providing 5-minute setup walkthrough
  - Step-by-step installation and configuration
  - Security defaults explanation
  - Basic testing and troubleshooting
  - Cross-references to detailed documentation
- **📚 Enhanced User Onboarding**: Quick Start references added throughout documentation
  - Prominent Quick Start links in README.md, SECURITY.md, CONTRIBUTING.md, WARP.md
  - Improved navigation for new users
  - Better documentation discoverability

## [1.2.0] - 2025-08-28

**Note**: This is the initial clean release. Previous versions (v1.0.0-v1.1.1) were
removed for security reasons.

### Features

- Complete MCP server implementation for SQL Server connectivity
- 8 comprehensive MCP tools:
  - `execute_query` - Execute arbitrary SQL queries
  - `list_databases` - List all user databases
  - `list_tables` - List tables in a database/schema
  - `describe_table` - Get detailed table schema information
  - `get_table_data` - Retrieve sample data with filtering
  - `explain_query` - Analyze query performance and execution plans
  - `list_foreign_keys` - Discover foreign key relationships
  - `export_table_csv` - Export table data in CSV format
- Support for both SQL Server Authentication and Windows Authentication
- Comprehensive error handling and connection management
- Extensive test suite with 56 tests covering all functionality
- Complete documentation with platform-specific setup guides
- GitHub Actions CI/CD pipeline with automated testing and releases

### Security

- Upgrade mssql dependency to v11.0.1 for enhanced security and compatibility
- Secure environment variable configuration for database credentials
- Proper connection pooling and timeout handling
- SSL/TLS encryption support for production environments
- Comprehensive release process documentation

### Documentation

- Coverage report copying to documentation deployment for better CI/CD integration
- Comprehensive CHANGELOG.md with standardized format
- Enhanced GitHub Actions workflow documentation and annotations
- Reduced linter noise with proper workflow comments
- Better GitHub Pages integration with dynamic version detection
- Cleaner documentation with fixed badges and links
- Complete release process guide in WARP.md
- Updated test documentation with current coverage and test counts

[1.3.0]: https://github.com/egarcia74/warp-sql-server-mcp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/egarcia74/warp-sql-server-mcp/releases/tag/v1.2.0
