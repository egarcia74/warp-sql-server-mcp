# Testing Guide

This document explains how to run the various tests in this project and when to use each type.

## 🧪 Test Categories

### Unit Tests (Automated)

```bash
npm test              # Run all unit tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run with coverage report
```

### Manual Integration Tests

```bash
npm run test:manual                # Run all manual security tests
npm run test:manual:phase1         # Read-only security tests
npm run test:manual:phase2         # DML operations tests
npm run test:manual:phase3         # DDL operations tests
```

### Performance Tests

#### ⚡ Recommended: Improved Performance Test

```bash
npm run test:manual:performance
```

- **Use this for**: Regular performance validation
- **Features**: Single persistent MCP process, fast execution, reliable results
- **Response times**: 1-500ms typical
- **Success rate**: 100% (no timeouts)

#### 🔗 Warp MCP Performance Test

```bash
npm run test:manual:warp-performance
```

- **Use this for**: Testing against running Warp MCP instance
- **Features**: Tests real Warp integration, validates production setup
- **Prerequisites**: Warp must be running with MCP server configured

### Protocol Tests

```bash
npm run test:protocol             # MCP protocol smoke test
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

| Test Type            | When to Use                                | Duration | Success Rate |
| -------------------- | ------------------------------------------ | -------- | ------------ |
| **Unit Tests**       | Development, CI/CD                         | ~10s     | ~100%        |
| **Performance Test** | Performance validation, regression testing | ~2s      | 100%         |
| **Security Tests**   | Security validation, compliance            | ~30s     | Varies       |
| **Warp Integration** | End-to-end validation with Warp            | ~10s     | ~100%        |

## 🚀 Quick Start

For most development and testing scenarios:

```bash
# Run unit tests first
npm test

# Run performance validation
npm run test:manual:performance

# Run security tests if needed
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
