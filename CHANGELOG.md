# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Enhanced Documentation

- Enhanced online documentation site with auto-generated content
- Complete API reference at `/tools.html` with detailed parameter documentation
- Dynamic tool counting and version display throughout documentation
- Professional documentation layout with improved navigation and styling
- Added comprehensive documentation section to README.md explaining the auto-generation system

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

[1.2.0]: https://github.com/egarcia74/warp-sql-server-mcp/releases/tag/v1.2.0
