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

📋 Integration Tests
  npm run test:integration         🚀 Full integration test suite with Docker (~5-10min)
  npm run test:integration:run     Run integration tests (requires running database)
  npm run test:integration:manual  Manual phase tests (1, 2, 3)
  npm run test:integration:ci      For CI environments with external database

⚡ Performance Tests
  npm run test:integration:performance  ⭐ RECOMMENDED: Fast performance test (~2s)
  npm run test:integration:warp    Test with Warp MCP integration (~10s)

📡 Protocol & Cloud Integration Tests
  npm run test:integration:protocol    MCP protocol smoke test
  npm run test:integration:aws     AWS Secrets Manager integration
  npm run test:integration:azure   Azure Key Vault integration

🐳 DOCKER CONTAINER MANAGEMENT
${'─'.repeat(80)}

🏗️ Container Lifecycle
  npm run docker:start             Start SQL Server container & wait for ready
  npm run docker:stop              Stop and remove SQL Server container
  npm run docker:restart           Restart SQL Server container
  npm run docker:clean             Stop container & remove all volumes/data
  npm run docker:status            Check container status

🔍 Debugging & Maintenance
  npm run docker:wait              Test database readiness
  npm run docker:logs              View SQL Server container logs
  npm run docker:shell             Get shell access to container
  npm run docker:sql               Connect to SQL Server CLI in container

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

📊 LOG VIEWING COMMANDS
${'─'.repeat(80)}

  npm run logs                     Show server logs (smart path detection)
  npm run logs:server              Show server logs (explicit)
  npm run logs:audit               Show security audit logs
  npm run logs:tail                Follow server logs in real-time
  npm run logs:tail:server         Follow server logs in real-time
  npm run logs:tail:audit          Follow security audit logs in real-time

💡 Custom File Paths:
  npm run logs -- --file PATH      View logs from custom file path
  npm run logs -- --path PATH      (alias for --file)
  ./scripts/show-logs.sh --help     Detailed help for all options

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
  npm test                         # Quick unit + integration test validation
  npm run test:integration         # ⭐ RECOMMENDED: Full Docker integration testing
  npm run test:integration:performance  # Performance validation
  npm run logs                     # View recent server logs
  npm run logs:tail                # Follow logs in real-time

🧑 Testing & Validation:
  npm run test:integration         # 🚀 Complete integration suite with Docker
  npm run test:coverage            # Full test suite with coverage
  npm run test:integration:ci      # CI testing with external database
  npm run test:unit                # Just unit tests (fast)
  npm run ci                       # Full CI validation

🔧 Maintenance & Quality:
  npm run lint:fix                 # Fix code style issues
  npm run format                   # Format code
  npm run security:audit           # Security validation

📚 Documentation & Release:
  npm run docs:build               # Generate documentation
  npm run links:check              # Validate documentation

💡 TESTING OPTIONS COMPARISON
${'─'.repeat(80)}

🐳 INTEGRATION TESTING (⭐ Recommended for Development):
  npm run test:integration
  • Setup Time: 2-3 minutes (automatic Docker)
  • Prerequisites: Docker only
  • Environment: SQL Server 2022 (standardized)
  • Isolation: Complete (no system pollution)
  • Use for: Development, learning, fast iteration

🔧 CI TESTING (Production Validation):
  npm run test:integration:ci
  • Setup Time: Requires external SQL Server setup
  • Prerequisites: SQL Server installation
  • Environment: Your actual SQL Server version
  • Use for: Production validation, enterprise testing

⚡ PERFORMANCE TESTING:
  npm run test:integration:performance
  • Duration: ~2 seconds
  • Success Rate: 100%  
  • Features: Single persistent process, concurrent testing
  • Use for: Regular validation, CI/CD, development

🔗 WARP INTEGRATION:
  npm run test:integration:warp  
  • Duration: ~10 seconds
  • Success Rate: ~100%
  • Features: Tests against running Warp instance
  • Use for: End-to-end validation

🚀 COMPREHENSIVE TESTING:
  npm run test:integration
  • Duration: ~5-10 minutes (depends on Docker)
  • Coverage: Unit + Integration tests
  • Features: Complete validation across all environments
  • Use for: Pre-release validation, complete confidence

🔍 TROUBLESHOOTING QUICK REFERENCE
${'─'.repeat(80)}

🐳 Docker Test Issues:
  • Container not starting: npm run docker:logs
  • Port 1433 in use: docker ps (check for conflicts)
  • Database not ready: npm run docker:wait
  • Clean reset: npm run docker:clean && npm run docker:start

🔧 Manual Test Failures:
  • Check SQL Server is running: telnet localhost 1433
  • Verify .env configuration
  • Kill orphaned processes: pkill -f "node index.js"

Performance Issues:
  • Use npm run test:integration:performance (current)
  • Check connection pool settings in .env
  • Monitor system resources

Connection Problems:
  • Docker: npm run docker:status && npm run docker:logs
  • Manual: Verify SQL_SERVER_HOST, SQL_SERVER_PORT
  • Check SQL Server TCP/IP enabled
  • Test direct connection: npm run test:integration:performance

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
  • Docker tests require Docker, manual tests require SQL Server
  • Use Docker for development, manual for production validation

🚀 Ready to get started?
  • New contributors: npm run test:integration
  • Quick performance test: npm run test:integration:performance
  • Complete validation: npm run test:integration
  • Production validation: npm run test:integration:ci

`);
