# Warp SQL Server MCP

Secure Model Context Protocol (MCP) server enabling the Warp terminal to interact with Microsoft SQL Server through a three-tier safety system.

## Requirements
- Node.js 18+
- Access to a SQL Server instance

## Key Features
- Execute SQL queries with graduated safety levels
- Inspect databases, tables and schemas
- Stream large result sets and export to CSV
- Performance monitoring and structured logging

## Installation

```bash
npm install
cp .env.example .env
# edit .env with your SQL Server details
node index.js
```

### Minimal `.env`

```env
SQL_SERVER_HOST=localhost
SQL_SERVER_PORT=1433
SQL_SERVER_DATABASE=master
SQL_SERVER_USER=your_username
SQL_SERVER_PASSWORD=your_password
```

### First Query

With the server running, try a query from Warp:

```json
{"name": "execute_query", "input": {"query": "SELECT @@VERSION"}}
```

## Configuration

### Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| SQL_SERVER_HOST | SQL Server hostname | localhost |
| SQL_SERVER_PORT | SQL Server port | 1433 |
| SQL_SERVER_DATABASE | Initial database | master |
| SQL_SERVER_USER | Username for SQL auth | — |
| SQL_SERVER_PASSWORD | Password for SQL auth | — |
| SQL_SERVER_READ_ONLY | Allow only SELECT queries | true |
| SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS | Allow INSERT/UPDATE/DELETE | false |
| SQL_SERVER_ALLOW_SCHEMA_CHANGES | Allow CREATE/DROP/ALTER | false |

### Safety tiers

| Tier | READ_ONLY | ALLOW_DESTRUCTIVE_OPERATIONS | ALLOW_SCHEMA_CHANGES | Use case |
| --- | --- | --- | --- | --- |
| Maximum Security (default) | true | false | false | production monitoring |
| Data Analysis | false | true | false | ETL / imports |
| Full Access | false | true | true | local development |

See [WARP.md](WARP.md) for Warp indexing context and [MANIFESTO.md](MANIFESTO.md) for the engineering philosophy. Full documentation and advanced guides live on the [project docs site](https://egarcia74.github.io/warp-sql-server-mcp/).

For contribution guidelines see [CONTRIBUTING.md](CONTRIBUTING.md).
