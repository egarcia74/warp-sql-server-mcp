# Testing Structure Refactoring

## Overview

The npm test scripts have been reorganized and cleaned up to follow standard naming conventions and eliminate
confusing deprecated scripts. The new structure makes Docker the default for integration tests and provides clear, concise commands.

## Current Test Structure

### Primary Test Commands

- **`npm test`** - Runs both unit and integration tests (recommended)
- **`npm run test:unit`** - Unit tests only (fast, no external dependencies)
- **`npm run test:integration`** - Integration tests with Docker (default setup)
- **`npm run test:coverage`** - Generate test coverage reports

### Integration Test Breakdown

- **`npm run test:integration:run`** - Runs all integration tests (requires running database)
- **`npm run test:integration:manual`** - Manual phase tests (1, 2, 3)
- **`npm run test:integration:protocol`** - MCP protocol smoke tests
- **`npm run test:integration:performance`** - General performance testing
- **`npm run test:integration:warp`** - Warp terminal-specific performance testing
- **`npm run test:integration:ci`** - For CI environments with external database

### Additional Test Commands

- **`npm run test:unit:watch`** - Watch mode for unit tests
- **`npm run test:watch`** - Watch mode for all tests
- **`npm run test:ui`** - Open Vitest UI
- **`npm run test:integration:aws`** - AWS secrets integration test
- **`npm run test:integration:azure`** - Azure secrets integration test
- **`npm run test:all`** - Alias for `npm test`

## Key Changes

### 1. Docker is Default for Integration Tests

Integration tests now use Docker automatically:

```bash
npm run test:integration       # Uses Docker automatically
npm run test:integration:ci    # For CI with external DB
```

### 2. Clear Separation

- **Unit Tests**: Fast, isolated, no external dependencies
- **Integration Tests**: Require database, use Docker by default

### 3. Automatic Docker Management

The `test:integration` script automatically:

1. Starts Docker container
2. Waits for database readiness
3. Runs all integration tests
4. Stops Docker container

### 4. Deprecated Scripts Removed ✨

All deprecated scripts have been **completely removed** for a cleaner experience:

- No more confusing `test:manual:*` vs `test:manual:docker:*` duplication
- No more deprecation warnings cluttering output
- Clean, focused script list

## Usage Examples

### Development Workflow

```bash
# Quick unit tests during development
npm run test:unit:watch

# Run all tests before committing
npm test

# Run just integration tests
npm run test:integration

# General performance testing
npm run test:integration:performance

# Warp terminal-specific performance testing
npm run test:integration:warp
```

### CI/CD Environments

```bash
# Standard CI with Docker
npm test

# CI with external SQL Server (if preferred)
npm run test:unit && npm run test:integration:ci
```

### Manual Testing

```bash
# If you have a running SQL Server on localhost:1433
npm run test:integration:ci

# Or use Docker (recommended)
npm run test:integration
```

## Benefits

1. **Clarity**: No more confusion between manual vs Docker variants
2. **Simplicity**: Docker is default, handles setup automatically
3. **Standards**: Follows npm script conventions (test:unit, test:integration)
4. **Maintenance**: Eliminates duplicate script logic
5. **CI-Friendly**: Works in both Docker and external database environments

## Migration Guide

| Old Command                    | New Command                    | Notes                 |
| ------------------------------ | ------------------------------ | --------------------- |
| `test:manual:docker:all`       | `test:integration`             | Now the default       |
| `test:manual:all`              | `test:integration:ci`          | For external DB       |
| `test:everything`              | `test:all` or `test`           | Simplified            |
| `test:performance:improved`    | `test:integration:performance` | General performance   |
| `test:manual:warp-performance` | `test:integration:warp`        | Warp-specific testing |

All deprecated commands still work but show warnings to guide migration.
