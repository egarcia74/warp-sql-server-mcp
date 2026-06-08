# Graph Report - .  (2026-06-08)

## Corpus Check
- 170 files · ~345,492 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1094 nodes · 1418 edges · 94 communities (64 shown, 30 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.87)
- Token cost: 18,500 input · 3,200 output

## Community Hubs (Navigation)
- [[_COMMUNITY_npm Scripts & Build Tasks|npm Scripts & Build Tasks]]
- [[_COMMUNITY_MCP Config Env Variables|MCP Config Env Variables]]
- [[_COMMUNITY_Architecture Concepts & Docs|Architecture Concepts & Docs]]
- [[_COMMUNITY_Server Configuration Module|Server Configuration Module]]
- [[_COMMUNITY_Server Config Template|Server Config Template]]
- [[_COMMUNITY_Docker Command Utilities|Docker Command Utilities]]
- [[_COMMUNITY_Base Tool Handler|Base Tool Handler]]
- [[_COMMUNITY_Query Optimizer & Analysis|Query Optimizer & Analysis]]
- [[_COMMUNITY_Design Principles & Concepts|Design Principles & Concepts]]
- [[_COMMUNITY_Main MCP Server Entry|Main MCP Server Entry]]
- [[_COMMUNITY_Audit CI Configuration|Audit CI Configuration]]
- [[_COMMUNITY_Performance Monitor|Performance Monitor]]
- [[_COMMUNITY_MCP Security Tests|MCP Security Tests]]
- [[_COMMUNITY_Logger Module & Tests|Logger Module & Tests]]
- [[_COMMUNITY_Test Fixtures & Mocks|Test Fixtures & Mocks]]
- [[_COMMUNITY_Shell Utility Scripts|Shell Utility Scripts]]
- [[_COMMUNITY_Warp MCP Config|Warp MCP Config]]
- [[_COMMUNITY_Response Formatter|Response Formatter]]
- [[_COMMUNITY_Bottleneck Detector|Bottleneck Detector]]
- [[_COMMUNITY_CICD Security Workflows|CI/CD Security Workflows]]
- [[_COMMUNITY_Dev Dependencies|Dev Dependencies]]
- [[_COMMUNITY_Package Metadata|Package Metadata]]
- [[_COMMUNITY_Connection Manager Core|Connection Manager Core]]
- [[_COMMUNITY_Docker Test Phase Docs|Docker Test Phase Docs]]
- [[_COMMUNITY_Docs Extraction Scripts|Docs Extraction Scripts]]
- [[_COMMUNITY_Manual Performance Tests|Manual Performance Tests]]
- [[_COMMUNITY_Markdown Lint Config|Markdown Lint Config]]
- [[_COMMUNITY_Protocol Smoke Tests|Protocol Smoke Tests]]
- [[_COMMUNITY_SQL Query Validator|SQL Query Validator]]
- [[_COMMUNITY_Database Connection Manager|Database Connection Manager]]
- [[_COMMUNITY_Markdown Link Checker|Markdown Link Checker]]
- [[_COMMUNITY_Protocol Server Startup Tests|Protocol Server Startup Tests]]
- [[_COMMUNITY_Tool Registry|Tool Registry]]
- [[_COMMUNITY_CLI Entry Point|CLI Entry Point]]
- [[_COMMUNITY_Docker DB Wait Script|Docker DB Wait Script]]
- [[_COMMUNITY_GitHub Link Check Config|GitHub Link Check Config]]
- [[_COMMUNITY_Database Tools Handler|Database Tools Handler]]
- [[_COMMUNITY_Cloud Dependencies AWSAzure|Cloud Dependencies AWS/Azure]]
- [[_COMMUNITY_Spell Check Config|Spell Check Config]]
- [[_COMMUNITY_GitHub Security Metrics|GitHub Security Metrics]]
- [[_COMMUNITY_Warp MCP Performance Tests|Warp MCP Performance Tests]]
- [[_COMMUNITY_Protocol Test Docs|Protocol Test Docs]]
- [[_COMMUNITY_Docker Platform Detection|Docker Platform Detection]]
- [[_COMMUNITY_Docker Test Setup Docs|Docker Test Setup Docs]]
- [[_COMMUNITY_GitHub Spell Check|GitHub Spell Check]]
- [[_COMMUNITY_Docker Test Runner Script|Docker Test Runner Script]]
- [[_COMMUNITY_Continue.dev Config|Continue.dev Config]]
- [[_COMMUNITY_Stress Testing Suite|Stress Testing Suite]]
- [[_COMMUNITY_Manual & Protocol Tests|Manual & Protocol Tests]]
- [[_COMMUNITY_Test Architecture Docs|Test Architecture Docs]]
- [[_COMMUNITY_Archived Test Mocks|Archived Test Mocks]]
- [[_COMMUNITY_Continue.dev & Feature Docs|Continue.dev & Feature Docs]]
- [[_COMMUNITY_Docker DB Init|Docker DB Init]]
- [[_COMMUNITY_Tools Data Output|Tools Data Output]]
- [[_COMMUNITY_HTML Docs Generator|HTML Docs Generator]]
- [[_COMMUNITY_Docs Workflow|Docs Workflow]]
- [[_COMMUNITY_MCP Server Config File|MCP Server Config File]]
- [[_COMMUNITY_GitHub Label Automation|GitHub Label Automation]]
- [[_COMMUNITY_Backlog Issue Scripts|Backlog Issue Scripts]]
- [[_COMMUNITY_Test Setup & Mocks|Test Setup & Mocks]]
- [[_COMMUNITY_Backlog Link Updater|Backlog Link Updater]]
- [[_COMMUNITY_Apple Silicon Docker Docs|Apple Silicon Docker Docs]]
- [[_COMMUNITY_Dependabot Auto-Triage|Dependabot Auto-Triage]]
- [[_COMMUNITY_Windows stdio Fix|Windows stdio Fix]]
- [[_COMMUNITY_Package Overrides|Package Overrides]]
- [[_COMMUNITY_CLI Tests|CLI Tests]]
- [[_COMMUNITY_AI Agent Instructions|AI Agent Instructions]]
- [[_COMMUNITY_Docker Apple Silicon Scripts|Docker Apple Silicon Scripts]]
- [[_COMMUNITY_Git Hooks Installer|Git Hooks Installer]]
- [[_COMMUNITY_Test Process Cleanup|Test Process Cleanup]]
- [[_COMMUNITY_Detailed Log Viewer|Detailed Log Viewer]]
- [[_COMMUNITY_Pretty Log Script|Pretty Log Script]]
- [[_COMMUNITY_Full Log Viewer|Full Log Viewer]]
- [[_COMMUNITY_Server Log Viewer|Server Log Viewer]]
- [[_COMMUNITY_Test Summary Script|Test Summary Script]]
- [[_COMMUNITY_Bug Report Template|Bug Report Template]]
- [[_COMMUNITY_Issue Template Config|Issue Template Config]]
- [[_COMMUNITY_PR Template|PR Template]]
- [[_COMMUNITY_Question Template|Question Template]]
- [[_COMMUNITY_Test Verbosity Control|Test Verbosity Control]]
- [[_COMMUNITY_Test Server v4 Fixture|Test Server v4 Fixture]]
- [[_COMMUNITY_Test Mock Fixtures|Test Mock Fixtures]]
- [[_COMMUNITY_Shared Test Mocks|Shared Test Mocks]]

## God Nodes (most connected - your core abstractions)
1. `scripts` - 69 edges
2. `env` - 64 edges
3. `env` - 45 edges
4. `SqlServerMCP` - 43 edges
5. `QueryOptimizer` - 37 edges
6. `PerformanceMonitor` - 28 edges
7. `ServerConfig` - 24 edges
8. `Logger` - 23 edges
9. `StreamingHandler` - 19 edges
10. `BottleneckDetector` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Supply Chain Security (Pinned Actions, OSSF Scorecard)` --semantically_similar_to--> `Defense in Depth Security Architecture`  [INFERRED] [semantically similar]
  .github/workflows/scorecard.yml → MANIFESTO.md
- `generateToolsDocumentation()` --calls--> `execSync()`  [INFERRED]
  scripts/docs/extract-docs.js → test/docker/developer-stress-test.js
- `GitHub Actions: Deploy Documentation to GitHub Pages` --conceptually_related_to--> `MCP (Model Context Protocol) Server`  [INFERRED]
  .github/workflows/pages.yml → README.md
- `GitHub Actions: Performance Monitoring Workflow` --implements--> `Performance Monitoring & Query Optimization`  [EXTRACTED]
  .github/workflows/performance.yml → WARP.md
- `AGENTS.md - AI Agent Knowledge Directives` --references--> `WARP.md - Primary AI Context / Architecture Guide`  [EXTRACTED]
  AGENTS.md → WARP.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Dependabot Dependency Automation Pipeline** — dependabot_yml_dependabot_config, dependabot_auto_merge_yml_auto_merge_workflow, dependabot_retriage_yml_retriage_workflow, dependabot_md_dependabot_pr_template [INFERRED 0.95]
- **GitHub Security Scanning Suite** — codeql_yml_codeql_workflow, codeql_config_yml_codeql_config, security_md_codeql_ossf, security_md_security_policy [INFERRED 0.95]
- **PR and Issue Automation Suite** — auto_label_yml_auto_label_workflow, issue_labeler_yml_issue_labeler_config, labeler_yml_pr_labeler_config, auto_assign_yml_auto_assign_config [EXTRACTED 1.00]
- **Enterprise Software Framework Core Pillars** — concept_tdd_practice, concept_observability, concept_defense_in_depth, concept_secure_defaults, concept_enterprise_grade_framework [EXTRACTED 1.00]
- **CI/CD Security Pipeline (Scorecard + Triage + Performance)** — workflows_scorecard_yml, workflows_security_triage_yml, workflows_performance_yml, concept_supply_chain_security, concept_dependabot_auto_triage [INFERRED 0.85]
- **Auto Config Detection: ConfigDetector reads PerformanceMonitor, ServerConfig, ConnectionManager** — concept_config_detector, concept_performance_monitoring, concept_three_tier_safety, concept_secret_management [EXTRACTED 1.00]
- **Three-Tier Security Validation Pipeline (Security System + Integration Tests + Query Validation)** — docs_security_three_tier_system, docs_integration_test_changes_phase1, docs_integration_test_changes_phase2, docs_integration_test_changes_phase3, docs_security_query_validation_engine [EXTRACTED 1.00]
- **Quality Gate Enforcement System (Pre-Commit Hooks + Pre-Push Hooks + No-Compromise Quality Gates)** — docs_git_commit_checklist_precommit_hooks, docs_git_push_checklist_prepush_hooks, docs_quality_no_compromise_quality_gates, docs_git_commit_checklist, docs_git_push_checklist [EXTRACTED 1.00]
- **Performance Monitoring Stack (PerformanceMonitor + Connection Pool + Environment Config)** — docs_performance_performance_monitor, docs_env_vars_connection_pool, docs_performance_health_algorithm, docs_manual_performance_testing_improved_test [INFERRED 0.85]
- **Three-Phase Security Validation System** — manual_readme_phase1_readonly_security_test, manual_readme_phase2_dml_operations_test, manual_readme_phase3_ddl_operations_test, test_readme_three_tier_safety_system [EXTRACTED 1.00]
- **Docker Platform Detection and Configuration Pipeline** — docker_platform_detection_detect_platform_js, docker_platform_detection_platform_config_json, docker_platform_detection_docker_compose_yml, docker_platform_detection_intelligent_platform_detection [EXTRACTED 1.00]
- **Layered Test Architecture (Unit, Integration, Protocol)** — test_readme_unit_tests, manual_readme_manual_integration_tests, protocol_readme_mcp_protocol_tests, docker_readme_docker_testing_setup [INFERRED 0.85]

## Communities (94 total, 30 thin omitted)

### Community 0 - "npm Scripts & Build Tasks"
Cohesion: 0.03
Nodes (69): scripts, audit:fix, ci, clean, cleanup, cleanup:processes, dev, docker:clean (+61 more)

### Community 1 - "MCP Config Env Variables"
Cohesion: 0.03
Nodes (64): _AWS_REGION, _AZURE_KEY_VAULT_URL, _comment_logging, _comment_optional, _comment_performance, _comment_pool, _comment_required, _comment_secrets (+56 more)

### Community 2 - "Architecture Concepts & Docs"
Cohesion: 0.06
Nodes (61): AWS Secrets Manager Integration, Azure Key Vault Integration, Conservative Security Approach for SSL Certificate Trust, Docker-based Testing Infrastructure, GitHub Actions CI/CD Pipeline, GitHub Copilot in VS Code (MCP integration), Intelligent Streaming for Large Datasets, Model Context Protocol (MCP) (+53 more)

### Community 3 - "Server Configuration Module"
Cohesion: 0.05
Nodes (13): __dirname, __filename, packageJson, packageJsonPath, ServerConfig, DirectMcpTest, test, DmlOperationsTest (+5 more)

### Community 4 - "Server Config Template"
Cohesion: 0.04
Nodes (45): AWS_REGION, AZURE_KEY_VAULT_URL, _comment_basic, _comment_logging, _comment_performance, _comment_pool, _comment_response, _comment_safety (+37 more)

### Community 5 - "Docker Command Utilities"
Cohesion: 0.08
Nodes (34): buildMergedEnv(), NODE_BIN, parseCommandArguments(), SAFE_PATH, checkDockerCapabilities(), chooseBestConfiguration(), CONFIG_TEMPLATES, detectArchitecture() (+26 more)

### Community 6 - "Base Tool Handler"
Cohesion: 0.07
Nodes (13): BaseToolHandler, CSV_BATCH_OUTPUT, CSV_FIRST_ROW_OUTPUT, CSV_HEADER_OUTPUT, CSV_NULL_VALUES_OUTPUT, CSV_SECOND_ROW_OUTPUT, CSV_THIRD_ROW_OUTPUT, ESCAPED_NEWLINE (+5 more)

### Community 8 - "Design Principles & Concepts"
Cohesion: 0.11
Nodes (36): ConfigDetector Class (Planned: lib/config/config-detector.js), Conventional Commits Format, Defense in Depth Security Architecture, detect_optimal_config MCP Tool (Planned Feature), Enterprise-Grade Software Framework Vision, MCP (Model Context Protocol) Server, Modular Architecture (lib/ modules, v1.7.0+), Observability by Design (Logging, Metrics, Audit) (+28 more)

### Community 10 - "Audit CI Configuration"
Cohesion: 0.07
Nodes (27): advisories, allowlist, denylist, exclude, 1002, 1003, levels, critical (+19 more)

### Community 12 - "MCP Security Tests"
Cohesion: 0.12
Nodes (16): addCompatibilityMethods(), addSecurityPropertyOverrides(), createTestMcpServer(), createTestMcpServerV3(), createTestMcpServerV4(), csvTestData, getDefaultTestEnv(), hoistedMocks (+8 more)

### Community 14 - "Test Fixtures & Mocks"
Cohesion: 0.20
Nodes (15): cleanupMocks(), createMockConnectionManager(), createMockMcpServer(), createMockPerformanceMonitor(), createMockPool(), createMockRequest(), createTestEnvironment(), expectToolError() (+7 more)

### Community 15 - "Shell Utility Scripts"
Cohesion: 0.12
Nodes (17): show-logs.sh script, BLUE, CYAN, format_log_entry(), get_log_path(), GRAY, GREEN, indent_text() (+9 more)

### Community 16 - "Warp MCP Config"
Cohesion: 0.11
Nodes (17): _config_docs, _config_footer, _config_header, _config_note, _config_title, mcpServers, sql-server, args (+9 more)

### Community 19 - "CI/CD Security Workflows"
Cohesion: 0.15
Nodes (16): CI Workflow, Codacy MCP Server AI Instructions, CodeQL Analysis Configuration, CodeQL Security Scanning Workflow, Dependabot Auto-Merge Decision Policy, Dependabot Auto-Merge Workflow, Dependabot PR Template, Dependabot Re-Triage Workflow (+8 more)

### Community 20 - "Dev Dependencies"
Cohesion: 0.12
Nodes (16): devDependencies, eslint, eslint-config-prettier, @eslint/js, markdownlint-cli2, prettier, sinon, @types/node (+8 more)

### Community 21 - "Package Metadata"
Cohesion: 0.13
Nodes (14): author, bin, warp-sql-server-mcp, description, engines, node, keywords, license (+6 more)

### Community 22 - "Connection Manager Core"
Cohesion: 0.16
Nodes (5): __dirname, packageJson, __dirname, packageJson, createMockMcpServer()

### Community 23 - "Docker Test Phase Docs"
Cohesion: 0.19
Nodes (13): Phase 1 Read-Only Security Database, Phase 2 DML Operations Database, Phase 3 DDL Operations Database, Phase 1 Read-Only Security Test (20 tests), Phase 2 DML Operations Test (10 tests), Phase 3 DDL Operations Test (10 tests), DDL Schema Change Restrictions, DML Operations Restrictions (+5 more)

### Community 24 - "Docs Extraction Scripts"
Cohesion: 0.24
Nodes (10): extractToolArrays(), extractToolsFromCode(), generateToolsDocumentation(), getPackageVersion(), parseIndividualTool(), parseInputSchemaProperties(), parseRequiredFields(), parseToolArray() (+2 more)

### Community 26 - "Markdown Lint Config"
Cohesion: 0.17
Nodes (11): default, MD013, code_block_line_length, heading_line_length, line_length, tables, MD031, MD032 (+3 more)

### Community 27 - "Protocol Smoke Tests"
Cohesion: 0.21
Nodes (4): __dirname, __filename, smokeTest, SmokeTestClient

### Community 30 - "Markdown Link Checker"
Cohesion: 0.20
Nodes (9): aliveStatusCodes, fallbackRetryDelay, httpHeaders, ignorePatterns, replacementPatterns, retryCount, retryOn429, timeout (+1 more)

### Community 31 - "Protocol Server Startup Tests"
Cohesion: 0.24
Nodes (4): __dirname, __filename, MCPServerStartupTest, startupTest

### Community 32 - "Tool Registry"
Cohesion: 0.22
Nodes (8): ANALYSIS_TOOLS, CONNECTION_TOOLS, DATA_TOOLS, DATABASE_TOOLS, getAllTools(), getTool(), OPTIMIZATION_TOOLS, PERFORMANCE_TOOLS

### Community 33 - "CLI Entry Point"
Cohesion: 0.25
Nodes (5): CONFIG_FILE, __dirname, EXAMPLE_CONFIG, loadConfigToEnv(), startServer()

### Community 34 - "Docker DB Wait Script"
Cohesion: 0.28
Nodes (5): config, main(), sleep(), timing, _waitForDatabase()

### Community 35 - "GitHub Link Check Config"
Cohesion: 0.22
Nodes (8): aliveStatusCodes, fallbackRetryDelay, httpHeaders, ignorePatterns, replacementPatterns, retryCount, retryOn429, timeout

### Community 37 - "Cloud Dependencies AWS/Azure"
Cohesion: 0.22
Nodes (9): dependencies, aws-sdk, @azure/identity, @azure/keyvault-secrets, dotenv, @modelcontextprotocol/sdk, mssql, node-sql-parser (+1 more)

### Community 38 - "Spell Check Config"
Cohesion: 0.25
Nodes (7): flagWords, ignorePaths, language, overrides, $schema, version, words

### Community 39 - "GitHub Security Metrics"
Cohesion: 0.25
Nodes (7): auto_merge_enabled, dependabot_config_version, last_config_update, last_updated, next_scan, open_alerts, status

### Community 41 - "Protocol Test Docs"
Cohesion: 0.25
Nodes (8): JSON-RPC Message Serialization, mcp-client-smoke-test.js, @modelcontextprotocol/sdk, stdio Transport Communication, MCP Client Smoke Test (JS file reference), test-database-helper.js, Test Output Improvements Tracking, Test Isolation Strategy

### Community 42 - "Docker Platform Detection"
Cohesion: 0.29
Nodes (7): Platform Detection MCP Benefit, Azure SQL Edge (ARM64 Fallback), detect-platform.js, docker-compose.yml (generated), Intelligent Platform Detection System, .platform-config.json, Rosetta 2 Emulation for Apple Silicon

### Community 43 - "Docker Test Setup Docs"
Cohesion: 0.33
Nodes (7): Docker Testing Setup, Docker vs Manual Testing Trade-off, .env.docker Environment Config, init-db.sql Database Initialization Script, npm run test:integration Command, wait-for-db.js Readiness Script, WarpMcpTest Database

### Community 44 - "GitHub Spell Check"
Cohesion: 0.29
Nodes (6): flagWords, ignorePaths, language, overrides, version, words

### Community 45 - "Docker Test Runner Script"
Cohesion: 0.48
Nodes (6): docker-test-runner.sh script, MCP_TESTING_MODE, print_error(), print_info(), print_success(), print_warning()

### Community 46 - "Continue.dev Config"
Cohesion: 0.33
Nodes (5): contextProviders, customContext, embeddingsProvider, provider, systemMessage

### Community 47 - "Stress Testing Suite"
Cohesion: 0.40
Nodes (6): Comprehensive Stress Test (5-10 minutes), Quick Stress Test (30 seconds), .stress-test-results.json, Platform Detection Stress Testing Guide, Developer Test (npm run docker:test), Two-Tier Testing System Summary

### Community 48 - "Manual & Protocol Tests"
Cohesion: 0.33
Nodes (6): Manual Integration Tests, Manual-Only CI/CD Exclusion Rationale, serverConfig.reload() Configuration Reload, MCP Protocol Tests, mcp-protocol-validation.test.js, Warp Terminal MCP Client

### Community 49 - "Test Architecture Docs"
Cohesion: 0.33
Nodes (6): MCP Shared Test Fixtures, Test Mock Strategy, Modular Test Organization, Test Directory Documentation, Unit Test Suite, Vitest Test Framework

### Community 50 - "Archived Test Mocks"
Cohesion: 0.40
Nodes (4): mockPool, mockRequest, mockStdioTransport, testData

### Community 51 - "Continue.dev & Feature Docs"
Cohesion: 0.40
Nodes (5): Continue IDE Config, Continue Semantic Search (Local Embeddings), WARP.md Knowledge Document, Feature Request Backlog Template (Markdown), Feature Request Issue Template (YAML)

### Community 52 - "Docker DB Init"
Cohesion: 0.50
Nodes (4): config, envPath, initDb(), splitSqlBatches()

### Community 53 - "Tools Data Output"
Cohesion: 0.40
Nodes (4): generatedAt, tools, toolsCount, version

### Community 54 - "HTML Docs Generator"
Cohesion: 0.60
Nodes (3): generateExamples(), generateParametersTable(), generateToolSection()

### Community 55 - "Docs Workflow"
Cohesion: 0.40
Nodes (5): Documentation Automation Workflow, scripts/docs/extract-docs.js, scripts/docs/generate-landing-page.js, scripts/docs/generate-tools-html.js, MCP Tool Documentation Validation

### Community 56 - "MCP Server Config File"
Cohesion: 0.40
Nodes (4): sql-server, args, command, working_directory

### Community 57 - "GitHub Label Automation"
Cohesion: 0.67
Nodes (4): Auto-Assign Reviewers Config, Auto Label PRs and Issues Workflow, Issue Auto-Labeler Config, PR File-Based Labeler Config

### Community 58 - "Backlog Issue Scripts"
Cohesion: 0.83
Nodes (3): check_issue_exists(), create_issue_if_new(), create-backlog-issues.sh script

### Community 59 - "Test Setup & Mocks"
Cohesion: 0.50
Nodes (3): mockPool, mockRequest, sqlMock

### Community 61 - "Apple Silicon Docker Docs"
Cohesion: 0.67
Nodes (3): Apple Silicon Docker Platform Detection & Rosetta 2 Emulation, Apple Silicon Docker SQL Server Troubleshooting Guide, Docker Clean Flag Testing Guide

### Community 62 - "Dependabot Auto-Triage"
Cohesion: 1.00
Nodes (3): Dependabot Auto-Triage and Auto-Merge System, Dependabot Auto-Triage System Documentation, GitHub Actions: Security Alert Triage Workflow

### Community 63 - "Windows stdio Fix"
Cohesion: 0.67
Nodes (3): MCP stdio Transport, Release Notes v1.7.12, Windows stdio Handshake Fix (CLI startup banners to stderr in MCP/stdio environments)

### Community 65 - "Package Overrides"
Cohesion: 0.67
Nodes (3): overrides, flatted, smol-toml

## Knowledge Gaps
- **452 isolated node(s):** `allowlist`, `denylist`, `low`, `moderate`, `high` (+447 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Logger` connect `Logger Module & Tests` to `Docker Command Utilities`, `Connection Manager Core`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `execSync()` connect `Docker Command Utilities` to `Docs Extraction Scripts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `QueryOptimizer` connect `Query Optimizer & Analysis` to `Connection Manager Core`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `allowlist`, `denylist`, `low` to the rest of the system?**
  _461 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `npm Scripts & Build Tasks` be split into smaller, more focused modules?**
  _Cohesion score 0.028985507246376812 - nodes in this community are weakly interconnected._
- **Should `MCP Config Env Variables` be split into smaller, more focused modules?**
  _Cohesion score 0.03125 - nodes in this community are weakly interconnected._
- **Should `Architecture Concepts & Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.05628415300546448 - nodes in this community are weakly interconnected._