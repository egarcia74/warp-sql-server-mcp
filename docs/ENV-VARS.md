# Environment Variables Reference

> **📍 Single Source of Truth**: This document contains the complete reference for all environment
> variables supported by the SQL Server MCP. Other documentation files reference this document to
> avoid duplication.

## Overview

The SQL Server MCP uses environment variables for all configuration. This approach provides:

- **Secure credential management**: Sensitive data stays out of configuration files
- **Environment-specific settings**: Different configurations for development, testing, and production
- **Docker and container compatibility**: Standard environment variable approach
- **Zero-config defaults**: Sensible defaults for most common use cases

## Quick Reference

| Variable                                                                              | Default     | Context-Aware | Description            |
| ------------------------------------------------------------------------------------- | ----------- | ------------- | ---------------------- |
| [`SQL_SERVER_HOST`](#sql_server_host)                                                 | `localhost` | No            | SQL Server hostname    |
| [`SQL_SERVER_PORT`](#sql_server_port)                                                 | `1433`      | No            | SQL Server port        |
| [`SQL_SERVER_DATABASE`](#sql_server_database)                                         | `master`    | No            | Initial database       |
| [`SQL_SERVER_USER`](#sql_server_user)                                                 | _(none)_    | No            | Database username      |
| [`SQL_SERVER_PASSWORD`](#sql_server_password)                                         | _(none)_    | No            | Database password      |
| [`SQL_SERVER_DOMAIN`](#sql_server_domain)                                             | _(none)_    | No            | Windows domain         |
| [`SQL_SERVER_ENCRYPT`](#sql_server_encrypt)                                           | `true`      | No            | Enable SSL encryption  |
| [`SQL_SERVER_TRUST_CERT`](#sql_server_trust_cert)                                     | _(smart)_   | **Yes**       | Trust SSL certificates |
| [`SQL_SERVER_READ_ONLY`](#sql_server_read_only)                                       | `true`      | No            | Read-only mode         |
| [`SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS`](#sql_server_allow_destructive_operations) | `false`     | No            | Allow DML operations   |
| [`SQL_SERVER_ALLOW_SCHEMA_CHANGES`](#sql_server_allow_schema_changes)                 | `false`     | No            | Allow DDL operations   |

## Connection Settings

### `SQL_SERVER_HOST`

- **Default**: `localhost`
- **Description**: SQL Server hostname or IP address
- **Examples**:
  - `localhost` (local development)
  - `db.company.com` (production server)
  - `192.168.1.10` (private network)

### `SQL_SERVER_PORT`

- **Default**: `1433`
- **Description**: SQL Server port number
- **Examples**:
  - `1433` (default SQL Server port)
  - `1434` (SQL Server Browser service)
  - `14330` (custom port)

### `SQL_SERVER_DATABASE`

- **Default**: `master`
- **Description**: Initial database to connect to
- **Examples**:
  - `master` (system database)
  - `Northwind` (sample database)
  - `MyAppDB` (application database)

### `SQL_SERVER_USER`

- **Default**: _(none - triggers Windows Authentication)_
- **Description**: SQL Server authentication username
- **Examples**:
  - `sa` (system administrator)
  - `app_user` (application user)
  - _(leave empty for Windows Authentication)_

### `SQL_SERVER_PASSWORD`

- **Default**: _(none - triggers Windows Authentication)_
- **Description**: SQL Server authentication password
- **Security**: Always use environment variables, never hardcode passwords
- **Examples**:
  - `MySecurePassword123!`
  - _(leave empty for Windows Authentication)_

### `SQL_SERVER_DOMAIN`

- **Default**: _(none)_
- **Description**: Windows domain for NTLM authentication
- **Used when**: `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD` are not provided
- **Examples**:
  - `CORP` (corporate domain)
  - `WORKGROUP` (workgroup)

## SSL/TLS Security Settings

### `SQL_SERVER_ENCRYPT`

- **Default**: `true`
- **Description**: Enable SSL/TLS encryption for the connection
- **Recommendation**: Keep enabled for both development and production
- **Values**:
  - `true` (enable encryption)
  - `false` (disable encryption - not recommended)

### `SQL_SERVER_TRUST_CERT`

- **Default**: **Context-Aware** (see below)
- **Description**: Whether to trust the SQL Server's SSL certificate
- **Context-Aware Behavior**:
  - **Development environments**: `true` (localhost/127.0.0.1 always; private IPs/.local only with NODE_ENV=development/test)
  - **Production environments**: `false` (all other scenarios, including private IPs without explicit NODE_ENV)
- **Override Options**:
  - `true` (always trust - useful for self-signed certificates)
  - `false` (never trust - requires valid CA-signed certificates)
  - _(unset)_ (use smart environment-aware defaults)

#### Context-Aware SSL Certificate Detection

The system uses a **conservative security approach** and automatically detects your environment to apply appropriate SSL certificate trust defaults:

**🔧 Strong Development Indicators** (always auto-trust certificates):

- `NODE_ENV=development` or `NODE_ENV=test`
- `SQL_SERVER_HOST=localhost` or `SQL_SERVER_HOST=127.0.0.1`

**⚠️ Weak Development Indicators** (only trust with explicit NODE_ENV):

- `SQL_SERVER_HOST` ends with `.local` **AND** `NODE_ENV=development/test`
- `SQL_SERVER_HOST` is a private IP address **AND** `NODE_ENV=development/test`:
  - `192.168.x.x` ranges
  - `10.x.x.x` ranges
  - `172.16.x.x` through `172.31.x.x` ranges

**🔒 Production Environment (default)** (require valid certificates):

- All other scenarios, including:
  - `NODE_ENV=production` or no NODE_ENV set
  - Public domain names and IP addresses
  - Private IPs without explicit NODE_ENV=development/test
  - `.local` domains without explicit NODE_ENV=development/test

**Security Note**: The system errs on the side of security. Private networks and `.local` domains are **NOT**
automatically trusted unless you explicitly set `NODE_ENV=development` or `NODE_ENV=test`. This prevents
accidental certificate trust in cloud production environments using private IP addresses.

## Database Security Settings

### `SQL_SERVER_READ_ONLY`

- **Default**: `true`
- **Description**: Enable read-only mode (only SELECT queries allowed)
- **Values**:
  - `true` (maximum security - only SELECT queries)
  - `false` (enable write operations)

### `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS`

- **Default**: `false`
- **Description**: Allow data modification operations (INSERT, UPDATE, DELETE, TRUNCATE)
- **Prerequisites**: `SQL_SERVER_READ_ONLY=false`
- **Values**:
  - `true` (enable data modification)
  - `false` (block data modification)

### `SQL_SERVER_ALLOW_SCHEMA_CHANGES`

- **Default**: `false`
- **Description**: Allow database schema operations (CREATE, DROP, ALTER, GRANT, REVOKE)
- **Prerequisites**: `SQL_SERVER_READ_ONLY=false`
- **Values**:
  - `true` (enable schema changes)
  - `false` (block schema changes)

## Connection Pool & Performance Settings

### `SQL_SERVER_CONNECT_TIMEOUT_MS`

- **Default**: `10000` (10 seconds)
- **Description**: Connection establishment timeout in milliseconds
- **Examples**:
  - `5000` (5 seconds - fast networks)
  - `30000` (30 seconds - slow networks)

### `SQL_SERVER_REQUEST_TIMEOUT_MS`

- **Default**: `30000` (30 seconds)
- **Description**: Query execution timeout in milliseconds
- **Examples**:
  - `15000` (15 seconds - quick queries)
  - `300000` (5 minutes - long-running queries)

### `SQL_SERVER_MAX_RETRIES`

- **Default**: `3`
- **Description**: Maximum connection retry attempts
- **Examples**:
  - `1` (no retries)
  - `5` (more resilient to network issues)

### `SQL_SERVER_RETRY_DELAY_MS`

- **Default**: `1000` (1 second)
- **Description**: Initial delay between retry attempts (uses exponential backoff)
- **Examples**:
  - `500` (500ms - faster retries)
  - `2000` (2 seconds - slower retries)

### `SQL_SERVER_POOL_MAX`

- **Default**: `10`
- **Description**: Maximum number of connections in the pool
- **Examples**:
  - `5` (lightweight usage)
  - `20` (high-concurrency usage)

### `SQL_SERVER_POOL_MIN`

- **Default**: `0`
- **Description**: Minimum number of connections in the pool
- **Examples**:
  - `0` (connections created on demand)
  - `2` (maintain warm connections)

### `SQL_SERVER_POOL_IDLE_TIMEOUT_MS`

- **Default**: `30000` (30 seconds)
- **Description**: Idle connection timeout in milliseconds
- **Examples**:
  - `10000` (10 seconds - aggressive cleanup)
  - `60000` (1 minute - keep connections longer)

## Performance Monitoring Settings

### `ENABLE_PERFORMANCE_MONITORING`

- **Default**: `true`
- **Description**: Enable query performance tracking and metrics collection
- **Benefits**: Query performance insights, bottleneck detection, optimization recommendations
- **Values**:
  - `true` (enable monitoring)
  - `false` (disable monitoring)

### `MAX_METRICS_HISTORY`

- **Default**: `1000`
- **Description**: Maximum number of performance records to retain in memory
- **Examples**:
  - `500` (lower memory usage)
  - `2000` (longer performance history)

### `SLOW_QUERY_THRESHOLD`

- **Default**: `5000` (5 seconds)
- **Description**: Threshold in milliseconds for flagging slow queries
- **Examples**:
  - `1000` (flag queries > 1 second)
  - `10000` (flag queries > 10 seconds)

### `TRACK_POOL_METRICS`

- **Default**: `true`
- **Description**: Monitor connection pool health and utilization
- **Values**:
  - `true` (track pool metrics)
  - `false` (disable pool monitoring)

### `PERFORMANCE_SAMPLING_RATE`

- **Default**: `1.0` (100%)
- **Description**: Fraction of queries to monitor (0.0 to 1.0)
- **Examples**:
  - `0.1` (monitor 10% of queries)
  - `0.5` (monitor 50% of queries)
  - `1.0` (monitor all queries)

## Streaming Configuration

### `ENABLE_STREAMING`

- **Default**: `true`
- **Description**: Enable intelligent streaming for large datasets
- **Benefits**: Prevents memory exhaustion with large result sets
- **Values**:
  - `true` (enable streaming)
  - `false` (disable streaming)

### `STREAMING_BATCH_SIZE`

- **Default**: `1000`
- **Description**: Number of rows processed per batch during streaming
- **Examples**:
  - `500` (smaller batches - lower memory)
  - `2000` (larger batches - better performance)

### `STREAMING_MAX_MEMORY_MB`

- **Default**: `100`
- **Description**: Memory threshold in MB before streaming activation
- **Examples**:
  - `50` (aggressive streaming)
  - `200` (allow larger in-memory result sets)

### `STREAMING_MAX_RESPONSE_SIZE`

- **Default**: `10485760` (10 MB)
- **Description**: Response size limit in bytes for automatic chunking
- **Examples**:
  - `1048576` (1 MB - smaller responses)
  - `52428800` (50 MB - larger responses)

## Logging and Debugging Settings

### `SQL_SERVER_DEBUG`

- **Default**: `false`
- **Description**: Enable enhanced debugging output
- **Values**:
  - `true` (enable debug logging)
  - `false` (standard logging)

### `SQL_SERVER_LOG_LEVEL`

- **Default**: `info`
- **Description**: Logging verbosity level
- **Values**:
  - `error` (only errors)
  - `warn` (warnings and errors)
  - `info` (general information)
  - `debug` (detailed debugging information)

### `ENABLE_SECURITY_AUDIT`

- **Default**: `false`
- **Description**: Enable security audit trail for sensitive operations
- **Values**:
  - `true` (enable security audit logging)
  - `false` (standard security logging)

### `SQL_SERVER_RESPONSE_FORMAT`

- **Default**: `json`
- **Description**: Default response format for query results
- **Values**:
  - `json` (JSON format)
  - `structured` (structured objects)
  - `pretty-json` (pretty-printed JSON)

## Secret Management Settings

### `SECRET_MANAGER_TYPE`

- **Default**: `env`
- **Description**: Secret provider to use for credential management
- **Values**:
  - `env` (environment variables)
  - `aws` (AWS Secrets Manager)
  - `azure` (Azure Key Vault)

### AWS Secrets Manager Settings

When `SECRET_MANAGER_TYPE=aws`:

#### `AWS_REGION`

- **Required**: Yes
- **Description**: AWS region for Secrets Manager
- **Examples**: `us-east-1`, `eu-west-1`, `ap-southeast-2`

### Azure Key Vault Settings

When `SECRET_MANAGER_TYPE=azure`:

#### `AZURE_KEY_VAULT_URL`

- **Required**: Yes
- **Description**: Azure Key Vault URL
- **Format**: `https://your-vault.vault.azure.net/`

## Security Configuration Examples

### 🔒 Maximum Security (Default - Production)

```bash
SQL_SERVER_READ_ONLY=true
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false
```

**Result**: Only SELECT queries allowed

### 📊 Data Analysis Mode

```bash
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false
```

**Result**: SELECT + INSERT/UPDATE/DELETE allowed, no schema changes

### 🛠️ Full Development Mode

```bash
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true
```

**Result**: All SQL operations allowed including CREATE/DROP/ALTER
**⚠️ Warning**: Only use this for development/testing environments!

## Environment Variable Precedence

Environment variables are processed in this order:

1. **Explicit environment variables** (highest priority)
2. **Configuration files** (if supported)
3. **Context-aware defaults** (for SSL certificates only)
4. **Built-in defaults** (lowest priority)

## Best Practices

### Development

- Use context-aware SSL defaults (don't set `SQL_SERVER_TRUST_CERT`)
- Enable appropriate security level for your needs
- Use `SQL_SERVER_DEBUG=true` for troubleshooting

### Testing

- Use dedicated test databases
- Consider `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true` for test data setup
- Enable performance monitoring to catch regressions

### Production

- **Always** explicitly set security variables
- Use `SQL_SERVER_TRUST_CERT=false` for maximum SSL security
- Consider AWS Secrets Manager or Azure Key Vault for credentials
- Monitor performance and adjust streaming settings based on usage

### Security

- Never hardcode credentials in configuration files
- Use strong, unique passwords
- Regularly rotate database credentials
- Audit security settings before production deployment
- Review logs for security events

## Troubleshooting

### Connection Issues

- Check `SQL_SERVER_HOST`, `SQL_SERVER_PORT`, and `SQL_SERVER_DATABASE`
- Verify credentials with `SQL_SERVER_USER` and `SQL_SERVER_PASSWORD`
- Try `SQL_SERVER_TRUST_CERT=true` for SSL certificate issues
- Increase `SQL_SERVER_CONNECT_TIMEOUT_MS` for slow networks

### Permission Issues

- Check security settings: `SQL_SERVER_READ_ONLY`, `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS`, `SQL_SERVER_ALLOW_SCHEMA_CHANGES`
- Review database user permissions
- Enable `SQL_SERVER_DEBUG=true` for detailed security logging

### Performance Issues

- Adjust `STREAMING_BATCH_SIZE` for large datasets
- Modify `SLOW_QUERY_THRESHOLD` to identify bottlenecks
- Review `SQL_SERVER_POOL_MAX` for connection pool sizing
- Check `SQL_SERVER_REQUEST_TIMEOUT_MS` for long-running queries

## Related Documentation

- **[.env.example](../.env.example)** - Example environment configuration file
- **[Security Guide](SECURITY.md)** - Comprehensive security configuration
- **[AWS Secrets Guide](AWS-SECRETS-GUIDE.md)** - AWS Secrets Manager setup
- **[Azure Secrets Guide](AZURE-SECRETS-GUIDE.md)** - Azure Key Vault setup
- **[Quick Start](QUICKSTART.md)** - Getting started guide
