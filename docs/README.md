# 📚 SQL Server MCP Documentation

Welcome to the documentation for the SQL Server MCP (Model Context Protocol) server. This directory contains
everything needed to understand, set up, operate and extend this enterprise-grade database integration tool.

## Where things live

| Folder                          | Audience                               |
| ------------------------------- | -------------------------------------- |
| [`user/`](user)                 | Getting set up and running             |
| [`developer/`](developer)       | Contributing, testing, quality gates   |
| [`operations/`](operations)     | Running, releasing, maintaining        |
| [`architecture/`](architecture) | System design and threat model         |
| [`reference/`](reference)       | Configuration and cloud-secrets lookup |
| [`archive/`](archive)           | Historical, unmaintained               |

New documentation goes in one of these folders — never at the `docs/` root, which holds only this index, the
doc template, and the generated site. Start from [`TEMPLATE.md`](TEMPLATE.md).

## 🚀 User Guides

Getting productive quickly:

- **[Quick Start - Warp Terminal](user/QUICKSTART.md)** - 5-minute setup for Warp Terminal
- **[Quick Start - VS Code](user/QUICKSTART-VSCODE.md)** - 5-minute setup for GitHub Copilot in VS Code
- **[Warp Setup Guide](user/WARP_SETUP_GUIDE.md)** - Detailed Warp Terminal configuration
- **[VS Code Integration Guide](user/VSCODE-INTEGRATION-GUIDE.md)** - Advanced workflows and configuration

## 🏗️ Architecture

System design and security posture:

- **[Architecture Guide](architecture/ARCHITECTURE.md)** - Technical deep-dive and system design
- **[Security Guide](architecture/SECURITY.md)** - Security configuration and threat model

## 📖 Reference

Look-up material:

- **[Environment Variables Reference](reference/ENV-VARS.md)** - Every setting, with examples
- **[AWS Secrets Manager Guide](reference/AWS-SECRETS-GUIDE.md)** - Enterprise credential management
- **[Azure Key Vault Guide](reference/AZURE-SECRETS-GUIDE.md)** - Cloud secret management setup

## 🛠️ Developer

For contributors and maintainers:

- **[Testing Guide](developer/TESTING-GUIDE.md)** - All test categories and how to run them
- **[Testing Structure](developer/TESTING-STRUCTURE.md)** - How the test suite is laid out
- **[Docker Clean Testing](developer/DOCKER-CLEAN-TESTING.md)** - Running tests against a clean container
- **[Integration Test Changes](developer/INTEGRATION-TEST-CHANGES.md)** - Testing methodology and validation
- **[Manual Performance Testing](developer/MANUAL-PERFORMANCE-TESTING.md)** - Performance testing methodology
- **[Debug Logging Guide](developer/DEBUG-LOGGING.md)** - Troubleshooting and debugging
- **[Git Commit Checklist](developer/GIT-COMMIT-CHECKLIST.md)** - Pre-commit quality gates
- **[Git Push Checklist](developer/GIT-PUSH-CHECKLIST.md)** - Pre-push validation
- **[Git Release Checklist](developer/GIT-RELEASE-CHECKLIST.md)** - Release procedure
- **[Quality No-Compromise Case Study](developer/QUALITY-NO-COMPROMISE.md)** - Zero-tolerance quality standards

## ⚙️ Operations

For running and maintaining the server:

- **[Performance Guide](operations/PERFORMANCE.md)** - Monitoring, benchmarks, and optimization
- **[Smoke Test Guide](operations/SMOKE-TEST-GUIDE.md)** - Validation and testing procedures
- **[System Maintenance Guide](operations/MAINTENANCE.md)** - Process cleanup and resource management
- **[Release Token Setup](operations/RELEASE-TOKEN-SETUP.md)** - CI/CD and release configuration
- **[Dependabot Auto-Triage](operations/DEPENDABOT-AUTO-TRIAGE.md)** - Dependency management automation
- **[Apple Silicon Docker](operations/APPLE-SILICON-DOCKER.md)** - Running the test container on arm64

## 📊 API Documentation

- **[API Tools Reference](tools.html)** - Complete MCP tools documentation (16 tools)
- **[Documentation Site](index.html)** - Generated documentation landing page

## 🗄️ Archive

Historical documents, kept for context and no longer maintained — see
**[archive/README.md](archive/README.md)**.

## 🔗 External Resources

- **[Main Project Repository](https://github.com/egarcia74/warp-sql-server-mcp)** - Source code and issues
- **[Live Documentation Site](https://egarcia74.github.io/warp-sql-server-mcp/)** - Always up-to-date web documentation
- **[Complete API Tools Reference](https://egarcia74.github.io/warp-sql-server-mcp/tools.html)** - Interactive API documentation

## 🤝 Contributing

Found an issue with the documentation or want to contribute?

1. Check the [main project README](../README.md) for contribution guidelines
2. Review the [Testing Guide](../test/README.md) for comprehensive test documentation
3. See the [Contributing Guide](../CONTRIBUTING.md) for development workflow
4. Start new documents from [`TEMPLATE.md`](TEMPLATE.md) and place them in the folder that matches the audience

## 📄 Documentation Maintenance

This index is maintained alongside the codebase. When adding new documentation:

1. Copy [`TEMPLATE.md`](TEMPLATE.md) into the folder matching its audience
2. Add it to the appropriate section above with a brief description
3. Update any cross-references as needed
4. Run `npm run markdown:lint` and the link check before committing

---

**💡 Quick Navigation**:

- [Back to Main README](../README.md)
- [Where things live](#where-things-live)
- [Project Overview](../WARP.md)
