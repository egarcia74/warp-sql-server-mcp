# Git Push Checklist

> **Note**: This checklist reflects what the automated pre-push hook will run, plus additional manual checks.

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

## 📋 Manual Pre-Push Verification

### 1. **Final Quality Checks** (recommended for major changes)

- [ ] **Run full CI locally**: `npm run ci`
- [ ] **Manual integration tests**: `npm run test:manual`
  - [ ] Verify all 3 security phases show SUCCESS (40/40 tests)
- [ ] **Performance validation**: `npm run test:manual:performance`

### 2. **Branch & Remote Verification**

- [ ] **Verify current branch**: `git branch` (confirm you're on the right branch)
- [ ] **Check remote**: `git remote -v` (verify pushing to correct repository)
- [ ] **Check ahead/behind**: `git status` (check if you need to pull first)

### 3. **Commit History Review**

- [ ] **Review commits**: `git log --oneline -5` (check recent commits)
- [ ] **Verify commit messages**: Ensure they follow conventional commit format
- [ ] **Check for merge conflicts**: Ensure clean merge state

## 🚀 Push Process

### 4. **Push Commands**

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

### 5. **First-time push** (new branch)

```bash
# Set upstream and push
git push -u origin feature/your-feature-name
```

## 🔍 Post-Push Validation

### 6. **Verify Push Success**

- [ ] **Check GitHub**: Confirm commit appears in the repository
- [ ] **Monitor CI/CD**: Watch GitHub Actions for any pipeline failures
- [ ] **Check status checks**: Ensure all required checks pass

### 7. **Pull Request** (if pushing to feature branch)

- [ ] **Create PR**: From your feature branch to main/develop
- [ ] **Add clear title**: Use conventional commit format if applicable
- [ ] **Write description**: Explain what was changed and why
- [ ] **Link issues**: Reference any related GitHub issues
- [ ] **Request reviewers**: Add appropriate team members
- [ ] **Add labels**: Apply relevant labels (bug, feature, etc.)

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

- [ ] **Integration tests pass**: `npm run test:manual`
- [ ] **Performance tests pass**: `npm run test:manual:performance`
- [ ] **Documentation updated**: If APIs or features changed
- [ ] **Environment variables**: `.env.example` updated if needed

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
npm run test:coverage               # Coverage check
npm run security:audit             # Security audit

# Branch management
git branch -vv                      # Show local branches with tracking
git remote -v                       # Show remotes
git status                         # Check current state
git log --oneline -5               # Recent commits
```

---

## 🏆 Ready to push when all checks pass! 🚀
