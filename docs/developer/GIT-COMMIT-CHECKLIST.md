# Git Commit Checklist

> **⚠️ CRITICAL**: This checklist reflects what the automated git hooks will run, plus additional manual checks.  
> **🚫 NEVER use `--no-verify` to bypass pre-commit hooks - fix the issues instead!**

## 🔄 Automated Pre-Commit Checks

### **What the pre-commit hook runs automatically:**

- ✅ **ESLint --fix**: Automatically fixes JavaScript linting issues
- ✅ **Prettier --write**: Automatically formats code (JS, JSON, MD files)
- ✅ **Markdownlint --fix**: Automatically fixes markdown issues
- ✅ **Quick test suite**: Runs `npm test` to ensure no broken tests

_These happen automatically when you `git commit` - no manual action needed!_

## 🚨 **PRE-COMMIT HOOK FAILURES**

### **If pre-commit hooks fail:**

1. **🛠️ Fix the issues** - don't bypass them!
2. **Use available fix commands**:
   - `npm run lint:fix` - Fix ESLint issues
   - `npm run format` - Fix formatting issues
   - `npm run markdown:fix` - Fix markdown issues
   - Manually fix remaining issues that can't be auto-fixed
3. **Re-stage and commit** after fixes
4. **🚫 NEVER use `--no-verify`** - this violates our quality standards

### **Common markdown linting issues:**

- **Fenced code blocks**: Add language specification (``bash`,``json`, ````text`)
- **Line length**: Break long lines (max 200 characters)
- **Trailing spaces**: Remove trailing whitespace
- **Heading hierarchy**: Ensure proper heading increments (h1 → h2 → h3)
- **Duplicate headings**: Make headings unique within document

## 📋 Manual Pre-Commit Verification

### 1. **Development Checks** (if making significant changes)

- [ ] **Run comprehensive tests**: `npm run test:coverage`
- [ ] **Run integration tests**: `npm run test:integration`
- [ ] **Check for vulnerabilities**: `npm run security:audit`

### 2. **Code Quality & Standards**

- [ ] **Type safety**: Verify JSDoc comments for complex functions
- [ ] **Error handling**: Ensure proper error handling and logging
- [ ] **Performance impact**: Consider performance implications of changes
- [ ] **Memory leaks**: Check for potential memory leaks in new code

### 3. **Security Assessment** (for any non-trivial changes)

- [ ] **Input validation**: Ensure all user inputs are properly validated
- [ ] **SQL injection prevention**: Verify parameterized queries are used
- [ ] **Logging security**: Ensure no sensitive data is logged
- [ ] **Environment variables**: Check if new secrets need `.env.example` updates

### 4. **Feature-Specific Checks**

- [ ] **Environment variables**: Update `.env.example` if env vars changed
- [ ] **Documentation**: Update relevant docs if APIs/features changed
- [ ] **Test data cleanup**: Ensure no test artifacts left behind
- [ ] **Backward compatibility**: Verify changes don't break existing functionality

## 🔍 Change Review

### 5. **Review Changes**

- [ ] **Check git status**: `git status`
- [ ] **Review modified files**: `git diff --name-only`
- [ ] **Review specific changes**: `git diff [filename]`
- [ ] **Verify no unintended changes**: Review each modified file
- [ ] **Check for debugging artifacts**: Remove console.logs, debugger statements, TODO comments
- [ ] **Auto-generated files**: Ensure no auto-generated files are staged (check `.gitignore`)

### 6. **Dependencies & Configuration**

- [ ] **Package dependencies**: If package.json changed, verify `npm ci` works
- [ ] **Environment variables**: Check if `.env.example` reflects new variables
- [ ] **Configuration files**: Verify any config changes are documented
- [ ] **Docker/scripts**: If container or script changes, test locally
- [ ] **npm script references**: Verify all documentation references to npm scripts are accurate

## 📝 Staging Changes

### 7. **Stage Files**

```bash
# Stage specific files
git add src/newfeature.js
git add test/newfeature.test.js

# Or stage all changes (be careful!)
git add .

# Or stage by category
git add src/
git add test/
git add *.md
```

### 8. **Verify Staged Changes**

- [ ] **Check staged files**: `git diff --cached --name-only`
- [ ] **Review staged changes**: `git diff --cached`
- [ ] **Ensure no sensitive data**: No passwords, API keys, or secrets
- [ ] **Verify test coverage**: New code should have corresponding tests
- [ ] **Check file sizes**: Ensure no large files were accidentally added
- [ ] **Exclude auto-generated files**: Verify files like `.platform-config.json` are not staged
- [ ] **Validate documentation changes**: Check that updated docs are accurate and complete

## 🛡️ Enterprise Quality Gates (for significant changes)

### **Security & Compliance**

- [ ] **Secrets scanning**: Run `git secrets --scan` if available
- [ ] **Dependency audit**: Verify `npm audit` shows no critical vulnerabilities
- [ ] **File permissions**: Check that no files have overly permissive permissions
- [ ] **License compatibility**: Ensure any new dependencies have compatible licenses

### **Observability & Monitoring**

- [ ] **Logging consistency**: Verify new code follows project logging patterns
- [ ] **Error handling**: Ensure all error paths are properly logged
- [ ] **Performance monitoring**: Add performance metrics for critical paths
- [ ] **Health check impact**: Consider if changes affect health check endpoints

### **Production Readiness**

- [ ] **Configuration validation**: Test with different environment configurations
- [ ] **Resource usage**: Consider memory and CPU impact of changes
- [ ] **Graceful degradation**: Ensure system handles failures gracefully
- [ ] **Rollback plan**: Consider if changes are easily reversible

### **Checklist Maintenance**

- [ ] **Process improvement**: Did you encounter any issues or steps not covered in this checklist?
- [ ] **Update checklist**: If gaps were found, update this checklist to help future commits
- [ ] **Document learnings**: Add common issues, fix commands, or validation steps discovered during this commit

> 💡 **Keep the checklist current**: This checklist should evolve based on real experience. If you found missing steps,
> unclear instructions, or encountered new types of issues, please update the checklist as part of your commit.

## ✏️ Commit Message

### 9. **Create Descriptive Commit**

Use [Conventional Commits](https://conventionalcommits.org/) format:

```bash
git commit -m "<type>[optional scope]: <description>

[optional body]

[optional footer(s)]"
```

**Examples:**

```bash
# Feature
git commit -m "feat: add user authentication system

- Implement JWT token-based authentication
- Add login/logout endpoints
- Include password hashing with bcrypt
- Add authentication middleware

Closes #123"

# Bug fix
git commit -m "fix: resolve memory leak in connection pool

- Fix unclosed database connections
- Add proper cleanup in error handlers
- Update connection timeout configuration

Fixes #456"

# Documentation
git commit -m "docs: update API documentation for v2 endpoints"

# Refactor
git commit -m "refactor: extract validation logic into separate module"
```

**Commit Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding tests
- `chore`: Maintenance tasks
- `security`: Security-related changes
- `deps`: Dependency updates

## 🔧 Commands Quick Reference

### Essential Quality Checks

```bash
# Complete validation pipeline
npm run ci                    # Full CI pipeline (recommended)
npm test                      # All tests (unit + integration)
npm run test:coverage         # Test coverage report
npm run test:integration      # Integration tests only
npm run security:audit        # Security vulnerability check
npm run lint                  # Code quality check
npm run format:check          # Code formatting validation
npm run markdown:lint         # Markdown linting check

# Manual fix commands (if pre-commit hooks fail)
npm run lint:fix              # Auto-fix ESLint issues
npm run format                # Auto-fix formatting issues
npm run markdown:fix          # Auto-fix markdown issues

# Pre-commit validation
git diff --name-only          # See which files changed
git diff --cached             # Review staged changes
git status                    # Current repository state
```

### Git Operations

```bash
# Staging and committing
git add [files]               # Stage specific files
git add .                     # Stage all changes (use carefully)
git commit -m "message"       # Commit with message
git commit --amend            # Amend last commit

# Branch and remote management
git status                    # Check current state
git branch                    # List branches
git remote -v                 # Check remote repositories
git push origin [branch]      # Push to remote

# Review and debugging
git log --oneline -5          # Recent commit history
git diff HEAD~1               # Compare with previous commit
git show [commit-hash]        # Show specific commit details
```

---

## 🏆 Ready to commit when all checkboxes are ✅
