# Testing Guide

This document explains how to run the various tests in this project and when to use each type.

## 🧪 Test Categories

### Unit Tests (Automated)

```bash
npm test              # Run all unit tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run with coverage report
```

### Integration Tests - Complete Suite

```bash
npm run test:integration           # Run ALL integration tests with Docker
npm run test:integration:run       # Run integration tests (requires running database)
npm run test:integration:ci        # For CI environments with external database
```

**Execution Order** (when running `npm run test:integration`):

1. Docker container setup and initialization
2. `npm run test:integration:manual` - Manual phase tests (1, 2, 3)
3. `npm run test:integration:protocol` - MCP protocol validation
4. `npm run test:integration:performance` - Performance validation
5. Docker container cleanup

### Integration Tests - Individual Categories

#### ⚡ Performance Tests

```bash
npm run test:integration:performance     # ⭐ RECOMMENDED: Fast performance test (~2s)
npm run test:integration:warp           # Warp MCP integration test (~10s)
```

- **Primary Performance Test**: Single persistent MCP process, concurrent testing, 100% success rate
- **Warp Integration Test**: Tests against running Warp instance, validates production setup
- **Prerequisites for Warp test**: Warp must be running with MCP server configured

#### 🔒 Security Tests (Manual Phases)

```bash
npm run test:integration:manual    # All manual phase tests (1, 2, 3)
```

- **Phase 1**: Validates read-only mode and basic security
- **Phase 2**: Tests data manipulation (INSERT/UPDATE/DELETE) security
- **Phase 3**: Tests schema modification (CREATE/DROP/ALTER) security

#### 📡 Protocol Tests

```bash
npm run test:integration:protocol           # MCP protocol smoke test
VERBOSE=1 npm run test:integration:protocol # Protocol test with detailed JSON output
DEBUG=1 npm run test:integration:protocol   # Protocol test with detailed JSON output
```

**Protocol Test Features**:

- **Standard Mode**: Clean output showing only test results and status
- **Verbose Mode**: Pretty-printed MCP initialize response for debugging
- **JSON Response Analysis**: Detailed server capabilities, protocol version, and instructions

## 📁 Test File Organization

```text
test/
├── manual/                       # Active manual tests
│   ├── improved-performance-test.js  ⭐ Primary performance test
│   └── warp-mcp-performance-test.js  # Warp integration test
├── integration/                  # Integration tests
│   ├── manual/                   # Manual security tests
│   │   ├── phase1-readonly-security.test.js
│   │   ├── phase2-dml-operations.test.js
│   │   └── phase3-ddl-operations.test.js
│   ├── test-aws-secrets.js      # AWS integration
│   ├── test-azure-secrets.js    # Azure integration
│   ├── sqlserver-mcp-integration.test.js  # Core MCP integration
│   └── error-scenarios-integration.test.js # Error handling tests
├── protocol/                     # MCP protocol tests
│   └── mcp-server-startup-test.js # Protocol communication validation (supports VERBOSE=1)
├── docker/                       # Docker testing infrastructure
│   ├── quick-stress-test.js      # Docker stress testing
│   ├── test-connectivity.js      # Connection validation
│   ├── verify-platform-detection.js # Platform detection
│   └── troubleshoot-apple-silicon.js # Apple Silicon troubleshooting
├── unit/                        # Automated unit tests
│   └── *.test.js                # Component unit tests
├── archived/                     # Deprecated tests
├── temp/                         # Temporary test artifacts
├── setup.js                     # Test environment setup
├── README.md                    # Testing documentation
└── TEST_IMPROVEMENTS.md         # Testing methodology improvements
```

## 🎯 When to Use Each Test

| Test Type            | When to Use                                  | Duration | Success Rate |
| -------------------- | -------------------------------------------- | -------- | ------------ |
| **Unit Tests**       | Development, CI/CD                           | ~10s     | ~100%        |
| **Performance Test** | Performance validation, regression testing   | ~2s      | 100%         |
| **Security Tests**   | Security validation, compliance              | ~30s     | Varies       |
| **Warp Integration** | End-to-end validation with Warp              | ~10s     | ~100%        |
| **All Manual Tests** | Complete test suite (performance + security) | ~45s     | Varies       |

## 🚀 Quick Start

For most development and testing scenarios:

```bash
# Run unit tests first
npm test

# Run performance validation
npm run test:integration:performance

# Run all integration tests if needed
npm run test:integration
```

## 🔧 Troubleshooting

### Common Issues

1. **SQL Server Connection Timeouts**
   - Check SQL Server is running and accessible
   - Verify `.env` configuration
   - Use the performance test to validate connectivity

2. **Test Process Hanging**
   - Kill any orphaned MCP processes: `pkill -f "node index.js"`
   - Check for port conflicts
   - Restart SQL Server if needed

3. **Performance Test Failures**
   - Use `npm run test:integration:performance` for reliable performance testing
   - Check connection pool settings and SQL Server accessibility

### Debug Commands

```bash
# Check for running MCP processes
ps aux | grep "node index.js"

# Run protocol test with verbose JSON output
VERBOSE=1 npm run test:integration:protocol

# Run tests with clean output (suppressed ReDoS warnings)
npm run test:unit    # Automatically suppresses security warnings during testing

# Test direct SQL connection (manual check)
node -e "
import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();
sql.connect({
  server: process.env.SQL_SERVER_HOST,
  database: process.env.SQL_SERVER_DATABASE,
  user: process.env.SQL_SERVER_USER,
  password: process.env.SQL_SERVER_PASSWORD,
  options: { encrypt: true, trustServerCertificate: true }
}).then(() => console.log('✅ SQL Server connection OK')).catch(console.error);
"
```

## 📈 Performance Benchmarks

Expected performance for the improved performance test:

- **Startup time**: < 5 seconds
- **Query response**: 50-500ms
- **Concurrent queries**: 10 queries in ~250ms
- **Memory usage**: < 100MB
- **Success rate**: 100%

If your results significantly differ from these benchmarks, there may be an environmental or configuration issue.
