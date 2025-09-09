# GitHub Copilot Instructions

## Project Knowledge Base

Always reference the `WARP.md` file as the primary knowledge base for this project. This file contains:

- **Comprehensive project architecture** and component documentation
- **Complete MCP tools reference** with all 16 available database operations
- **Security model details** including the three-tier safety system
- **Performance monitoring capabilities** and optimization tools
- **Configuration patterns** and best practices
- **Authentication methods** and connection management
- **Modular architecture overview** with component relationships

## Key Guidelines

1. **Always consult WARP.md first** when answering questions about:
   - Project architecture and design patterns
   - Available MCP tools and their capabilities
   - Security features and validation systems
   - Performance monitoring and optimization
   - Configuration and setup procedures
   - Database operations and connection management

2. **Reference specific sections** from WARP.md when providing technical guidance

3. **Maintain consistency** with the documented architecture and patterns

4. **Consider the production-ready nature** of this codebase - it has 618+ comprehensive tests with 100% success rates

## File Priority

When providing code assistance:

1. **Primary Reference**: `WARP.md` - Complete technical documentation
2. **Secondary References**:
   - `README.md` - Project overview
   - `docs/QUICKSTART-VSCODE.md` - VS Code setup guide
   - `docs/ARCHITECTURE.md` - Detailed architecture documentation
   - Individual component files in `lib/` directories

## Context Awareness

This is a **production-validated Model Context Protocol (MCP) server** for Microsoft SQL Server integration. Always consider:

- Enterprise-scale deployment requirements
- Security-first approach with graduated safety levels
- Performance optimization and monitoring capabilities
- Modular architecture principles
- Comprehensive testing coverage
