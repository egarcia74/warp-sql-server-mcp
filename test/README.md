# Test Directory

This directory contains all test-related files organized by type and purpose.

## Directory Structure

```text
test/
├── README.md                           # This file - test documentation
├── setup.js                            # Global test setup and mocks
├── TEST_IMPROVEMENTS.md                # Test improvement tracking
│
├── unit/                               # Unit tests (fast, mocked dependencies)
│   ├── sqlserver-mcp.test.js          # Original monolithic test suite (127 tests)
│   ├── mcp-connection.test.js         # Database connection tests (4 tests)
│   ├── mcp-security.test.js           # Safety mechanisms tests (38 tests)
│   ├── mcp-core-tools.test.js         # Core SQL tools tests (12 tests)
│   ├── mcp-data-tools.test.js         # Data manipulation tools tests (36 tests)
│   ├── mcp-performance-tools.test.js  # Performance monitoring tests (22 tests)
│   ├── mcp-server-lifecycle.test.js   # Server lifecycle tests (15 tests)
│   ├── query-validator-simple.test.js # Query validator unit tests
│   ├── logger.test.js                 # Logger utility tests
│   ├── performance-monitor.test.js    # Performance monitor tests
│   ├── response-formatter.test.js     # Response formatting tests
│   ├── secret-manager.test.js         # Secret management tests
│   ├── streaming-handler.test.js      # Streaming handler tests
│   ├── mcp-shared-fixtures.js         # Shared test fixtures and utilities
│   └── fixtures/                      # Test fixtures and sample data
│
├── integration/                       # Integration tests (real services)
│   ├── test-aws-secrets.js           # AWS Secrets Manager integration test
│   ├── test-azure-secrets.js         # Azure Key Vault integration test
│   └── manual/                        # Manual integration tests with live DB
│       ├── README.md                  # Manual testing documentation
│       ├── phase1-readonly-security.test.js   # Phase 1: Read-only security tests
│       ├── phase2-dml-operations.test.js      # Phase 2: DML operations tests
│       └── phase3-ddl-operations.test.js      # Phase 3: DDL operations tests
│
├── protocol/                          # MCP protocol-level tests
│   ├── README.md                      # Protocol testing documentation
│   ├── mcp-client-smoke-test.js      # Basic MCP client communication test
│   └── mcp-protocol-validation.test.js # Protocol validation tests
│
├── docker/                            # Docker-based testing infrastructure
│   └── (Docker test configurations)
│
├── manual/                            # Additional manual test scripts
│   └── (Manual testing utilities)
│
├── temp/                              # Temporary test files and artifacts
│   └── (Temporary test data)
│
└── archived/                          # Archived/legacy test files
    └── (Archived test files)
```

**🚀 New to this project?** Choose your preferred setup:

- **[Warp Terminal Quick Start Guide](../docs/QUICKSTART.md)** - Original 5-minute setup
- **[VS Code Quick Start Guide](../docs/QUICKSTART-VSCODE.md)** - Complete VS Code + Warp integration

Get the MCP server running first, then return here to understand the testing architecture.

## 🧪 Test Overview

- **Test Framework**: [Vitest](https://vitest.dev/) - Fast, modern testing framework
- **Total Tests**: 565+ tests across unit, manual, and docker test suites
- **Status**: ✓ All passing (100% success rate)
- **Coverage**: 61.04% statements, 77.89% branches, 91.66% functions
- **Test Types**: Unit tests (mocked), Manual tests (live DB), Docker tests (containerized)
- **🔒 Security Focus**: Comprehensive safety mechanism validation to prevent security bypasses
- **📦 Modular Structure**: Tests organized by functional area for better maintainability
- **🚀 Complete Suite**: `npm run test:integration` for full validation

## 📁 Test Structure

```text
test/
├── README.md                        # This documentation
├── setup.js                         # Global test setup and mock configurations
├── TEST_IMPROVEMENTS.md             # Test improvement tracking
├── unit/                            # Unit test suites
│   ├── sqlserver-mcp.test.js       # Original monolithic test suite (127 tests)
│   ├── mcp-connection.test.js      # Database connection tests (4 tests)
│   ├── mcp-security.test.js        # Safety mechanisms tests (38 tests)
│   ├── mcp-core-tools.test.js      # Core SQL tools tests (12 tests)
│   ├── mcp-data-tools.test.js      # Data manipulation tools tests (36 tests)
│   ├── mcp-performance-tools.test.js # Performance monitoring tests (22 tests)
│   ├── mcp-server-lifecycle.test.js # Server lifecycle tests (15 tests)
│   ├── mcp-shared-fixtures.js      # Shared test fixtures and utilities
│   ├── fixtures/                   # Test fixtures and sample data
│   └── [other utility test files]   # Logger, performance monitor, etc.
├── integration/                     # Integration tests
│   ├── test-aws-secrets.js         # AWS Secrets Manager tests
│   ├── test-azure-secrets.js       # Azure Key Vault tests
│   └── manual/                      # Manual integration tests with live DB
│       ├── README.md                # Manual testing documentation
│       ├── phase1-readonly-security.test.js   # Phase 1 security tests
│       ├── phase2-dml-operations.test.js      # Phase 2 DML tests
│       └── phase3-ddl-operations.test.js      # Phase 3 DDL tests
├── protocol/                        # MCP protocol-level tests
│   ├── README.md                    # Protocol testing documentation
│   ├── mcp-client-smoke-test.js    # Basic MCP client communication test
│   └── mcp-protocol-validation.test.js # Protocol validation tests
├── docker/                          # Docker-based testing infrastructure
├── manual/                          # Additional manual test scripts
├── temp/                            # Temporary test files and artifacts
├── archived/                        # Archived/legacy test files
└── vitest.config.js                 # Test configuration (in root directory)
```

## 🏃‍♂️ Running Tests

### Basic Commands

```bash
# Run all tests once
npm test

# Run tests in watch mode (reruns on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with UI interface (if available)
npm run test:ui

# Run EVERYTHING - complete test suite (recommended for pre-release)
npm run test:integration     # 🚀 Unit + Integration tests with Docker (~5-10min)
```

### Development Workflow

```bash
# Best for active development - watch mode with coverage
npm run test:watch

# Before committing - full test run with coverage
npm run test:coverage

# Run specific test suites during development
npm test test/unit/mcp-security.test.js        # Security tests only
npm test test/unit/mcp-core-tools.test.js      # Core tools only
npm test test/unit/mcp-data-tools.test.js      # Data tools only
npm test test/unit/mcp-performance-tools.test.js # Performance monitoring only
```

### Modular Test Structure

The test suite has been organized into focused, modular files for better maintainability:

#### 🎯 **Focused Test Files**

- **`mcp-connection.test.js`** - Database connection and authentication
- **`mcp-security.test.js`** - Safety mechanisms and query validation
- **`mcp-core-tools.test.js`** - Core SQL tools (executeQuery, listDatabases, etc.)
- **`mcp-data-tools.test.js`** - Data manipulation tools (getTableData, exportTableCsv, etc.)
- **`mcp-performance-tools.test.js`** - Performance monitoring tools
- **`mcp-server-lifecycle.test.js`** - Server startup, configuration, and runtime

#### 📦 **Benefits of Modular Structure**

- **Faster Development**: Run only relevant tests during feature development
- **Better Organization**: Tests grouped by functional area
- **Isolated Testing**: Each test file runs independently
- **Easier Maintenance**: Smaller, focused files are easier to understand and modify
- **Parallel Execution**: Test files can run in parallel for faster CI/CD

## 🧩 Test Categories

### 1. **Database Connection Tests** (4 tests)

Tests the core database connection functionality:

- **✅ Basic Connection**: Verifies connection with SQL Server authentication
- **✅ Windows Authentication**: Tests NTLM authentication when no user/password provided
- **✅ Connection Reuse**: Ensures existing connections are reused efficiently
- **✅ Connection Errors**: Validates proper error handling for connection failures

```javascript
// Example: Connection with configuration verification
expect(sql.connect).toHaveBeenCalledWith(
  expect.objectContaining({
    server: 'localhost',
    port: 1433
    // ... other config options
  })
);
```

### 2. **Query Execution Tests** (3 tests)

Tests the `execute_query` MCP tool:

- **✅ Successful Query**: Executes queries and returns proper results
- **✅ Database Switching**: Tests `USE [database]` functionality
- **✅ Query Error Handling**: Validates SQL syntax error handling

### 3. **Database Listing Tests** (2 tests)

Tests the `list_databases` MCP tool:

- **✅ Database Listing**: Returns user databases with metadata
- **✅ System Database Exclusion**: Filters out system databases (master, tempdb, model, msdb)

### 4. **Table Operations Tests** (2 tests)

Tests the `list_tables` MCP tool:

- **✅ Table Listing**: Lists tables in specified database/schema
- **✅ Database Context**: Switches to correct database before listing

### 5. **Table Schema Tests** (2 tests)

Tests the `describe_table` MCP tool:

- **✅ Schema Description**: Returns complete table schema information
- **✅ Primary Key Detection**: Identifies primary key columns correctly

### 6. **Data Retrieval Tests** (10 tests)

Tests the `get_table_data` MCP tool with comprehensive WHERE clause filtering:

#### Basic Data Retrieval

- **✅ Default Limit**: Retrieves data with TOP 100 limit
- **✅ Filtered Results**: Returns correctly filtered and formatted data

#### WHERE Clause Filtering (9 comprehensive tests)

- **✅ Basic WHERE**: Simple conditions like `id > 10`
- **✅ Complex AND**: Multiple conditions like `status = 'active' AND created_date > '2023-01-01'`
- **✅ LIKE Patterns**: Pattern matching like `name LIKE '%john%'`
- **✅ NULL Checks**: Null handling like `deleted_at IS NULL`
- **✅ OR Conditions**: Multiple options like `status = 'active' OR status = 'pending'`
- **✅ Numeric Comparisons**: Range queries like `age >= 18 AND age <= 65`
- **✅ Date Comparisons**: Date filtering like `created_date > '2023-01-01'`
- **✅ IN Clauses**: Set filtering like `status IN ('active', 'pending', 'verified')`
- **✅ Result Validation**: Verifies filtered data is returned correctly

### 7. **Query Analysis Tests** (4 tests)

Tests the `explain_query` MCP tool:

- **✅ Execution Plan Generation**: Creates estimated query execution plans
- **✅ Actual Execution Plans**: Generates actual execution plans with statistics
- **✅ Database Context**: Switches database context for analysis
- **✅ Error Handling**: Handles query plan generation failures

### 8. **Foreign Key Tests** (3 tests)

Tests the `list_foreign_keys` MCP tool:

- **✅ Foreign Key Discovery**: Lists all foreign key relationships
- **✅ Database Switching**: Works across different databases
- **✅ Schema Filtering**: Handles custom schema specifications

### 9. **CSV Export Tests** (14 tests)

Tests the `export_table_csv` MCP tool:

#### Basic CSV Functionality

- **✅ CSV Generation**: Exports table data in proper CSV format
- **✅ Limit Application**: Applies TOP N limits to exports
- **✅ WHERE Filtering**: Supports WHERE clause filtering
- **✅ CSV Escaping**: Properly escapes commas, quotes, and newlines
- **✅ Empty Tables**: Handles tables with no data
- **✅ Database Switching**: Switches database context for exports

#### Advanced CSV Filtering (8 comprehensive tests)

- **✅ Simple WHERE**: Basic filtering like `status = 'active'`
- **✅ Complex Conditions**: AND/OR combinations like `status = 'active' AND age > 20`
- **✅ LIKE Patterns**: Pattern matching like `email LIKE '%@example.com'`
- **✅ NULL Handling**: Null checks like `deleted_at IS NULL`
- **✅ Date Ranges**: Date filtering like `created_date BETWEEN '2023-01-01' AND '2023-12-31'`
- **✅ IN Clauses**: Set filtering like `role IN ('admin', 'manager', 'supervisor')`
- **✅ Combined Filters**: WHERE + LIMIT working together
- **✅ Empty Results**: Graceful handling of no matching records

### 10. **Server Startup and Runtime Tests** (7 tests)

Tests the MCP server lifecycle, startup, and runtime behavior:

#### Server Runtime Management

- **✅ Successful Startup**: Tests server startup with successful database connection
- **✅ Database Connection Failure**: Handles graceful startup when database connection fails
- **✅ Server Connection Errors**: Manages server connection errors during startup
- **✅ Multiple Connection Failures**: Handles both database and server connection failures

#### Entry Point Execution

- **✅ Main Module Execution**: Tests server creation and startup when run as main module
- **✅ Entry Point Error Handling**: Validates error handling in main entry point

#### Integration Scenarios

- **✅ Complete Startup Flow**: Tests the full server startup flow with all components

## 🔒 Safety & Security Testing (CRITICAL)

**⚠️ This is the most important testing category** - these tests ensure the three-tier safety system cannot be bypassed and provides proper security enforcement.

### Security Test Overview

The safety validation system is thoroughly tested to prevent:

- **Security Bypass Attempts**: Malicious queries attempting to circumvent safety controls
- **Configuration Drift**: Ensuring security settings are properly applied
- **Error Message Leakage**: Validating security error messages don't reveal sensitive information
- **Multi-Statement Attacks**: Preventing compound queries that could bypass individual statement validation

### Query Validation Tests

#### 🔴 **Read-Only Mode Validation**

```javascript
// Tests that read-only mode blocks all non-SELECT operations
describe('validateQuery - Read-Only Mode', () => {
  test('should allow SELECT queries in read-only mode', () => {
    const result = server.validateQuery('SELECT * FROM Users');
    expect(result.allowed).toBe(true);
  });

  test('should block INSERT in read-only mode', () => {
    const result = server.validateQuery('INSERT INTO Users VALUES (1, "test")');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Read-only mode is enabled');
  });

  test('should block UPDATE/DELETE/CREATE/DROP in read-only mode', () => {
    const dangerousQueries = [
      'UPDATE Users SET name = "hacked"',
      'DELETE FROM Users WHERE id = 1',
      'CREATE TABLE malicious (id int)',
      'DROP TABLE Users'
    ];

    dangerousQueries.forEach(query => {
      const result = server.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Read-only mode');
    });
  });
});
```

#### 🟠 **Destructive Operations Validation**

```javascript
// Tests DML (Data Manipulation Language) restrictions
describe('validateQuery - Destructive Operations', () => {
  test('should block DML when destructive operations disabled', () => {
    const dmlQueries = [
      'INSERT INTO Users VALUES (1, "test")',
      'UPDATE Users SET status = "active"',
      'DELETE FROM Users WHERE active = 0',
      'TRUNCATE TABLE logs'
    ];

    dmlQueries.forEach(query => {
      const result = server.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.queryType).toBe('destructive');
    });
  });

  test('should allow DML when explicitly enabled', () => {
    // Test with destructive operations enabled
    server.allowDestructiveOperations = true;
    server.readOnlyMode = false;

    const result = server.validateQuery('INSERT INTO Users (name) VALUES ("test")');
    expect(result.allowed).toBe(true);
  });
});
```

#### 🔴 **Schema Changes Validation**

```javascript
// Tests DDL (Data Definition Language) restrictions
describe('validateQuery - Schema Changes', () => {
  test('should block DDL when schema changes disabled', () => {
    const ddlQueries = [
      'CREATE TABLE new_table (id int)',
      'ALTER TABLE Users ADD COLUMN email VARCHAR(255)',
      'DROP TABLE old_table',
      'CREATE INDEX idx_name ON Users (name)',
      'GRANT SELECT ON Users TO public'
    ];

    ddlQueries.forEach(query => {
      const result = server.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.queryType).toBe('schema');
    });
  });
});
```

#### 🛡️ **Multi-Statement Attack Prevention**

```javascript
// Tests compound queries that attempt to bypass security
describe('validateQuery - Multi-Statement Security', () => {
  test('should detect dangerous operations in compound statements', () => {
    const compoundQueries = [
      'SELECT * FROM Users; DROP TABLE Users;',
      'SELECT name FROM Products; INSERT INTO logs VALUES (1);',
      'SELECT 1; UPDATE Users SET admin = 1;',
      'WITH cte AS (SELECT 1) SELECT * FROM cte; CREATE TABLE backdoor (id int);'
    ];

    compoundQueries.forEach(query => {
      const result = server.validateQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });
  });
});
```

#### 🔍 **Advanced Pattern Detection**

```javascript
// Tests sophisticated attack patterns
describe('validateQuery - Advanced Security', () => {
  test('should detect stored procedure execution attempts', () => {
    const procQueries = ['EXEC xp_cmdshell "dir"', 'EXECUTE sp_configure', 'CALL malicious_proc()'];

    procQueries.forEach(query => {
      const result = server.validateQuery(query);
      expect(result.allowed).toBe(false);
    });
  });

  test('should handle case-insensitive pattern matching', () => {
    const caseVariations = [
      'insert INTO Users VALUES (1)',
      'Insert Into Users Values (1)',
      'INSERT into users values (1)',
      'iNsErT iNtO uSeRs VaLuEs (1)'
    ];

    caseVariations.forEach(query => {
      const result = server.validateQuery(query);
      expect(result.allowed).toBe(false);
    });
  });
});
```

### Security Configuration Matrix Testing

```javascript
// Tests all possible security configuration combinations
describe('Security Configuration Matrix', () => {
  const securityConfigs = [
    { readOnly: true, destructive: false, schema: false }, // Maximum security
    { readOnly: false, destructive: true, schema: false }, // Data analysis
    { readOnly: false, destructive: true, schema: true } // Full development
  ];

  securityConfigs.forEach(config => {
    describe(`Config: RO=${config.readOnly}, DML=${config.destructive}, DDL=${config.schema}`, () => {
      beforeEach(() => {
        server.readOnlyMode = config.readOnly;
        server.allowDestructiveOperations = config.destructive;
        server.allowSchemaChanges = config.schema;
      });

      test('should enforce SELECT query policy', () => {
        const result = server.validateQuery('SELECT * FROM Users');
        expect(result.allowed).toBe(true);
      });

      test('should enforce INSERT policy', () => {
        const result = server.validateQuery('INSERT INTO Users VALUES (1)');
        const shouldAllow = !config.readOnly && config.destructive;
        expect(result.allowed).toBe(shouldAllow);
      });

      test('should enforce CREATE policy', () => {
        const result = server.validateQuery('CREATE TABLE test (id int)');
        const shouldAllow = !config.readOnly && config.schema;
        expect(result.allowed).toBe(shouldAllow);
      });
    });
  });
});
```

### Error Message Security Testing

```javascript
// Ensures error messages are helpful but don't leak sensitive information
describe('Security Error Messages', () => {
  test('should provide clear security violation explanations', () => {
    const result = server.validateQuery('DELETE FROM Users');

    expect(result.reason).toContain('Read-only mode is enabled');
    expect(result.reason).toContain('Only SELECT queries are allowed');
    expect(result.reason).toContain('Set SQL_SERVER_READ_ONLY=false to disable');
  });

  test('should not leak database structure in error messages', () => {
    const result = server.validateQuery('SELECT * FROM secret_table');

    // Security error should not reveal table existence
    expect(result.reason).not.toContain('secret_table');
    expect(result.reason).not.toContain('table not found');
    expect(result.reason).not.toContain('permission denied');
  });
});
```

### Safety Testing Best Practices

#### 🧪 **Test-Driven Security Development**

When adding new security features:

1. **Write Security Tests First**: Create failing tests that demonstrate the vulnerability
2. **Implement Security**: Add the security mechanism to make tests pass
3. **Test Bypass Attempts**: Try to circumvent your own security measures
4. **Validate Error Messages**: Ensure clear, helpful error messages

#### 🔍 **Security Test Patterns**

```javascript
// Standard security test pattern
const testSecurityFeature = (featureName, dangerousQueries, safeQueries) => {
  describe(`Security: ${featureName}`, () => {
    test('should block dangerous queries', () => {
      dangerousQueries.forEach(query => {
        const result = server.validateQuery(query);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeDefined();
      });
    });

    test('should allow safe queries', () => {
      safeQueries.forEach(query => {
        const result = server.validateQuery(query);
        expect(result.allowed).toBe(true);
      });
    });
  });
};
```

#### 🔒 **Critical Security Validations**

Every security-related test must validate:

- [ ] **Query blocking works** - Dangerous queries are actually blocked
- [ ] **Error messages are clear** - Users understand what's blocked and why
- [ ] **Configuration compliance** - Security settings are properly applied
- [ ] **Bypass prevention** - Multiple attack vectors are tested
- [ ] **Default security** - Secure defaults are maintained

### Running Security Tests

```bash
# Run all security-related tests
npm test -- --grep "security|safety|validate"

# Run specific security test categories
npm test -- --grep "validateQuery"
npm test -- --grep "Security Configuration"
npm test -- --grep "Read-Only Mode"

# Security test coverage
npm run test:coverage -- --grep "security"
```

### Security Testing Checklist

Before any release:

- [ ] ✅ **All security tests pass** - No security functionality is broken
- [ ] ✅ **New features have security tests** - Every new SQL-related feature is tested
- [ ] ✅ **Bypass attempts fail** - Security cannot be circumvented
- [ ] ✅ **Error messages validated** - Clear but not revealing sensitive info
- [ ] ✅ **Configuration matrix tested** - All security combinations work
- [ ] ✅ **Default security confirmed** - Secure defaults are maintained

**⚠️ Remember**: These security tests are the **last line of defense** against accidental data loss or malicious attacks. They must be comprehensive, maintained, and never bypassed.

## 🏗️ Test Architecture

### Mock Strategy

The tests use comprehensive mocking to ensure:

- **🚀 Fast Execution**: No actual SQL Server required
- **🔄 Reliability**: Consistent results across environments
- **🧪 Isolation**: Each test runs independently
- **📊 Coverage**: All code paths and error scenarios tested

### Mock Components

```javascript
// SQL Server connection mocking
vi.mock('mssql', () => ({
  default: { connect: vi.fn(), ConnectionPool: vi.fn() },
  connect: vi.fn(),
  ConnectionPool: vi.fn()
}));

// Mock request/pool objects
const mockRequest = { query: vi.fn(), timeout: 30000 };
const mockPool = { request: vi.fn(() => mockRequest), connected: true };
```

### Test Data

Structured test data provides realistic scenarios:

```javascript
const testData = {
  sampleDatabases: [/* User databases with metadata */],
  sampleTables: [/* Table definitions */],
  sampleTableSchema: [/* Column definitions with types */],
  sampleTableData: [/* Sample rows for testing */]
};
```

## 🔧 Test Configuration

### Vitest Configuration (`../vitest.config.js`)

```javascript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['index.js'],
      exclude: ['test/**', 'node_modules/**']
    }
  }
});
```

### Global Setup (`setup.js`)

- Mock configurations for `mssql` and `dotenv`
- Global test data definitions
- Utility functions for testing

## 🛡️ Quality Assurance

### Bug Prevention

The comprehensive test suite specifically prevents:

1. **Parameter Mismatch**: Ensures MCP tool schemas match function implementations
2. **WHERE Clause Bugs**: Validates filtering actually works end-to-end
3. **SQL Injection**: Tests proper parameter handling and escaping
4. **Connection Issues**: Validates all authentication methods and error scenarios
5. **Data Format Issues**: Ensures proper JSON/CSV output formatting
6. **Server Lifecycle Issues**: Tests server startup, runtime, and error handling scenarios

### Error Scenario Coverage

Tests cover all major error conditions:

- Database connection failures
- Authentication errors
- SQL syntax errors
- Permission denied errors
- Network timeouts
- Empty result sets
- Invalid parameters

## 📈 Coverage Analysis

### Current Coverage (61.04% statements)

**Covered Areas:**

- ✅ All MCP tool implementations
- ✅ Database connection logic
- ✅ Error handling paths
- ✅ Data formatting and output
- ✅ Authentication methods

**Uncovered Areas:**

- 🔶 Some MCP server initialization code
- 🔶 Unused error handling branches
- 🔶 Development/debugging code paths

### Improving Coverage

To increase coverage:

1. Add integration tests that test full MCP server lifecycle
2. Test error scenarios that are difficult to mock
3. Add tests for edge cases in data formatting
4. Test connection pool edge cases

## 🚀 Adding New Tests

### Test Structure Pattern

```javascript
describe('New Feature', () => {
  beforeEach(() => {
    // Reset mocks and set up test environment
    vi.clearAllMocks();
    mcpServer.pool = mockPool;
  });

  test('should handle normal case', async () => {
    // Arrange: Set up mock responses
    mockRequest.query.mockResolvedValue({ recordset: testData });

    // Act: Call the function
    const result = await mcpServer.newFeature();

    // Assert: Verify behavior
    expect(mockRequest.query).toHaveBeenCalledWith(expectedQuery);
    expect(result).toEqual(expectedResult);
  });

  test('should handle error case', async () => {
    // Arrange: Set up error scenario
    const error = new Error('Test error');
    mockRequest.query.mockRejectedValue(error);

    // Act & Assert: Verify error handling
    await expect(mcpServer.newFeature()).rejects.toThrow('Expected error message');
  });
});
```

### Best Practices

1. **Test Both Success and Error Cases**: Every feature should have positive and negative tests
2. **Mock SQL Server Responses**: Use realistic test data that matches actual SQL Server output
3. **Verify SQL Queries**: Check that the correct SQL is being generated
4. **Test Parameter Handling**: Ensure MCP parameters are correctly processed
5. **Validate Output Format**: Confirm responses match expected MCP format

## 🔍 Debugging Tests

### Common Issues

1. **Mock Not Applied**: Ensure `vi.mock()` calls are at the top level
2. **Async Issues**: Use `await` with async functions in tests
3. **Mock State**: Reset mocks in `beforeEach()` to avoid test interference
4. **SQL Expectations**: Use `expect.stringContaining()` for partial SQL matching

### Debug Commands

```bash
# Run specific test file
npx vitest test/sqlserver-mcp.test.js

# Run tests matching a pattern
npx vitest -t "Database Connection"

# Run with verbose output
npx vitest --reporter=verbose

# Debug with node inspector
node --inspect-brk ./node_modules/.bin/vitest
```

This comprehensive test suite ensures the Warp SQL Server MCP server is robust, reliable, and
ready for production use. The tests provide confidence for ongoing development and help prevent
regressions as new features are added.
