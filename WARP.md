# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that enables Warp to interact with Microsoft SQL Server databases. The project provides a bridge between Warp's AI capabilities and SQL Server through the MCP standard, allowing for database operations, schema inspection, and data retrieval.

## Architecture

### Core Components

- **SqlServerMCP Class** (`index.js`): Main MCP server implementation that handles database connections and tool execution
- **MCP Tools**: 8 different database operation tools exposed through the MCP interface
- **Connection Management**: Handles both SQL Server authentication and Windows authentication
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

### Environment Setup

```bash
# Copy environment template and configure
cp .env.example .env
# Then edit .env with your SQL Server connection details
```

## Configuration

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

- `SQL_SERVER_CONNECT_TIMEOUT_MS`: Connection timeout in milliseconds (default: 3000)
- `SQL_SERVER_REQUEST_TIMEOUT_MS`: Query request timeout in milliseconds (default: 10000)
- `SQL_SERVER_MAX_RETRIES`: Maximum connection retry attempts (default: 1)
- `SQL_SERVER_RETRY_DELAY_MS`: Delay between retries in milliseconds (default: 200)

### Connection Pool Settings

- `SQL_SERVER_POOL_MAX`: Maximum pool connections (default: 5)
- `SQL_SERVER_POOL_MIN`: Minimum pool connections (default: 0)
- `SQL_SERVER_POOL_IDLE_TIMEOUT_MS`: Pool idle timeout in milliseconds (default: 15000)

## Warp Integration

**⚠️ CRITICAL**: MCP servers run in isolated environments and do NOT automatically load `.env` files. All configuration must be explicitly provided through Warp's MCP configuration.

### Required MCP Configuration

In Warp's MCP settings, you must provide ALL environment variables:

```json
{
  "SQL_SERVER_HOST": "localhost",
  "SQL_SERVER_PORT": "1433",
  "SQL_SERVER_DATABASE": "master",
  "SQL_SERVER_USER": "your_username",
  "SQL_SERVER_PASSWORD": "your_password",
  "SQL_SERVER_ENCRYPT": "false",
  "SQL_SERVER_TRUST_CERT": "true",
  "SQL_SERVER_CONNECT_TIMEOUT_MS": "3000",
  "SQL_SERVER_REQUEST_TIMEOUT_MS": "10000",
  "SQL_SERVER_MAX_RETRIES": "1",
  "SQL_SERVER_RETRY_DELAY_MS": "200"
}
```

### Configuration Methods

1. **Warp MCP Settings**: Configure through Warp's UI with explicit environment variables
2. **Configuration File**: Import `warp-mcp-config.json` with complete environment variables

### Connection Initialization

The MCP server initializes the database connection pool at startup (not on first request) to eliminate timeout issues during initial MCP tool calls.

The server communicates via stdio transport and provides structured responses for all database operations.

## Testing Architecture

📖 **For comprehensive test documentation, see [test/README.md](test/README.md)**

- **Vitest Framework**: Modern testing with Vitest for fast execution and great DX
- **Mocked Dependencies**: SQL Server connections are mocked for reliable, fast tests
- **Comprehensive Coverage**: 44 tests cover all MCP tools, connection handling, and error scenarios
- **Test Data**: Structured test data and realistic mock responses for consistent testing

### Test Structure

```text
test/
├── README.md              # 📖 Comprehensive test documentation
├── setup.js               # Global mocks and test data definitions
├── sqlserver-mcp.test.js   # Main test suite (44 tests)
└── ../vitest.config.js     # Test configuration
```

### Test Categories (44 total tests)

- **Database Connection Tests** (4): Connection handling, authentication, error scenarios
- **Query Execution Tests** (3): SQL query execution and database switching
- **Database/Table Operations** (6): Listing databases, tables, and schema information
- **Data Retrieval with Filtering** (10): Comprehensive WHERE clause testing
- **Query Analysis Tests** (4): Execution plans and performance analysis
- **Foreign Key Tests** (3): Relationship discovery and schema filtering
- **CSV Export Tests** (14): CSV generation with advanced filtering capabilities

## Key Implementation Details

### Connection Pooling

- Uses `mssql` package connection pooling for efficient database connections
- **Startup Initialization**: Connection pool established at server startup to eliminate first-request delays
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

## Development Notes

### Adding New MCP Tools

When adding new database operations:

1. Add the tool definition to the `ListToolsRequestSchema` handler
2. Implement the corresponding method in the `SqlServerMCP` class
3. Add the case handler in the `CallToolRequestSchema` switch statement
4. Create comprehensive tests following existing patterns

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
- **Missing Environment Variables**: MCP servers require explicit configuration - `.env` files are not loaded
- **First Request Delays**: Connection pool initialization at startup eliminates timeout issues
