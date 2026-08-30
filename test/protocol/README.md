# MCP Protocol Tests

## Overview

This directory contains **MCP protocol-level tests** that validate the server through actual MCP client-server communication.
These tests simulate exactly what a real MCP client (like Warp) would experience when interacting with the server.

## 🔄 **Protocol Testing vs Integration Testing**

### **Protocol Tests** (This directory)

- **Client ↔ Server Communication**: Tests the full MCP protocol stack
- **Serialization/Deserialization**: Validates MCP message formatting
- **Real-World Simulation**: Exactly what Warp experiences
- **Transport Layer**: Tests stdio transport communication
- **Single Configuration**: Tests default read-only security mode

### **Integration Tests** (`test/integration/manual/`)

- **Direct Method Calls**: Tests server methods directly
- **All Security Phases**: Tests all 3 security configurations
- **Configuration Testing**: Tests environment variable handling
- **Database Validation**: Live database connectivity and operations

**Both are valuable**: Protocol tests validate the MCP communication layer, while integration tests validate security phases and configuration management.

## 📁 **Test Files**

### **`mcp-client-smoke-test.js`** - MCP Protocol Smoke Test

**Tests**: 20 comprehensive tests covering:

1. **Basic Connectivity** (2 tests): Database listing, table listing
2. **Core Schema Operations** (2 tests): Table descriptions, foreign keys
3. **Data Retrieval** (2 tests): Table data, CSV export
4. **Query Execution** (2 tests): SELECT queries, execution plans
5. **Performance Monitoring** (3 tests): Performance stats, query performance, connection health
6. **Query Optimization** (4 tests): Index recommendations, query analysis, bottleneck detection, optimization insights
7. **Security Boundary Testing** (5 tests): INSERT/UPDATE/DELETE/DDL blocking + SELECT allowed

### **`mcp-server-startup-test.js`** - MCP Startup and Handshake Check

A lighter check that launches the server over stdio and validates the JSON-RPC initialize
handshake. This is what `npm run test:integration:protocol` runs, and it is part of the
`npm test` chain that CI's required `Tests` job executes.

## 🚀 **Running Protocol Tests**

### **Quick Start**

```bash
# Run the 20-test MCP client smoke test (starts Docker SQL Server for you)
npm run docker:test -- protocol

# Run the lighter startup/handshake check (this is the one CI runs)
npm run test:integration:protocol
```

### **Manual Execution**

```bash
# Direct execution
node test/protocol/mcp-client-smoke-test.js
```

## Prerequisites

### 🗄️ **Database Requirements**

- **SQL Server Instance**: Running and accessible
- **Test Database**: `WarpMcpTest` with sample data
- **Default Configuration**: Server should be in read-only mode (default)

### 🔧 **Environment Setup**

- **Valid `.env`** file with SQL Server connection details
- **SSL Certificate**: Configured if encryption is enabled
- **MCP Dependencies**: `@modelcontextprotocol/sdk` installed

## Test Output

### ✅ **Successful Output Example**

```bash
🚀 Starting MCP Protocol Smoke Test
================================

✅ Connected to MCP server

📋 1. BASIC CONNECTIVITY AND DATABASE OPERATIONS
=================================================

🧪 Testing: List all user databases
✅ PASSED: list_databases

🧪 Testing: List tables in WarpMcpTest database
✅ PASSED: list_tables

... [18 more tests] ...

🎯 SMOKE TEST RESULTS SUMMARY
=============================
✅ Tests Passed: 20
❌ Tests Failed: 0
📊 Total Tests: 20
📈 Success Rate: 100.0%

🏆 Production Readiness Assessment:
   ✅ FULLY PRODUCTION READY - All tests passed!
```

### ❌ **Failure Analysis**

When tests fail, detailed error information is provided:

```bash
❌ FAILED: execute_query_select - Connection failed: ECONNREFUSED
```

## What This Tests

### 🔄 **MCP Protocol Communication**

- **Message Serialization**: JSON-RPC message formatting
- **Transport Layer**: stdio transport communication
- **Error Handling**: MCP error response formatting
- **Tool Discovery**: `list_tools` protocol implementation

### 🛠️ **All 15 MCP Tools**

- **Database Operations**: All database interaction tools
- **Performance Monitoring**: All performance tracking tools
- **Query Optimization**: All optimization analysis tools

### 🔒 **Security Boundary Validation**

- **Read-Only Enforcement**: Verifies write operations are blocked
- **Error Responses**: Proper security error messages
- **SELECT Operations**: Ensures read operations still work

## Troubleshooting

### 🔍 **Common Issues**

#### **Connection Failures**

```bash
❌ Connection failed: ECONNREFUSED
```

**Solutions:**

- Verify SQL Server is running
- Check `.env` file configuration
- Ensure MCP server can start successfully
- Validate network connectivity

#### **MCP Protocol Errors**

```bash
❌ MCP error -32603: Tool execution failed
```

**Solutions:**

- Check MCP server logs for detailed errors
- Verify tool parameters match expected schema
- Ensure database permissions are correct

#### **Security Test Failures**

```bash
❌ INSERT was NOT blocked - security failure!
```

**Solutions:**

- Verify server is in read-only mode (default)
- Check security configuration in environment
- Ensure server is using default secure settings

### 🐛 **Debug Mode**

The protocol test inherits debug settings from the MCP server. Enable detailed logging:

```bash
SQL_SERVER_DEBUG=true node test/protocol/mcp-client-smoke-test.js
```

## 📊 **Comparison: Test Types**

| Test Type                      | Location                                   | Purpose                      | Database | Count             | CI/CD                            |
| ------------------------------ | ------------------------------------------ | ---------------------------- | -------- | ----------------- | -------------------------------- |
| **Unit Tests**                 | `test/unit/`                               | Code logic validation        | Mocked   | 1,100             | ✅ Required `Tests` job          |
| **Integration Tests (Vitest)** | `test/integration/`                        | Component integration        | Mocked   | 27                | ✅ `coverage` job                |
| **Live-Database Tests**        | `test/integration/manual/`                 | Security phase validation    | Live DB  | 40                | ✅ Required `Tests` job (Docker) |
| **Protocol Startup Check**     | `test/protocol/mcp-server-startup-test.js` | Startup + JSON-RPC handshake | Live DB  | 1 pass/fail check | ✅ Required `Tests` job          |
| **Protocol Smoke Test**        | `test/protocol/mcp-client-smoke-test.js`   | MCP communication validation | Live DB  | 20                | ❌ On demand only                |

> **Do not conflate the two protocol files.** `npm run test:integration:protocol` runs
> `mcp-server-startup-test.js` and _does_ run in CI (as part of `npm test`).
> `mcp-client-smoke-test.js` - the 20-test round trip documented here - is invoked only by
> `npm run docker:test`, which no workflow calls. It is the single suite no CI job runs.

## 🎯 **When to Use Protocol Tests**

### **Use Protocol Tests When:**

- ✅ Validating MCP client-server communication
- ✅ Testing MCP message serialization/deserialization
- ✅ Simulating real Warp integration scenarios
- ✅ Quick smoke test of all MCP tools
- ✅ Verifying MCP protocol compliance

### **Use Integration Tests When:**

- ✅ Testing all three security phases
- ✅ Validating configuration management
- ✅ Testing environment variable handling
- ✅ Comprehensive security boundary validation
- ✅ Production deployment validation

## 🔧 **Maintenance**

### **Updating Protocol Tests**

When adding new MCP tools:

1. **Add test case** to `mcp-client-smoke-test.js`
2. **Update test count** in this README
3. **Test manually** to ensure functionality
4. **Update documentation** as needed

### **Test Dependencies**

The protocol test depends on:

- `@modelcontextprotocol/sdk` - MCP client SDK
- Live SQL Server database
- Proper MCP server configuration
- Valid environment setup

---

## 🎯 **Summary**

The **MCP Protocol Smoke Test** provides essential validation of the MCP communication layer,
ensuring that the server correctly implements the MCP protocol and can communicate with real MCP clients like Warp.

**This test complements our comprehensive testing suite** by validating a different layer of the system - the MCP protocol interface that actual clients will use.
