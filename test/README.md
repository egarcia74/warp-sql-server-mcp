# Test Suite Documentation

This directory contains the comprehensive test suite for the Warp SQL Server MCP server. The tests ensure all functionality works correctly and provide confidence for ongoing development.

## 🧪 Test Overview

- **Test Framework**: [Vitest](https://vitest.dev/) - Fast, modern testing framework
- **Total Tests**: 44 tests
- **Status**: ✅ All passing
- **Coverage**: 60.25% statements, 78.04% branches, 83.33% functions
- **Test Type**: Unit tests with mocked SQL Server connections

## 📁 Test Structure

```text
test/
├── README.md              # This documentation
├── setup.js               # Global test setup and mock configurations
├── sqlserver-mcp.test.js   # Main test suite (44 tests)
└── vitest.config.js        # Test configuration (in root directory)
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
```

### Development Workflow

```bash
# Best for active development - watch mode with coverage
npm run test:watch

# Before committing - full test run with coverage
npm run test:coverage
```

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
  sampleDatabases: [
    /* User databases with metadata */
  ],
  sampleTables: [
    /* Table definitions */
  ],
  sampleTableSchema: [
    /* Column definitions with types */
  ],
  sampleTableData: [
    /* Sample rows for testing */
  ]
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

### Current Coverage (60.25% statements)

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

This comprehensive test suite ensures the Warp SQL Server MCP server is robust, reliable, and ready for production use. The tests provide confidence for ongoing development and help prevent regressions as new features are added.
