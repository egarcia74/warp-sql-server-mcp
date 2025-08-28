# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2025-08-28

### Fixed

- Configure git user identity for release workflow tagging ([6331756](https://github.com/egarcia74/warp-sql-server-mcp/commit/6331756))
- Silence OSSF scorecard warnings and fix release workflow issues ([203a45a](https://github.com/egarcia74/warp-sql-server-mcp/commit/203a45a))

### Changed

- Disabled OSSF Scorecard workflow to reduce noise from security warnings
- Modified release workflow to work with protected branch rules
- Removed automatic version bumping in release workflow to prevent conflicts with branch protection

## [1.1.0] - 2025-08-28

### Added

- Enhanced release automation workflow
- Improved GitHub Actions workflows with better error handling

### Improved

- Various workflow configuration improvements
- Better handling of protected branch scenarios

## [1.0.0] - 2025-08-28

### Features

- Initial release of Warp SQL Server MCP
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
- Extensive test suite with 44+ tests covering all functionality
- Complete documentation with platform-specific setup guides
- GitHub Actions CI/CD pipeline with automated testing and releases

### Security

- Secure environment variable configuration for database credentials
- Proper connection pooling and timeout handling
- SSL/TLS encryption support for production environments

[1.1.1]: https://github.com/egarcia74/warp-sql-server-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/egarcia74/warp-sql-server-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/egarcia74/warp-sql-server-mcp/releases/tag/v1.0.0
