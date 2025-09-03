# Contributing to the Enterprise-Grade Software Framework

## Welcome Contributors

Thank you for your interest in contributing to this project! While this appears to be an MCP server for SQL
Server, you're actually contributing to **a comprehensive framework demonstrating enterprise-grade software
development practices**. Your contributions help maintain and extend a reference implementation for rigorous software
engineering.

## Philosophy

Before diving into code, please read our [**Software Engineering Manifesto**](MANIFESTO.md) to understand the principles that guide this project. Every contribution should uphold these standards:

- **Testing as a First-Class Citizen**: No code without comprehensive tests
- **Security by Design**: Security considerations in every change
- **Observability by Default**: Proper logging and monitoring for all features
- **Production Readiness**: Code that's ready for enterprise deployment

**🚀 New to this project?** Review our [Architecture Guide](docs/ARCHITECTURE.md) and choose your preferred setup:

- **[Warp Terminal Quick Start Guide](docs/QUICKSTART.md)** - Original 5-minute setup
- **[VS Code Quick Start Guide](docs/QUICKSTART-VSCODE.md)** - Complete VS Code + Warp integration

These guides will help you understand both the technical architecture and practical usage.

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- npm (comes with Node.js)
- SQL Server instance (for integration testing - optional)

### 🧪 Test-Driven Development (TDD) - MANDATORY

**🎯 This project strictly follows Test-Driven Development. ALL new functionality must be test-driven.**

#### TDD is enforced through

- Pre-commit hooks that require passing tests
- Code review process that validates TDD practices
- CI/CD pipeline that enforces test coverage requirements
- Security testing requirements for all SQL-related functionality

### Getting Started

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd warp-sql-server-mcp
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Install git hooks** (recommended for contributors)
   ```bash
   npm run hooks:install
   # or
   ./install-git-hooks.sh
   ```

## Development Workflow

### Code Quality Tools

This project uses several tools to maintain code quality:

- **ESLint**: JavaScript linting
- **Prettier**: Code formatting
- **markdownlint**: Markdown formatting
- **Vitest**: Testing framework

### Available Scripts

```bash
# Testing
npm test                    # Run all tests
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Run tests with coverage report
npm run test:ui            # Run tests with UI interface

# Linting and Formatting
npm run lint               # Check code with ESLint
npm run lint:fix           # Fix ESLint issues automatically
npm run format             # Format code with Prettier
npm run format:check       # Check if code is properly formatted
npm run markdown:lint      # Lint markdown files
npm run markdown:fix       # Fix markdown issues automatically

# Git Hooks
npm run hooks:install      # Install git hooks
npm run hooks:uninstall    # Remove git hooks

# Pre-commit checks (manual)
npm run precommit          # Run all pre-commit checks
npm run ci                 # Run all CI checks locally

# Utilities
npm run clean              # Clean build artifacts
npm run audit:fix          # Fix npm security issues
```

### Git Hooks

When you run `npm run hooks:install`, two git hooks are installed:

1. **pre-commit**: Runs before each commit
   - ESLint on staged JavaScript files
   - Prettier formatting check on staged files
   - markdownlint on staged markdown files
   - Quick test suite

2. **pre-push**: Runs before each push
   - Full test suite
   - Test coverage check
   - Security audit (`npm audit --audit-level=high`)
   - Comprehensive linting (ESLint, Prettier)
   - Markdown formatting validation
   - Dead link checking

### Testing

This project uses Vitest for testing. Tests are located in the `test/` directory.

- **Unit tests**: Test individual functions and methods
- **Integration tests**: Test the MCP server functionality
- **Coverage**: Aim for >80% code coverage

Run tests with:

```bash
npm test                    # Single run
npm run test:watch         # Watch mode for development
npm run test:coverage      # With coverage report
```

### Code Style

The project follows these style guidelines:

- **JavaScript**: ES6 modules, 2-space indentation, single quotes
- **Prettier**: Automatic formatting with 100 character line limit
- **ESLint**: Enforces Node.js best practices
- **Markdown**: markdownlint rules with 100 character line limit

### CI/CD

GitHub Actions automatically runs:

- **Tests** on Node.js 18, 20, and 22
- **Linting** with ESLint, Prettier, and markdownlint
- **Security audit** with npm audit
- **Coverage reporting** with Codecov (when configured)

## 🔒 Safety Testing Requirements (CRITICAL)

### Security Testing for Contributors

**⚠️ ALL SQL-related functionality MUST include comprehensive safety tests.**

#### Mandatory Safety Test Categories

For any new MCP tool or functionality that interacts with the database:

1. **Read-Only Mode Testing**

   ```javascript
   describe('new_tool read-only mode', () => {
     beforeEach(() => {
       // Set up read-only mode
       process.env.SQL_SERVER_READ_ONLY = 'true';
       process.env.SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = 'false';
       process.env.SQL_SERVER_ALLOW_SCHEMA_CHANGES = 'false';
     });

     test('should allow SELECT operations', async () => {
       // Test that SELECT operations work
     });

     test('should block non-SELECT operations', async () => {
       // Test that INSERT/UPDATE/DELETE/CREATE/etc are blocked
       // Must return proper error message explaining the restriction
     });
   });
   ```

2. **Destructive Operations Testing**

   ```javascript
   describe('new_tool destructive operations', () => {
     test('should respect destructive operations setting', async () => {
       // Test with SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false
       // Ensure DML operations are blocked
     });

     test('should allow DML when enabled', async () => {
       // Test with SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
       // Ensure DML operations work
     });
   });
   ```

3. **Schema Changes Testing**

   ```javascript
   describe('new_tool schema changes', () => {
     test('should respect schema changes setting', async () => {
       // Test with SQL_SERVER_ALLOW_SCHEMA_CHANGES=false
       // Ensure DDL operations are blocked
     });

     test('should allow DDL when enabled', async () => {
       // Test with SQL_SERVER_ALLOW_SCHEMA_CHANGES=true
       // Ensure DDL operations work
     });
   });
   ```

4. **Error Message Testing**
   ```javascript
   describe('new_tool error messages', () => {
     test('should provide clear security error messages', async () => {
       // Verify error messages explain:
       // - What was blocked
       // - Why it was blocked
       // - How to enable the functionality if needed
     });
   });
   ```

#### Safety Testing Checklist

Before submitting a PR with SQL functionality:

- [ ] **Read-only mode tests** - Verify tool respects read-only restrictions
- [ ] **DML restriction tests** - Test destructive operations controls
- [ ] **DDL restriction tests** - Test schema change controls
- [ ] **Error message validation** - Ensure clear, helpful error messages
- [ ] **Security bypass testing** - Attempt to circumvent security (must fail)
- [ ] **Edge case testing** - Test unusual SQL patterns and edge cases
- [ ] **Multi-statement testing** - Ensure multi-statement SQL is properly validated
- [ ] **Configuration matrix testing** - Test all security configuration combinations

### 🧪 TDD Workflow for Safety Features

#### Step-by-Step Safety TDD Process

1. **Write Security Tests First** (🔴 RED Phase)

   ```bash
   # Start with failing security tests
   npm run test:watch  # Keep running during development
   ```

2. **Implement Basic Functionality** (🟢 GREEN Phase)

   ```bash
   # Write minimal code to make security tests pass
   # Security validation should be implemented FIRST
   ```

3. **Add Feature Logic** (🟡 REFACTOR Phase)

   ```bash
   # Add the actual functionality while keeping security tests passing
   ```

4. **Comprehensive Testing** (🔒 SECURITY Phase)
   ```bash
   # Add edge cases, error conditions, and bypass attempts
   npm run test:coverage  # Verify coverage includes security paths
   ```

#### Security Test Examples

**Query Validation Testing:**

```javascript
test('validateQuery should block dangerous patterns', () => {
  const server = new SqlServerMCP();

  // Test various dangerous patterns
  const dangerousQueries = [
    'DROP TABLE Users',
    "INSERT INTO Users VALUES (1, 'test')",
    'DELETE FROM Users WHERE id = 1',
    "UPDATE Users SET name = 'hacked'",
    "EXEC xp_cmdshell 'dir'",
    'CREATE TABLE malicious (id int)'
  ];

  dangerousQueries.forEach(query => {
    const result = server.validateQuery(query);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked');
  });
});
```

**Multi-Configuration Testing:**

```javascript
const securityConfigs = [
  { readOnly: true, destructive: false, schema: false }, // Maximum security
  { readOnly: false, destructive: true, schema: false }, // Data analysis
  { readOnly: false, destructive: true, schema: true } // Full development
];

securityConfigs.forEach(config => {
  describe(`Security config: RO=${config.readOnly}, DML=${config.destructive}, DDL=${config.schema}`, () => {
    // Test each configuration thoroughly
  });
});
```

### Safety Testing Resources

- **Existing Tests**: See `test/sqlserver-mcp.test.js` for security test examples
- **Test Patterns**: Follow established patterns for validateQuery testing
- **Security Documentation**: Review `SECURITY.md` for threat model details
- **Mock Data**: Use existing mock data and patterns for consistency

## Making Changes

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes (TDD Process)**
   - **STEP 1**: Write comprehensive safety tests FIRST
   - **STEP 2**: Write tests for functionality
   - **STEP 3**: Implement security validation
   - **STEP 4**: Implement core functionality
   - **STEP 5**: Update documentation as needed
   - **STEP 6**: Follow the existing code style

3. **Test locally**

   ```bash
   npm run ci  # Run all checks locally
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: description of your changes"
   ```

   The pre-commit hook will automatically run checks.

   **If the pre-commit hook blocks your commit:**

   ```bash
   # Fix formatting issues automatically
   npm run format

   # Fix linting issues automatically
   npm run lint:fix

   # Fix markdown issues automatically
   npm run markdown:fix

   # Then retry the commit
   git commit -m "your commit message"
   ```

5. **Push and create a Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Commit Message Format

Follow conventional commits format:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Example:

```text
feat: add new database connection tool

- Add support for custom connection strings
- Include connection pooling options
- Update tests and documentation
```

## Getting Help

- Check existing issues: [GitHub Issues](https://github.com/egarcia74/warp-sql-server-mcp/issues)
- Ask questions: [Question Template](https://github.com/egarcia74/warp-sql-server-mcp/issues/new?template=question.yml)
- Read the documentation in `README.md` and `WARP.md`
- Look at the test files for usage examples

Thank you for contributing! 🚀
