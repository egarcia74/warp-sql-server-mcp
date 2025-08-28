# Warp SQL Server MCP

A Model Context Protocol (MCP) server that provides Warp with the ability to connect to and interact with Microsoft SQL Server databases.

## Features

- **Database Connection**: Connect to SQL Server on localhost:1433 (configurable)
- **Query Execution**: Execute arbitrary SQL queries
- **Schema Inspection**: List databases, tables, and describe table structures
- **Data Retrieval**: Get sample data from tables with filtering and limiting
- **Authentication**: Support for both SQL Server authentication and Windows authentication

## Available Tools

1. **execute_query**: Execute any SQL query on the connected database
2. **list_databases**: List all user databases on the SQL Server instance
3. **list_tables**: List all tables in a specific database/schema
4. **describe_table**: Get detailed schema information for a table
5. **get_table_data**: Retrieve sample data from tables with optional filtering

## Prerequisites

- Node.js 18.0.0 or higher
- SQL Server instance running on localhost:1433 (or configured host/port)
- Appropriate database permissions for the connecting user

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment template and configure your connection:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your SQL Server connection details:
   ```bash
   # For SQL Server Authentication
   SQL_SERVER_HOST=localhost
   SQL_SERVER_PORT=1433
   SQL_SERVER_DATABASE=master
   SQL_SERVER_USER=your_username
   SQL_SERVER_PASSWORD=your_password
   
   # For Windows Authentication (leave USER and PASSWORD empty)
   # SQL_SERVER_DOMAIN=your_domain
   ```

## Configuration for Warp

### Method 1: Using Warp's MCP Settings

1. Open Warp and go to Settings
2. Navigate to the MCP section
3. Add a new MCP server with these settings:
   - **Name**: sql-server
   - **Command**: node
   - **Args**: `["/Users/egarcia74/Source/Repos/GitHub/warp-sql-server-mcp/index.js"]`
   - **Environment Variables**:
     - `SQL_SERVER_HOST`: localhost
     - `SQL_SERVER_PORT`: 1433
     - `SQL_SERVER_DATABASE`: master
     - Add authentication variables as needed

### Method 2: Using Configuration File

1. Use the provided `warp-mcp-config.json` configuration
2. Update the paths and environment variables as needed
3. Import this configuration into Warp

## Usage Examples

Once configured, you can use the MCP tools in Warp:

### List all databases
```
Please list all databases on the SQL Server
```

### Execute a query
```
Execute this SQL query: SELECT TOP 10 * FROM Users ORDER BY CreatedDate DESC
```

### Describe a table structure
```
Can you describe the structure of the Orders table?
```

### Get sample data with filtering
```
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

## Troubleshooting

### Connection Issues
- Verify SQL Server is running and accepting connections on port 1433
- Check firewall settings
- Ensure TCP/IP protocol is enabled in SQL Server Configuration Manager
- Verify authentication credentials

### Permission Issues
- Ensure the connecting user has appropriate database permissions
- For Windows Authentication, run the process with appropriate user context

### Network Issues
- Test connectivity using tools like `telnet localhost 1433`
- Check SQL Server network configuration
- Verify named pipes vs TCP/IP settings

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2025 Eduardo Garcia
