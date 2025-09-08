# Git Push Checklist

> **⚠️ CRITICAL**: This checklist reflects what the automated pre-push hook will run, plus additional manual checks.  
> **🚫 NEVER use `--no-verify` to bypass pre-push hooks - fix the issues instead!**

## 🔄 Automated Pre-Push Checks

### **What the pre-push hook runs automatically:**

- ✅ **Full test suite**: Runs `npm test` with comprehensive test coverage
- ✅ **Test coverage check**: Runs `npm run test:coverage` to verify coverage requirements
- ✅ **Security audit**: Runs `npm audit --audit-level=high` to check for vulnerabilities
- ✅ **ESLint check**: Validates all JavaScript files with `npx eslint .`
- ✅ **Prettier check**: Validates code formatting with `npx prettier --check`
- ✅ **Markdown lint**: Validates all markdown files with `npx markdownlint-cli2`
- ✅ **Link checking**: Checks for dead links in markdown files

_These happen automatically when you `git push` - push will be blocked if any fail!_

## 🚨 **PRE-PUSH HOOK FAILURES**

### **If pre-push hooks fail:**

1. **🛠️ Fix the issues** - don't bypass them!
2. **Use available fix commands**:
   - `npm run lint:fix` - Fix ESLint issues
   - `npm run format` - Fix formatting issues
   - `npm run markdown:fix` - Fix markdown issues
   - `npm run test:unit` - Run and fix failing tests
   - `npm run security:audit` - Address security vulnerabilities
3. **Re-commit and push** after fixes
4. **🚫 NEVER use `git push --no-verify`** - this violates our quality standards
5. **🚫 NEVER use `--force` to override failures** - fix the root cause instead

## 📋 Manual Pre-Push Verification

### 1. **Final Quality Checks** (recommended for major changes)

- [ ] **Run full CI locally**: `npm run ci`
- [ ] **Integration tests**: `npm run test:integration`
  - [ ] Verify all 3 security phases show SUCCESS (40/40 tests)
- [ ] **Performance validation**: `npm run test:integration:performance`

### 1a. **Enterprise Quality Gates** (for production-critical changes)

- [ ] **Security & Compliance Assessment**:
  - [ ] **Dependency security**: `npm run security:audit` (no high/critical vulnerabilities)
  - [ ] **Code security**: Review for secrets, hardcoded credentials, or sensitive data exposure
  - [ ] **SQL injection protection**: Verify query parameterization in new database operations
  - [ ] **Access control**: Confirm proper authentication/authorization in new endpoints
  - [ ] **Input validation**: Check all user inputs are properly validated and sanitized

- [ ] **Observability & Monitoring**:
  - [ ] **Logging coverage**: Ensure adequate logging for new features and error paths
  - [ ] **Performance monitoring**: Verify performance-critical paths have proper instrumentation
  - [ ] **Error handling**: Confirm comprehensive error handling with proper logging
  - [ ] **Debug information**: Ensure debug logs provide sufficient troubleshooting context

- [ ] **Production Readiness**:
  - [ ] **Configuration**: Update `.env.example` for new environment variables
  - [ ] **Backward compatibility**: Verify changes don't break existing integrations
  - [ ] **Database schema**: Review any database schema changes for migration safety
  - [ ] **API compatibility**: Ensure MCP tool interfaces remain stable
  - [ ] **Resource utilization**: Consider memory, CPU, and connection pool impacts

### 2. **Branch & Remote Verification**

- [ ] **Verify current branch**: `git branch` (confirm you're on the right branch)
- [ ] **Check remote**: `git remote -v` (verify pushing to correct repository)
- [ ] **Check ahead/behind**: `git status` (check if you need to pull first)
- [ ] **Branch naming**: Verify branch follows naming convention (feature/, fix/, docs/, etc.)
- [ ] **Upstream tracking**: Confirm proper upstream branch configuration

### 3. **Change Impact Assessment**

- [ ] **Scope analysis**: Review the scale and impact of changes being pushed
- [ ] **Breaking changes**: Identify any breaking changes and update semantic versioning
- [ ] **Feature flags**: Consider if changes need feature flags for gradual rollout
- [ ] **Database impact**: Assess if changes affect database schema or require migrations
- [ ] **Performance impact**: Evaluate if changes affect critical performance paths
- [ ] **Security impact**: Review if changes affect security boundaries or access control

### 4. **Documentation Impact Assessment**

- [ ] **Check for documentation changes**: `git diff --name-only origin/main...HEAD | grep -E '\.(md)$'`
- [ ] **Review documentation consistency**:
  - [ ] **README.md**: Update if features, installation, or usage changed
  - [ ] **WARP.md**: Update if MCP tools, architecture, or development workflow changed
  - [ ] **CHANGELOG.md**: Add entries for user-facing changes
  - [ ] **Related docs**: Check if changes affect other documentation files
- [ ] **Assess broader documentation needs**:
  - [ ] Do API changes require docs/tools.html regeneration?
  - [ ] Do new environment variables need ENV-VARS.md updates?
  - [ ] Do architectural changes need WARP.md updates?
  - [ ] Do new features need example usage documentation?
- [ ] **Documentation quality**:
  - [ ] **Accuracy**: Ensure all documentation accurately reflects code changes
  - [ ] **Completeness**: Verify all user-facing changes are documented
  - [ ] **Examples**: Update code examples if interfaces changed
  - [ ] **Migration guides**: Add migration notes for breaking changes

### 5. **Commit History Review**

- [ ] **Review commits**: `git log --oneline -5` (check recent commits)
- [ ] **Verify commit messages**: Ensure they follow conventional commit format
- [ ] **Check for merge conflicts**: Ensure clean merge state
- [ ] **Squash consideration**: Evaluate if commits should be squashed before push
- [ ] **Sensitive data check**: Verify no secrets, keys, or sensitive data in commit history
- [ ] **Commit granularity**: Ensure commits are atomic and logically grouped

### 6. **Pre-Push Integration Validation**

- [ ] **Local integration test**: Run full integration test suite locally
- [ ] **Docker environment**: Test in clean Docker environment if available
- [ ] **Database state**: Verify database migrations and schema changes work correctly
- [ ] **Environment compatibility**: Test against different Node.js versions if critical
- [ ] **Cross-platform**: Consider platform-specific issues (Windows/macOS/Linux)

## 🚀 Push Process

### 7. **Push Commands**

```bash
# Standard push to feature branch
git push origin feature/your-feature-name

# Push to main (use with caution)
git push origin main

# Force push (use very carefully!)
git push --force-with-lease origin feature/your-feature-name

# Push with tags
git push origin main --tags
```

### 8. **First-time push** (new branch)

```bash
# Set upstream and push
git push -u origin feature/your-feature-name
```

## 🔍 Post-Push Validation

### 9. **Verify Push Success**

- [ ] **Check GitHub**: Confirm commit appears in the repository
- [ ] **Monitor CI/CD**: Watch GitHub Actions for any pipeline failures
- [ ] **Check status checks**: Ensure all required checks pass
- [ ] **Branch protection**: Verify push respects branch protection rules
- [ ] **Deployment status**: Monitor if push triggers deployments

### 10. **Pull Request** (if pushing to feature branch)

- [ ] **Create PR**: From your feature branch to main/develop
- [ ] **Add clear title**: Use conventional commit format if applicable
- [ ] **Write description**: Explain what was changed and why
- [ ] **Link issues**: Reference any related GitHub issues
- [ ] **Request reviewers**: Add appropriate team members
- [ ] **Add labels**: Apply relevant labels (bug, feature, etc.)
- [ ] **Add milestone**: Link to appropriate project milestone if applicable
- [ ] **Reviewability**: Ensure PR size is reasonable for effective review
- [ ] **Testing instructions**: Provide clear testing steps for reviewers

## ⚠️ Push Troubleshooting

### Common Issues & Solutions

**Push rejected due to failed hooks:**

```bash
# If tests fail
npm test                     # Fix failing tests
git commit -m "fix: resolve test failures"

# If linting fails
npm run lint:fix            # Auto-fix linting issues
git add .
git commit -m "style: fix linting issues"

# If formatting fails
npm run format              # Auto-format code
git add .
git commit -m "style: apply code formatting"

# If security audit fails
npm audit fix               # Fix security vulnerabilities
git add package*.json
git commit -m "fix: update dependencies to resolve security vulnerabilities"
```

**Push rejected (non-fast-forward):**

```bash
# Pull latest changes first
git pull origin main
# Resolve conflicts if any
git push origin main
```

**Push rejected (branch protection rules):**

- Create a pull request instead of pushing directly
- Ensure all required status checks pass
- Get required reviews before merging

## 🔧 Advanced Push Options

### Force Push (Use with extreme caution!)

```bash
# Safer force push (won't overwrite others' work)
git push --force-with-lease origin feature/your-branch

# Nuclear option (dangerous!)
git push --force origin feature/your-branch
```

### Push Specific Commits

```bash
# Push up to specific commit
git push origin commit-hash:branch-name

# Push specific range
git push origin HEAD~3:branch-name
```

## 📊 Quality Gate Summary

### Pre-Push Hook Checklist

The automated pre-push hook will verify:

1. ✅ **All tests pass** (`npm test`)
2. ✅ **Coverage requirements met** (`npm run test:coverage`)
3. ✅ **No security vulnerabilities** (`npm audit --audit-level=high`)
4. ✅ **Code quality standards** (ESLint)
5. ✅ **Code formatting** (Prettier)
6. ✅ **Documentation quality** (Markdown lint)
7. ✅ **No dead links** (Link checker)

### Manual Verification Before Major Pushes

- [ ] **Integration tests pass**: `npm run test:integration`
- [ ] **Performance tests pass**: `npm run test:integration:performance`
- [ ] **Documentation consistency**: Complete Documentation Impact Assessment (Section 4)
- [ ] **Environment variables**: `.env.example` updated if needed
- [ ] **Security validation**: Complete Security & Compliance Assessment (Section 1a)
- [ ] **Change impact review**: Complete Change Impact Assessment (Section 3)
- [ ] **Database compatibility**: Verify database schema changes are backward compatible
- [ ] **MCP protocol compliance**: Ensure MCP tool interfaces remain stable and compliant

## 🔧 Commands Quick Reference

```bash
# Push operations
git push origin [branch]              # Standard push
git push -u origin [branch]          # Set upstream and push
git push --force-with-lease origin [branch] # Safe force push
git push origin --tags               # Push tags

# Pre-push validation
npm run ci                           # Full CI pipeline
npm test                            # Quick test run
npm run test:integration            # Integration tests
npm run test:coverage               # Coverage check
npm run security:audit             # Security audit

# Branch management
git branch -vv                      # Show local branches with tracking
git remote -v                       # Show remotes
git status                         # Check current state
git log --oneline -5               # Recent commits

# Documentation checks
git diff --name-only origin/main...HEAD | grep -E '\.(md)$' # Check for doc changes

# Quality gates for enterprise deployments
npm run test:integration:performance # Performance validation
npm audit --audit-level=high       # High-severity vulnerability check
npm run lint                       # Code quality validation
npm run format:check               # Code formatting check

# Change impact analysis
git diff --stat origin/main...HEAD # Summary of changes
git diff --name-only origin/main...HEAD # Files changed
git log --oneline origin/main...HEAD # Commits being pushed
```

---

## 🏆 Ready to push when all checks pass! 🚀
