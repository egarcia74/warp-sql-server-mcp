# Contributing to Warp SQL Server MCP

Thank you for your interest in contributing to the Warp SQL Server MCP project!

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- npm (comes with Node.js)

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
   - Comprehensive linting
   - Code coverage check

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

## Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write tests for new functionality
   - Update documentation as needed
   - Follow the existing code style

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
```
feat: add new database connection tool

- Add support for custom connection strings
- Include connection pooling options
- Update tests and documentation
```

## Getting Help

- Check existing issues and discussions
- Read the documentation in `README.md` and `WARP.md`
- Look at the test files for usage examples

Thank you for contributing! 🚀
