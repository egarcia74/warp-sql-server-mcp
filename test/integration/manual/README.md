# Manual Integration Tests

## Overview

This directory contains **manual integration tests** that validate the MCP server's three-phase security system
against a **live SQL Server database**. These tests are **excluded from automated CI/CD pipelines**
and must be run manually for production validation.

## 🚨 **Important: Manual Testing Only**

These tests are **intentionally excluded** from:

- ✅ `npm test` (unit tests only)
- ✅ `npm run precommit`
- ✅ `npm run prepush`
- ✅ CI/CD workflows
- ✅ Automated testing pipelines

**Why Manual?** These tests require:

- Live SQL Server database connection
- Specific environment configuration
- Manual security validation
- Production-like setup verification

## Test Structure

### 📁 **Test Files**

| File                               | Phase          | Description                           | Tests    |
| ---------------------------------- | -------------- | ------------------------------------- | -------- |
| `phase1-readonly-security.test.js` | 🔒 **Phase 1** | Maximum Security (Read-Only)          | 20 tests |
| `phase2-dml-operations.test.js`    | ⚠️ **Phase 2** | DML Operations (INSERT/UPDATE/DELETE) | 10 tests |
| `phase3-ddl-operations.test.js`    | 🛠️ **Phase 3** | DDL Operations (CREATE/ALTER/DROP)    | 10 tests |

#### Total: 40 comprehensive integration tests

### 🔒 **Security Phase Validation**

#### **Phase 1: Maximum Security (Default)**

- Validates read-only mode enforcement
- Tests that all write operations are blocked
- Verifies SELECT queries work correctly
- Ensures DDL and DML operations are rejected

#### **Phase 2: DML Operations Allowed**

- Validates selective write permissions
- Tests INSERT, UPDATE, DELETE operations
- Ensures DDL operations still blocked
- Verifies data persistence and cleanup

#### **Phase 3: Full Development Mode**

- Validates complete database access
- Tests CREATE, ALTER, DROP operations
- Verifies all DML operations work
- Ensures proper cleanup and rollback

## Prerequisites

### 🗄️ **Database Requirements**

1. **SQL Server Instance**: Running and accessible
2. **Test Database**: `WarpMcpTest` (created automatically if missing)
3. **Sample Data**: Northwind-style test data (Products, Categories tables)
4. **User Permissions**:
   - **Phase 1**: SELECT permissions
   - **Phase 2**: SELECT, INSERT, UPDATE, DELETE permissions
   - **Phase 3**: Full database permissions (DDL)

### 🔧 **Environment Setup**

1. **SSL Certificate**: Must be configured for `SQL_SERVER_TRUST_CERT=true`
2. **Connection Settings**: Valid credentials in `.env` file
3. **Network Access**: SQL Server accessible on configured host/port

## Running Tests

### 🚀 **Quick Start**

```bash
# Run all three phases sequentially
npm run test:integration:manual

# Note: Individual phases are now run together within the above command
# Phase 1: Read-only security tests
# Phase 2: DML operations tests
# Phase 3: DDL operations tests
```

### 📋 **Manual Execution**

```bash
# Phase 1: Read-Only Security (20 tests)
node test/integration/manual/phase1-readonly-security.test.js

# Phase 2: DML Operations (10 tests)
node test/integration/manual/phase2-dml-operations.test.js

# Phase 3: DDL Operations (10 tests)
node test/integration/manual/phase3-ddl-operations.test.js
```

## Test Output

### ✅ **Successful Output Example**

```bash
🚀 Starting Phase 1: Direct MCP Server Test (Read-Only Mode)
========================================================

🔧 Environment Variables Set:
   SQL_SERVER_READ_ONLY: true
   SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: false
   SQL_SERVER_ALLOW_SCHEMA_CHANGES: false

🔍 Server Configuration Loaded:
   readOnlyMode: true
   allowDestructiveOperations: false
   allowSchemaChanges: false

📊 1. DATABASE CONNECTIVITY AND BASIC OPERATIONS
===============================================

🧪 Testing: Database connection should work
✅ PASSED: connection_test

🧪 Testing: List databases should work
✅ PASSED: list_databases

... [18 more tests] ...

🎯 PHASE 1: DIRECT MCP SERVER TEST SUMMARY
========================================
✅ Tests Passed: 20
❌ Tests Failed: 0
📊 Total Tests: 20
📈 Success Rate: 100.0%

🏆 Phase 1 Assessment:
   ✅ PHASE 1 COMPLETE - Maximum security validated!
```

### ❌ **Failure Analysis**

When tests fail, detailed error information is provided:

```bash
❌ FAILED: insert_blocked_test - Query blocked by safety policy: Read-only mode is enabled. Only SELECT queries are allowed.
```

## Test Configuration

### 🔧 **Environment Variables**

Each test phase automatically configures the required environment variables:

**Phase 1 (Read-Only):**

```bash
SQL_SERVER_READ_ONLY=true
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false
```

**Phase 2 (DML Allowed):**

```bash
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false
```

**Phase 3 (Full Access):**

```bash
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true
```

### 🔄 **Configuration Reloading**

Each test automatically:

1. Sets the required environment variables
2. Calls `serverConfig.reload()` to refresh configuration
3. Verifies the configuration was loaded correctly
4. Creates a fresh MCP server instance with new settings

## Troubleshooting

### 🔍 **Common Issues**

#### **Connection Failures**

```bash
❌ Failed to connect to SQL Server after 3 attempts
```

**Solutions:**

- Verify SQL Server is running
- Check `.env` file configuration
- Ensure SSL certificate trust settings
- Validate network connectivity

#### **Permission Errors**

```bash
❌ Permission denied for operation
```

**Solutions:**

- Verify database user permissions
- Check security phase requirements
- Ensure test database exists
- Validate user access to required objects

#### **Configuration Issues**

```bash
❌ Configuration not loaded correctly
```

**Solutions:**

- Verify `.env` file exists and is readable
- Check environment variable precedence
- Ensure `serverConfig.reload()` is working
- Validate configuration object structure

### 🐛 **Debug Mode**

Enable detailed logging by setting:

```bash
SQL_SERVER_DEBUG=true
```

## Production Validation

### ✅ **Validation Checklist**

Before deploying to production, ensure:

- [ ] **Phase 1**: 20/20 tests pass (Maximum security)
- [ ] **Phase 2**: 10/10 tests pass (Selective permissions)
- [ ] **Phase 3**: 10/10 tests pass (Full development mode)
- [ ] **SSL/TLS**: Certificate validation works correctly
- [ ] **Configuration**: Environment variables load properly
- [ ] **Security**: Boundaries enforced across all phases
- [ ] **Performance**: Query execution within acceptable limits
- [ ] **Cleanup**: Test data properly removed after execution

### 🏥 **Production Readiness**

A **100% success rate** across all 40 tests indicates:

- ✅ **Security system is bulletproof**
- ✅ **Database connectivity is stable**
- ✅ **Configuration management is robust**
- ✅ **Error handling is comprehensive**
- ✅ **Performance monitoring is functional**
- ✅ **Production deployment is safe**

## Maintenance

### 🔄 **Updating Tests**

When adding new MCP tools or security features:

1. **Add test cases** to the appropriate phase file
2. **Update test counts** in this README
3. **Verify exclusion** from automated test runs
4. **Test manually** to ensure functionality
5. **Update documentation** as needed

### 📊 **Test Metrics**

Current test coverage:

- **Database Operations**: All 15 MCP tools tested
- **Security Boundaries**: All three phases validated
- **Error Scenarios**: Connection, permission, validation errors
- **Configuration**: Environment variables, SSL/TLS, authentication
- **Performance**: Query execution and monitoring

---

## 🎯 **Summary**

These manual integration tests provide **comprehensive validation** of the MCP server's security system
and production readiness. The **40-test suite** ensures that all three security phases work correctly
and that the system is ready for enterprise deployment.

**Run these tests before any production deployment** to validate security boundaries and system functionality.
