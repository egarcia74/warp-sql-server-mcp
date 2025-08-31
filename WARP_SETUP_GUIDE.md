# 🚀 Warp MCP Setup Guide - Performance Monitoring Features

This guide will help you set up and use the new performance monitoring features (GitHub Issue #15) in Warp.

## Quick Setup

### 1. Configure Warp MCP Settings

Add the following configuration to your Warp MCP settings (in Warp's settings menu):

```json
{
  "mcpServers": {
    "sql-server": {
      "command": "node",
      "args": ["/Users/egarcia74/Source/Repos/GitHub/warp-sql-server-mcp/index.js"],
      "env": {
        "SQL_SERVER_HOST": "your_sql_server_host",
        "SQL_SERVER_PORT": "1433",
        "SQL_SERVER_DATABASE": "your_database",
        "SQL_SERVER_USER": "your_username",
        "SQL_SERVER_PASSWORD": "your_password",
        "SQL_SERVER_READ_ONLY": "true",
        "ENABLE_PERFORMANCE_MONITORING": "true",
        "SLOW_QUERY_THRESHOLD": "1000",
        "MAX_METRICS_HISTORY": "500",
        "TRACK_POOL_METRICS": "true"
      }
    }
  }
}
```

### 2. Test the Connection

In Warp, you should now see the MCP server available. Try these commands to test the new features:

## 🆕 NEW Performance Monitoring Tools

### 1. `get_performance_stats` - Overall Server Performance

Get comprehensive server performance statistics:

```bash
# Get all performance stats (default)
@sql-server get_performance_stats

# Get recent performance stats (last 5 minutes)
@sql-server get_performance_stats timeframe=recent

# Get session performance stats (since server startup)
@sql-server get_performance_stats timeframe=session
```

**What you'll see:**

- Server uptime
- Total queries executed
- Average query execution time
- Slow query count and threshold
- Error rates
- Memory usage trends

### 2. `get_query_performance` - Detailed Query Analysis

Analyze query performance by tool and identify bottlenecks:

```bash
# Get performance breakdown for last 50 queries
@sql-server get_query_performance

# Limit to 20 queries
@sql-server get_query_performance limit=20

# Filter by specific tool
@sql-server get_query_performance tool_filter=execute_query

# Only show slow queries
@sql-server get_query_performance slow_only=true

# Combined filters
@sql-server get_query_performance limit=30 tool_filter=get_table_data slow_only=true
```

**What you'll see:**

- Query execution times by MCP tool
- Performance statistics per tool (average time, error rate)
- Slow query identification
- Query success/failure status
- Row count and streaming information

### 3. `get_connection_health` - Connection Pool Monitoring

Monitor your SQL Server connection pool health:

```bash
# Get connection pool health
@sql-server get_connection_health
```

**What you'll see:**

- Active vs idle connections
- Connection pool utilization
- Health score (0-100)
- Connection errors and retry rates
- Pool capacity warnings

## 📊 Example Workflow

Here's a typical performance monitoring workflow in Warp:

```bash
# 1. First, run some queries to generate data
@sql-server execute_query query="SELECT GETDATE() as current_time"
@sql-server list_databases
@sql-server list_tables

# 2. Check overall performance
@sql-server get_performance_stats

# 3. Analyze query performance
@sql-server get_query_performance limit=10

# 4. Check connection health
@sql-server get_connection_health

# 5. Look for slow queries if performance seems degraded
@sql-server get_query_performance slow_only=true
```

## 🔧 Configuration Options

### Performance Monitoring Settings

- `ENABLE_PERFORMANCE_MONITORING`: Enable/disable monitoring (default: true)
- `SLOW_QUERY_THRESHOLD`: Milliseconds to consider a query "slow" (default: 1000)
- `MAX_METRICS_HISTORY`: Maximum number of metrics to keep in memory (default: 500)
- `PERFORMANCE_SAMPLING_RATE`: Fraction of queries to monitor (0.0-1.0, default: 1.0)
- `TRACK_POOL_METRICS`: Enable connection pool monitoring (default: true)

### Example Configurations

#### Production (Conservative)

```json
"ENABLE_PERFORMANCE_MONITORING": "true",
"SLOW_QUERY_THRESHOLD": "2000",
"MAX_METRICS_HISTORY": "1000",
"PERFORMANCE_SAMPLING_RATE": "0.1",
"TRACK_POOL_METRICS": "true"
```

#### Development (Detailed)

```json
"ENABLE_PERFORMANCE_MONITORING": "true",
"SLOW_QUERY_THRESHOLD": "500",
"MAX_METRICS_HISTORY": "100",
"PERFORMANCE_SAMPLING_RATE": "1.0",
"TRACK_POOL_METRICS": "true"
```

## 🎯 Key Benefits

1. **Real-time Performance Insights**: Monitor query performance as you work
2. **Bottleneck Identification**: Quickly identify slow-performing tools and queries
3. **Connection Health**: Ensure your SQL Server connections are healthy
4. **Historical Analysis**: Track performance trends over time
5. **Zero Configuration**: Works out of the box with sensible defaults

## 🚨 Troubleshooting

### Performance Monitoring Disabled

If you see "Performance monitoring is disabled", check:

- `ENABLE_PERFORMANCE_MONITORING` is set to "true"
- No environment variable conflicts
- Server restarted after configuration changes

### No Performance Data

If tools return empty results:

- Run some queries first to generate performance data
- Check that `PERFORMANCE_SAMPLING_RATE` is > 0
- Verify `MAX_METRICS_HISTORY` is sufficient

### Connection Issues

For connection pool problems:

- Check `TRACK_POOL_METRICS` is enabled
- Verify SQL Server connection is working
- Review pool configuration settings

## 📈 Advanced Usage

### Monitoring Query Patterns

```bash
# Monitor execute_query performance
@sql-server get_query_performance tool_filter=execute_query limit=20

# Check table operations performance
@sql-server get_query_performance tool_filter=get_table_data

# Find CSV export bottlenecks
@sql-server get_query_performance tool_filter=export_table_csv slow_only=true
```

### Health Check Workflow

```bash
# Quick health overview
@sql-server get_performance_stats timeframe=recent
@sql-server get_connection_health

# Detailed analysis if issues found
@sql-server get_query_performance slow_only=true
@sql-server get_performance_stats timeframe=all
```

---

🎉 **You're all set!** The new performance monitoring features are now ready to help you optimize your SQL Server workflows in Warp.

Need help? Check the logs or file an issue on GitHub.
