# MCP Protocol Tests

## Overview

This directory contains **MCP protocol-level tests** that validate the server through actual MCP
client-server communication over stdio. Rather than calling server methods directly, these tests
spawn `index.js` as a child process and speak JSON-RPC to it - exactly what a real MCP client (like
Warp or VS Code) does.

## 🔄 **Protocol Testing vs Integration Testing**

### **Protocol Tests** (This directory)

- **Client ↔ Server Communication**: Tests the MCP protocol stack end to end
- **Serialization/Deserialization**: Validates JSON-RPC message formatting
- **Real-World Simulation**: Exercises the same startup path Warp and VS Code use
- **Transport Layer**: Tests stdio transport communication
- **Single Configuration**: Runs in the default read-only security mode

### **Integration Tests** (`test/integration/manual/`)

- **Direct Method Calls**: Tests server methods directly
- **All Security Phases**: Tests all 3 security configurations
- **Configuration Testing**: Tests environment variable handling
- **Database Validation**: Live database connectivity and operations

**Both are valuable**: protocol tests validate the MCP communication layer, while integration tests
validate security phases and configuration management.

## 📁 **Test Files**

### **`mcp-server-startup-test.js`** - MCP Startup and Handshake Check

The only protocol test in this directory. It:

1. Spawns the MCP server (`index.js`) with `stdio: ['pipe', 'pipe', 'pipe']` in read-only mode
2. Writes a JSON-RPC `initialize` request to the server's stdin
3. Asserts a well-formed `initialize` result comes back on stdout
4. Completes the handshake with a `notifications/initialized` notification
5. Terminates the server with `SIGTERM` and asserts a clean shutdown

It is a single pass/fail script, not a counted suite, so it does not contribute to the repository's
1,167-test total.

> **A note for anyone adding a test here.** This test deliberately does **not** set `NODE_ENV=test`
> when it spawns the server - see the comment at the top of the spawn options. `index.js` guards its
> startup banner behind `process.env.NODE_ENV !== 'test'`, so under `NODE_ENV=test` the server emits
> no readiness output at all. A previous test in this directory (`mcp-client-smoke-test.js`) set
> `NODE_ENV=test` and then waited on the child's stderr for that banner; it could never pass and was
> removed. If you gate on server output, do not set `NODE_ENV=test`, and remember that
> `lib/utils/logger.js` only routes log output to stderr when it detects VS Code
> (`VSCODE_MCP` / `VSCODE_PID` / `VSCODE_IPC_HOOK`) - otherwise it goes to stdout. Gating on the
> JSON-RPC response, as this test does, avoids the problem entirely.

## 🚀 **Running Protocol Tests**

### **Quick Start**

```bash
# What CI runs, as part of `npm test`. Expects a SQL Server already running.
npm run test:integration:protocol

# The same file, but the runner starts and seeds the Docker container for you first.
# Note the explicit `-- protocol`: a bare `npm run docker:test` defaults to `phase1`.
npm run docker:test -- protocol
```

### **Manual Execution**

```bash
# Direct execution (set MCP_TESTING_MODE=docker to load test/docker/.env.docker)
MCP_TESTING_MODE=docker node test/protocol/mcp-server-startup-test.js
```

## Prerequisites

### 🗄️ **Database Requirements**

- **SQL Server Instance**: Running and accessible
- **Test Database**: `WarpMcpTest` with sample data (`npm run docker:start:init` creates it)
- **Default Configuration**: Server should be in read-only mode (default)

### 🔧 **Environment Setup**

- **Valid `.env`** file with SQL Server connection details
- **SSL Certificate**: Configured if encryption is enabled
- **MCP Dependencies**: `@modelcontextprotocol/sdk` installed

## Test Output

### ✅ **Successful Output Example**

```bash
🚀 Starting MCP Server Startup Test
===================================

🔗 Starting MCP server process...
Sending initialize message to server...
✅ Received valid initialize response
🔄 Sent initialized notification

🎯 MCP SERVER STARTUP TEST RESULTS
=================================
✅ Server Startup & MCP Protocol: PASSED

🏆 MCP server startup test: PASSED
   ✅ Server starts successfully
   ✅ Responds to MCP initialize protocol
   ✅ Handles JSON-RPC communication correctly
```

Set `VERBOSE=1` or `DEBUG=1` to print the full `initialize` response JSON.

### ❌ **Failure Analysis**

The test exits non-zero and prints the reason:

```bash
💥 Startup test failed: Server startup timed out after 10 seconds
```

## What This Tests

### 🔄 **MCP Protocol Communication**

- **Message Serialization**: JSON-RPC message formatting
- **Transport Layer**: stdio transport communication
- **Handshake**: `initialize` request/response and `notifications/initialized`
- **Lifecycle**: Clean startup and `SIGTERM` shutdown

### 🔒 **Security Configuration**

The server is spawned with `SQL_SERVER_READ_ONLY=true`,
`SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false`, and `SQL_SERVER_ALLOW_SCHEMA_CHANGES=false`, so the
handshake is validated in the default, most restrictive security mode. Per-tool security boundary
enforcement is covered by the live-database phase tests in `test/integration/manual/`.

## Troubleshooting

### 🔍 **Common Issues**

#### **Startup Timeout**

```bash
💥 Startup test failed: Server startup timed out after 10 seconds
```

**Solutions:**

- Verify SQL Server is running and `npm run docker:start:init` has seeded it
- Check `.env` file configuration
- Do not set `NODE_ENV=test` - it suppresses the server's startup output
- Run `node index.js` by hand and confirm it starts

#### **Connection Failures**

```bash
❌ Connection failed: ECONNREFUSED
```

**Solutions:**

- Verify SQL Server is running
- Check `.env` file configuration
- Validate network connectivity

#### **MCP Protocol Errors**

```bash
❌ MCP error -32603: Tool execution failed
```

**Solutions:**

- Check MCP server logs for detailed errors
- Verify tool parameters match expected schema
- Ensure database permissions are correct

### 🐛 **Debug Mode**

The protocol test inherits debug settings from the MCP server. Enable detailed logging:

```bash
SQL_SERVER_DEBUG=true node test/protocol/mcp-server-startup-test.js
```

## 📊 **Comparison: Test Types**

| Test Type                      | Location                                   | Purpose                      | Database | Count             | CI/CD                            |
| ------------------------------ | ------------------------------------------ | ---------------------------- | -------- | ----------------- | -------------------------------- |
| **Unit Tests**                 | `test/unit/`                               | Code logic validation        | Mocked   | 1,100             | ✅ Required `Tests` job          |
| **Integration Tests (Vitest)** | `test/integration/`                        | Component integration        | Mocked   | 27                | ✅ `coverage` job                |
| **Live-Database Tests**        | `test/integration/manual/`                 | Security phase validation    | Live DB  | 40                | ✅ Required `Tests` job (Docker) |
| **Protocol Startup Check**     | `test/protocol/mcp-server-startup-test.js` | Startup + JSON-RPC handshake | Live DB  | 1 pass/fail check | ✅ Required `Tests` job          |

> Every suite in this repository runs in CI. `npm run test:integration:protocol` and
> `npm run docker:test -- protocol` run the same file; the runner variant just starts and seeds the
> Docker container for you first.

## 🎯 **When to Use Protocol Tests**

### **Use Protocol Tests When:**

- ✅ Validating MCP client-server communication
- ✅ Testing MCP message serialization/deserialization
- ✅ Simulating real Warp or VS Code integration scenarios
- ✅ Verifying the server starts and completes the MCP handshake
- ✅ Verifying MCP protocol compliance

### **Use Integration Tests When:**

- ✅ Testing all three security phases
- ✅ Validating configuration management
- ✅ Testing environment variable handling
- ✅ Comprehensive security boundary validation
- ✅ Production deployment validation

## 🔧 **Maintenance**

### **Updating Protocol Tests**

When changing the MCP handshake or transport layer:

1. **Update `mcp-server-startup-test.js`** to cover the new behaviour
2. **Update this README** if the output or invocation changes
3. **Run `npm run docker:test -- protocol`** against a seeded container
4. **Confirm `npm test` still passes**, since CI runs this file through that chain

Per-tool coverage belongs in `test/unit/` (mocked) or `test/integration/manual/` (live database),
not here.

### **Test Dependencies**

The protocol test depends on:

- Live SQL Server database
- Proper MCP server configuration
- Valid environment setup

---

## 🎯 **Summary**

The **MCP server startup test** provides essential validation of the MCP communication layer,
ensuring that the server correctly implements the MCP protocol handshake and can communicate with
real MCP clients like Warp and VS Code.

**This test complements our comprehensive testing suite** by validating a different layer of the
system - the MCP protocol interface that actual clients will use.
