# Testing Guide

This document explains how to run the various tests in this project and when to use each type.

## 🧪 Test Categories

### Unit Tests (Automated)

```bash
npm test              # Run all unit tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run with coverage report
```

### Manual Tests - Complete Suite

```bash
npm run test:manual                # Run ALL manual tests (~45s)
```

**Execution Order** (when running `npm run test:manual`):

1. `npm run test:manual:performance` - Performance validation (~2s)
2. `npm run test:manual:warp-performance` - Warp integration (~10s)
3. `npm run test:manual:phase1` - Read-only security (~10s)
4. `npm run test:manual:phase2` - DML operations security (~10s)
5. `npm run test:manual:phase3` - DDL operations security (~10s)
6. `npm run test:manual:protocol` - MCP protocol validation (~3s)

### Manual Tests - Individual Categories

#### ⚡ Performance Tests

```bash
npm run test:manual:performance     # ⭐ RECOMMENDED: Fast performance test (~2s)
npm run test:manual:warp-performance # Warp MCP integration test (~10s)
```

- **Primary Performance Test**: Single persistent MCP process, concurrent testing, 100% success rate
- **Warp Integration Test**: Tests against running Warp instance, validates production setup
- **Prerequisites for Warp test**: Warp must be running with MCP server configured

#### 🔒 Security Tests (Phase-based)

```bash
npm run test:manual:phase1         # Read-only security tests
npm run test:manual:phase2         # DML operations tests
npm run test:manual:phase3         # DDL operations tests
```

- **Phase 1**: Validates read-only mode and basic security
- **Phase 2**: Tests data manipulation (INSERT/UPDATE/DELETE) security
- **Phase 3**: Tests schema modification (CREATE/DROP/ALTER) security

#### 📡 Protocol Tests

```bash
npm run test:manual:protocol       # MCP protocol smoke test
```

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
│   └── test-azure-secrets.js    # Azure integration
├── archived/                     # Deprecated tests
└── unit/                        # Automated unit tests
    └── *.test.js
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
npm run test:manual:performance

# Run all manual tests (performance + security) if needed
npm run test:manual
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
   - Use `npm run test:manual:performance` for reliable performance testing
   - Check connection pool settings and SQL Server accessibility

### Debug Commands

```bash
# Check for running MCP processes
ps aux | grep "node index.js"

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
