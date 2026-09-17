# Debug Logging and Log Analysis

> **Audience**: Anyone diagnosing server behaviour from its logs

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

MCP tool call:

```json
{
  "name": "get_server_info",
  "arguments": {
    "include_logs": true
  }
}
```

`include_logs` is optional and defaults to `false`; set it to `true` to include logging
context in the response.

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

> **⚠️ File logging is opt-in - by default there are no log files to read.** `index.js`
> passes a file path to `Logger` **only** when the corresponding environment variable is
> set, so without them the console transport is the only record and your MCP client's log
> capture is where it ends up. The log viewer commands below have nothing to show until
> you set at least one of:
>
> ```bash
> # Main server log
> LOG_FILE=./logs/server.log
>
> # Security audit log (also needs ENABLE_SECURITY_AUDIT=true to emit audit events)
> SECURITY_LOG_FILE=./logs/security-audit.log
> ENABLE_SECURITY_AUDIT=true
> ```
>
> `npm run logs` defaults to `./logs/server.log`, so setting `LOG_FILE` to that path makes
> the viewer work out of the box. Run `get_server_info` to confirm: the
> `configuration.logging.logFile` field reads `Not configured (console only)` until a path
> is set.
>
> **All console output goes to stderr, unconditionally.** stdout is the JSON-RPC protocol
> channel, so `Logger` sets Winston's `stderrLevels` to every level
> (`error`, `warn`, `info`, `debug`, `verbose`, `silly`) on **both** console transports, the
> main logger's and the security audit's. An unset `stderrLevels` maps no level to stderr
> (`winston/lib/winston/transports/console.js:85-87`), which is why the list is exhaustive
> rather than a subset.
>
> **There is nothing to configure and nothing to detect.** `StdioServerTransport` is the only
> transport `index.js` imports or constructs, and `Logger` is constructed nowhere else, so
> stdout is the protocol channel every time this code runs. `index.js` swallows dotenv's
> banner and `cli.js` prints its `start` banners on stderr for the same reason - `start`
> spawns the server with `stdio: 'inherit'`, handing it the very descriptor it just wrote to.
> A terminal shows stderr, so a human running the server directly still sees everything.
>
> **This was not always so.** The routing used to be decided by _detecting_ the client, and
> the detection could be wrong in both directions: the logger read only the three VS Code
> variables, so under Warp - or any stdio client that sets none of them - every level fell
> through to `console._stdout.write` and interleaved with the protocol (#1256); then
> `MCP_TRANSPORT=stdio` was honoured by the startup banners but not by the logger (#1259). The
> audit transport was worse still: it set no `stderrLevels` at all, so with
> `ENABLE_SECURITY_AUDIT=true` its lines reached stdout even under VS Code, where the main
> logger was correctly routed. #1260 deleted the question rather than improving the answer, so
> a client can no longer get this wrong by omission. `MCP_TRANSPORT`, `VSCODE_MCP` and
> `PARENT_PROCESS` are read nowhere now; setting them is a harmless no-op.
>
> **Setting `LOG_FILE` still does not redirect anything.** `createLogger()` pushes the
> console transport whenever `NODE_ENV !== "test"` and only _then_ adds the file transport if
> a path is set; `createSecurityLogger()` does the same. A log file **duplicates** output to
> disk. Set it for a readable record, not as a containment measure - containment is the
> unconditional stderr routing's job.

### Smart Log Viewer (Recommended)

The repository includes a comprehensive smart log viewer with automatic path detection:

```bash
# Show all available commands
npm run help

# View recent server logs
npm run logs

# Follow logs in real-time
npm run logs:tail

# View security audit logs
npm run logs:audit

# Follow audit logs in real-time
npm run logs:tail:audit

# Direct script usage
./scripts/show-logs.sh --help
```

**Features:**

- 🎯 **Smart path detection** (development vs production)
- 📁 **Custom file path support** (--file or --path)
- 📄 **Clean JSON formatting** with proper indentation
- 🎨 **Color-coded log levels** and timestamps
- ⚡ **Real-time log following** with `--follow` mode
- 📊 **Multiple log types** (server and security audit)
- 🔍 **Automatic log file discovery**

**Custom File Path Support:**

```bash
# View logs from any file path
npm run logs -- --file /path/to/custom.log

# Follow logs from a custom location
npm run logs -- --file ~/my-logs/server.log --follow

# Direct script usage
./scripts/show-logs.sh --path /var/log/my-app/server.log
```

This is especially useful for:

- Viewing logs in non-standard locations
- Examining archived log files
- Debugging when log paths are customized
- Analyzing logs from different environments

**Smart Path Detection:**

These are the paths `show-logs.sh` _looks in_ when you do not pass `--file`. They are not
paths the server writes to on its own - point `LOG_FILE` / `SECURITY_LOG_FILE` at one of
them (or anywhere else) to actually produce a file there.

- **Development**: `./logs/server.log`, `./logs/security-audit.log`
- **Production**: `~/.local/state/warp-sql-server-mcp/server.log`, `~/.local/state/warp-sql-server-mcp/security-audit.log`
- **Windows**: `%LOCALAPPDATA%/warp-sql-server-mcp/server.log`

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

1. **Get comprehensive help**: `npm run help` - See all available commands
2. **View recent activity**: `npm run logs` - Check recent server logs
3. **Monitor in real-time**: `npm run logs:tail` - Follow logs as issues occur
4. **Check security events**: `npm run logs:audit` - Review security audit logs
5. **Enable Debug Mode**: Set `SQL_SERVER_DEBUG=true` for detailed logs
6. **Check Connection Settings** in the configuration summary
7. **Verify Credentials** - look for authentication errors in logs
8. **Review Security Warnings** - ensure appropriate safety settings

## Example Log Analysis Workflow

```bash
# 1. Get help and see all available commands
npm run help

# 2. Enable debug mode (if needed)
export SQL_SERVER_DEBUG=true

# 3. Check recent server activity
npm run logs

# 4. Monitor logs in real-time for troubleshooting
npm run logs:tail

# 5. Check security audit logs if needed
npm run logs:audit

# 6. Follow audit logs in real-time
npm run logs:tail:audit

# 7. Use compact mode for quick overview
./scripts/show-logs.sh --compact

# 8. Get detailed help for the log viewer
./scripts/show-logs.sh --help
```

### Quick Debugging Commands

```bash
# View logs with different options
npm run logs                    # Recent server logs (last 50 entries)
npm run logs -- --all           # All server log entries
npm run logs -- --compact       # Compact format without JSON details
npm run logs:tail               # Follow server logs in real-time
npm run logs:audit -- --all     # All security audit entries

# Use custom file paths
npm run logs -- --file /path/to/custom.log
npm run logs -- --file ~/archived-logs/server-2025-01-01.log --all
npm run logs -- --path /var/log/app/server.log --follow
```
