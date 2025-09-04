# Git Commit Checklist

> **Note**: This checklist reflects what the automated git hooks will run, plus additional manual checks.

## 🔄 Automated Pre-Commit Checks

### **What the pre-commit hook runs automatically:**

- ✅ **ESLint --fix**: Automatically fixes JavaScript linting issues
- ✅ **Prettier --write**: Automatically formats code (JS, JSON, MD files)
- ✅ **Markdownlint --fix**: Automatically fixes markdown issues
- ✅ **Quick test suite**: Runs `npm test` to ensure no broken tests

_These happen automatically when you `git commit` - no manual action needed!_

## 📋 Manual Pre-Commit Verification

### 1. **Development Checks** (if making significant changes)

- [ ] **Run comprehensive tests**: `npm run test:coverage`
- [ ] **Run manual integration tests**: `npm run test:manual`
- [ ] **Check for vulnerabilities**: `npm run security:audit`

### 2. **Feature-Specific Checks**

- [ ] **Environment variables**: Update `.env.example` if env vars changed
- [ ] **Documentation**: Update relevant docs if APIs/features changed
- [ ] **Test data cleanup**: Ensure no test artifacts left behind

## 🔍 Change Review

### 3. **Review Changes**

- [ ] **Check git status**: `git status`
- [ ] **Review modified files**: `git diff --name-only`
- [ ] **Review specific changes**: `git diff [filename]`
- [ ] **Verify no unintended changes**: Review each modified file

## 📝 Staging Changes

### 4. **Stage Files**

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

### 5. **Verify Staged Changes**

- [ ] **Check staged files**: `git diff --cached --name-only`
- [ ] **Review staged changes**: `git diff --cached`
- [ ] **Ensure no sensitive data**: No passwords, API keys, or secrets

## ✏️ Commit Message

### 6. **Create Descriptive Commit**

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

## 🔧 Commands Quick Reference

```bash
# Quality checks
npm run ci                    # Full CI pipeline
npm test                      # All tests
npm run test:manual           # Manual integration tests
npm run lint                  # Code quality
npm run format:check          # Format validation

# Git operations
git status                    # Check current state
git add [files]              # Stage changes
git commit -m "message"      # Commit with message
git push origin [branch]     # Push to remote

# Branch management
git branch                   # List branches
git checkout main           # Switch to main
git merge [branch]          # Merge feature branch
```

---

## 🏆 Ready to commit when all checkboxes are ✅
