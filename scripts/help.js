#!/usr/bin/env node

/**
 * Help System for SQL Server MCP
 * Provides comprehensive information about all npm commands and usage
 */

console.log(`
🚀 SQL Server MCP - Command Reference
${'='.repeat(80)}

🏃 QUICK START COMMANDS
${'─'.repeat(80)}

  npm start                         Start the MCP server
  npm run dev                       Start with auto-reload for development
  npm run help                      Show this help (you are here!)

🧪 TESTING COMMANDS
${'─'.repeat(80)}

📋 Unit & Integration Tests
  npm test                          Run all automated unit tests (~10s)
  npm run test:watch               Run tests in watch mode
  npm run test:coverage            Run tests with coverage report
  npm run test:ui                  Run tests with visual UI interface

📋 Manual Integration Tests
  npm run test:manual              Run all manual security tests (~30s)
  npm run test:manual:phase1       Phase 1: Read-only security tests
  npm run test:manual:phase2       Phase 2: DML operations tests
  npm run test:manual:phase3       Phase 3: DDL operations tests

⚡ Performance Tests
  npm run test:manual:performance  ⭐ RECOMMENDED: Fast performance test (~2s)
  npm run test:manual:warp-performance    Test with Warp MCP integration (~10s)

📡 Protocol & Integration Tests
  npm run test:protocol            MCP protocol smoke test
  npm run test:integration:aws     AWS Secrets Manager integration
  npm run test:integration:azure   Azure Key Vault integration

🔧 CODE QUALITY COMMANDS
${'─'.repeat(80)}

  npm run lint                     Check code style and quality
  npm run lint:fix                 Fix linting issues automatically
  npm run format                   Format code with Prettier
  npm run format:check             Check if code is properly formatted

📝 DOCUMENTATION COMMANDS
${'─'.repeat(80)}

  npm run docs:extract             Extract JSDoc comments
  npm run docs:generate-tools      Generate tools documentation
  npm run docs:generate-landing    Generate landing page
  npm run docs:build               Build all documentation

  npm run markdown:lint            Check markdown files
  npm run markdown:fix             Fix markdown issues
  npm run links:check              Verify all markdown links

🛡️ SECURITY & MAINTENANCE
${'─'.repeat(80)}

  npm run security:audit           Run security audit
  npm run audit:fix                Fix security vulnerabilities
  npm run clean                    Clean node_modules and build artifacts

🔗 GIT HOOKS & CI/CD
${'─'.repeat(80)}

  npm run hooks:install            Install git pre-commit hooks
  npm run hooks:uninstall          Remove git hooks
  npm run precommit                Run pre-commit checks locally
  npm run prepush                  Run pre-push validation
  npm run ci                       Run full CI pipeline locally

📊 COMMAND CATEGORIES BY USE CASE
${'─'.repeat(80)}

🚀 Daily Development:
  npm run dev                      # Development with auto-reload
  npm test                         # Quick unit test validation
  npm run test:manual:performance  # Performance validation

🧪 Testing & Validation:
  npm run test:coverage            # Full test suite with coverage
  npm run test:manual              # Complete manual test suite
  npm run ci                       # Full CI validation

🔧 Maintenance & Quality:
  npm run lint:fix                 # Fix code style issues
  npm run format                   # Format code
  npm run security:audit           # Security validation

📚 Documentation & Release:
  npm run docs:build               # Generate documentation
  npm run links:check              # Validate documentation

💡 PERFORMANCE TEST DETAILS
${'─'.repeat(80)}

RECOMMENDED (Fast & Reliable):
  npm run test:manual:performance
  • Duration: ~2 seconds
  • Success Rate: 100%  
  • Features: Single persistent process, concurrent testing
  • Use for: Regular validation, CI/CD, development

WARP INTEGRATION:
  npm run test:manual:warp-performance  
  • Duration: ~10 seconds
  • Success Rate: ~100%
  • Features: Tests against running Warp instance
  • Use for: End-to-end validation

🔍 TROUBLESHOOTING QUICK REFERENCE
${'─'.repeat(80)}

Test Failures:
  • Check SQL Server is running: telnet localhost 1433
  • Verify .env configuration
  • Kill orphaned processes: pkill -f "node index.js"

Performance Issues:
  • Use npm run test:manual:performance (not legacy)
  • Check connection pool settings in .env
  • Monitor system resources

Connection Problems:
  • Verify SQL_SERVER_HOST, SQL_SERVER_PORT
  • Check SQL Server TCP/IP enabled
  • Test direct connection: npm run test:manual:performance

📚 DOCUMENTATION LINKS
${'─'.repeat(80)}

  README.md                        Project overview and quick start
  docs/TESTING-GUIDE.md            Comprehensive testing documentation
  docs/SECURITY.md                 Security configuration guide
  docs/ARCHITECTURE.md             Technical architecture details

💡 TIPS
${'─'.repeat(80)}

  • Use 'npm run' (no arguments) to see all available scripts
  • Most commands have descriptive output and progress indicators
  • Performance tests include detailed metrics and benchmarks
  • Manual tests require a running SQL Server instance

🚀 Ready to get started? Try: npm run test:manual:performance

`);
