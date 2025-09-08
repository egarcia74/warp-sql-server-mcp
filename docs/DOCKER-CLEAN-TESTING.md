# Docker Clean Flag Testing Guide

This guide explains the various testing options available for running Docker tests with clean slate functionality.

## 🚀 Quick Start

```bash
# Fast iteration (reuses existing data)
npm run docker:test

# Clean slate testing (guarantees fresh environment)
npm run docker:test:clean
```

## 📋 Available Commands

### Current Testing Approach

| Command                                | Description                                       |
| -------------------------------------- | ------------------------------------------------- |
| `npm run test:integration`             | Full integration test suite with Docker           |
| `npm run test:integration:run`         | Run integration tests (requires running database) |
| `npm run test:integration:manual`      | Manual phase tests (1, 2, 3)                      |
| `npm run test:integration:protocol`    | MCP protocol test                                 |
| `npm run test:integration:performance` | Performance tests                                 |

### Docker Container Management

| Command                     | Description                  |
| --------------------------- | ---------------------------- |
| `npm run docker:test`       | Docker test runner script    |
| `npm run docker:test:clean` | Docker test with clean slate |
| `npm run docker:start`      | Start SQL Server container   |
| `npm run docker:stop`       | Stop SQL Server container    |
| `npm run docker:clean`      | Clean containers and volumes |

> **Note**: Many of the granular `test:manual:docker:*` commands have been consolidated into the simpler `test:integration:*` structure for better maintainability.

### Advanced Script Usage

The `docker-test-runner.sh` script provides flexible testing options:

```bash
# Default (Phase 1 with existing data)
./scripts/docker-test-runner.sh

# Specific phase with existing data
./scripts/docker-test-runner.sh phase1
./scripts/docker-test-runner.sh phase2
./scripts/docker-test-runner.sh phase3
./scripts/docker-test-runner.sh protocol

# All phases with existing data
./scripts/docker-test-runner.sh all

# Any combination with clean slate
./scripts/docker-test-runner.sh phase1 --clean
./scripts/docker-test-runner.sh all --clean
```

## 🧹 Container Management

| Command                  | Description            | Use Case                                            |
| ------------------------ | ---------------------- | --------------------------------------------------- |
| `npm run docker:start`   | Start container        | Initial setup                                       |
| `npm run docker:stop`    | Stop container         | Save resources                                      |
| `npm run docker:restart` | Restart container      | Keep existing data                                  |
| `npm run docker:reset`   | Clean + restart        | Fresh start, same as `docker:clean && docker:start` |
| `npm run docker:clean`   | Remove all data        | Nuclear option                                      |
| `npm run docker:status`  | Check container status | Debugging                                           |

## 🔍 When to Use Each Option

### 🏃‍♂️ **Fast Iteration (Default)**

**Use for**: Development, debugging, repeated testing

```bash
npm run docker:test              # Quick docker test runner
npm run test:integration         # Full integration test suite
```

**Pros**:

- ⚡ Fast startup (2-3 seconds)
- 💾 Preserves existing data
- 🔄 Good for iterative development

**Cons**:

- 🗑️ May have leftover test data
- 🧪 Not guaranteed clean environment

### 🧹 **Clean Slate (Guaranteed Fresh)**

**Use for**: CI/CD, production validation, troubleshooting

```bash
npm run docker:test:clean        # Clean docker test
npm run docker:clean && npm run test:integration # Full clean test suite
```

**Pros**:

- ✅ Guaranteed clean environment
- 🔒 No leftover test data
- 🎯 Consistent results

**Cons**:

- 🐌 Slower startup (30-60 seconds)
- 💽 Rebuilds all data each time

## 📊 Performance Comparison

| Operation       | Fast Mode   | Clean Mode   | Difference  |
| --------------- | ----------- | ------------ | ----------- |
| Phase 1 Test    | ~15 seconds | ~45 seconds  | +30 seconds |
| All Phases      | ~60 seconds | ~120 seconds | +60 seconds |
| Container Start | ~3 seconds  | ~45 seconds  | +42 seconds |

## 🛠️ Troubleshooting

### Container Won't Start

```bash
npm run docker:status           # Check if running
npm run docker:logs             # Check container logs
npm run docker:clean            # Nuclear reset
```

### Tests Failing Due to Data Conflicts

```bash
npm run docker:reset            # Reset with fresh data
./scripts/docker-test-runner.sh phase1 --clean  # Clean specific test
```

### Cleanup Issues in Read-Only Mode

The test cleanup may fail when in read-only mode. This is expected behavior and doesn't affect test results. Use clean flag for guaranteed cleanup:

```bash
npm run docker:clean && npm run test:integration  # Forces cleanup
```

### Performance Issues

If Docker is slow:

```bash
# Check Docker resource allocation
docker system df

# Clean unused resources
docker system prune -f

# Reset Docker if needed
npm run docker:clean
```

## 📝 Best Practices

### For Development

1. **Start with fast mode** for initial development
2. **Use clean mode** when troubleshooting issues
3. **Run clean tests** before committing changes

### For CI/CD

1. **Always use clean mode** for automated testing
2. **Run all phases** with clean flag
3. **Clean up** after tests complete

### Example Workflows

**Development Workflow:**

```bash
# Start development
npm run docker:start

# Iterate quickly
npm run docker:test              # Fast tests
npm run docker:test              # Repeat as needed

# Final validation
npm run docker:test:clean        # Clean slate verification
```

**CI/CD Workflow:**

```bash
# Guaranteed clean testing
npm run docker:clean && npm run test:integration

# Or just use the built-in clean docker test
npm run docker:test:clean
```

## 🎯 Summary

The clean flag system provides flexibility:

- **🚀 Fast by default**: Optimal for development and iteration
- **🧹 Clean when needed**: Guaranteed fresh environment for validation
- **🎛️ Granular control**: Choose clean flag per test phase
- **📜 Multiple interfaces**: npm scripts, shell script, or manual commands

Choose the right tool for your use case and enjoy efficient Docker testing! 🐳
