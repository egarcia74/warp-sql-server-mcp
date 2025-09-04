# Debug Logging and Log Analysis

This document describes the logging features and debugging tools available in the Warp SQL Server MCP.

## Configuration Summary

The MCP server provides a comprehensive configuration summary at startup with emoji indicators:

- 🌐 **Connection Settings**: Host, port, database, authentication type
- 🔒 **Security & Operation Settings**: Password masking, security levels, permissions
- ⚡ **Performance Monitoring**: Query tracking and optimization features
- 📊 **Streaming Configuration**: Large dataset handling settings
- 📝 **Logging & Output**: Log levels and output formatting

### Password Security

For security, the `SQL_SERVER_PASSWORD` is fully masked in logs:

- Shows `***********` (fixed-length masking) when a password is configured
- Shows `<not set>` when using Windows Authentication or no password
- Usernames are shown in cleartext for configuration verification

## Debug Mode

Enable debug mode for enhanced logging:

```bash
export SQL_SERVER_DEBUG=true
```

This enables:

- Enhanced error logging and stack traces
- Additional debug information in tool responses
- More verbose connection and query logging

## Server Information and Diagnostics

### get_server_info MCP Tool

The server includes a comprehensive diagnostics tool accessible through the MCP interface:

```json
// MCP tool call
{
  "name": "get_server_info",
  "arguments": {
    "include_logs": true // Optional: include logging context
  }
}
```

This tool provides:

- **Server Status**: Real-time information (name, version, uptime, platform, Node.js version)
- **Configuration Overview**: Complete configuration summary including connection, security, performance, and logging settings
- **Security Level Display**: Human-readable security levels ("MAXIMUM (Read-Only)", "MEDIUM (DML Allowed)", "MINIMAL (Full Access)")
- **Runtime Statistics**: Performance metrics, connection health, memory usage, and process information
- **Optional Log Context**: Recent logging information when requested

**Perfect for:**

- Troubleshooting configuration issues
- Verifying server health and performance
- Understanding current security settings
- Debugging MCP connectivity problems

## Log Analysis Tools

### Pretty-Print MCP Logs Script

The repository includes a script to tail and pretty-print MCP logs with formatted JSON:

```bash
# Run the log pretty-printer
./scripts/pretty-logs.sh
```

This script:

- Monitors your MCP log file in real-time
- Automatically detects JSON content in log lines
- Pretty-prints JSON using `jq` (if available) or Python
- Preserves timestamp and log level information
- Shows non-JSON log lines as-is

**Requirements:**

- `jq` (preferred) or Python 3 for JSON formatting
- Read access to your Warp MCP log file

### Manual Log Analysis

You can also manually analyze logs using standard tools:

```bash
# View recent logs
tail -f "/Users/$USER/Library/Application Support/dev.warp.Warp-Stable/mcp/[YOUR_MCP_ID].log"

# Extract and pretty-print JSON responses
grep "Received response" your-mcp.log | sed 's/.*{"result":/{"result":/' | jq .

# Filter for errors only
grep -E "(error|ERROR|Error)" your-mcp.log
```

## Log Locations

MCP logs are typically stored at:

- **macOS**: `~/Library/Application Support/dev.warp.Warp-Stable/mcp/[MCP_ID].log`
- **Windows**: `%APPDATA%\dev.warp.Warp-Stable\mcp\[MCP_ID].log`
- **Linux**: `~/.local/share/dev.warp.Warp-Stable/mcp/[MCP_ID].log`

## Understanding Log Messages

### Startup Sequence

1. `Starting Warp SQL Server MCP server...`
2. Connection attempts with retry logic
3. Configuration summary display
4. `Warp SQL Server MCP server running on stdio`

### Connection Issues

Look for:

- `Connection attempt X failed:` - Individual retry failures
- `Failed to connect to SQL Server after X attempts:` - Complete failure
- Connection troubleshooting suggestions in configuration summary

### Tool Execution

- MCP protocol messages show JSON-RPC requests/responses
- SQL query execution results (formatted as JSON)
- Safety policy violations and error messages

### Security Warnings

- `WARNING: Read-write mode, DML allowed, DDL allowed` - Unsafe configuration
- `Overall Security Level: ❌ UNSAFE` - Review security settings
- Recommendations for production-safe configuration

## Troubleshooting Tips

1. **Enable Debug Mode** first for more detailed logs
2. **Check Connection Settings** in the configuration summary
3. **Verify Credentials** - look for authentication errors
4. **Review Security Warnings** - ensure appropriate safety settings
5. **Monitor Tool Execution** - check for query validation failures

## Example Log Analysis Workflow

```bash
# 1. Enable debug mode
export SQL_SERVER_DEBUG=true

# 2. Restart your MCP server (in Warp)
# 3. Monitor logs with pretty-printing
./scripts/pretty-logs.sh

# 4. Look for specific patterns
grep "Security:" your-mcp.log
grep "Connection attempt" your-mcp.log
```
