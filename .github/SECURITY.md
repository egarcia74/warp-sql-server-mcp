# Security Policy

## 🔒 Supported Versions

| Version | Supported      | Security Updates |
| ------- | -------------- | ---------------- |
| 1.5.x   | ✅ Active      | ✅ Yes           |
| 1.4.x   | ✅ Active      | ✅ Yes           |
| 1.3.x   | ⚠️ Limited     | 🔒 Critical Only |
| < 1.3   | ❌ End of Life | ❌ No            |

## 🚨 Reporting a Vulnerability

### Preferred Method: GitHub Security Advisories

1. Go to the [Security tab](https://github.com/egarcia74/warp-sql-server-mcp/security) of this repository
2. Click "Report a vulnerability"
3. Fill out the vulnerability report form
4. Submit privately for responsible disclosure

### Alternative: Direct Contact

If you prefer not to use GitHub's security advisory system:

- **Email**: [Create an issue](https://github.com/egarcia74/warp-sql-server-mcp/issues/new/choose) with the label `security`
- **Response Time**: Within 48 hours for initial triage
- **Resolution Time**: Critical issues within 7 days, others within 30 days

## 🛡️ Security Features

### Three-Tier Safety System

This project implements a revolutionary three-tier graduated safety system:

- **🔒 SECURE** (Default): Read-only access, no data modifications
- **📊 ANALYSIS**: Limited write access for data analysis
- **🛠️ DEVELOPMENT**: Full access (use with caution)

### Built-in Security Controls

- ✅ **SQL Injection Protection**: AST-based query validation
- ✅ **Query Validation**: Dangerous function detection
- ✅ **Connection Security**: Encrypted connections and authentication
- ✅ **Access Controls**: Configurable permission levels
- ✅ **Audit Logging**: Comprehensive security event tracking

## 🔍 Vulnerability Management

### Automated Security Updates

- **Dependabot**: Daily security scan and automatic patch deployment
- **Security Alerts**: Immediate notification and triage
- **Auto-merge**: Automated deployment for low-risk security patches
- **Manual Review**: Required for critical dependency updates

### Security Testing

- **Continuous Security Scanning**: CodeQL and OSSF Scorecard
- **Dependency Vulnerability Monitoring**: Real-time security alert tracking
- **Supply Chain Security**: Pinned dependencies and verified signatures

## 📊 Security Metrics

Current security posture:

- **OSSF Scorecard**: Monitored and optimized
- **Dependency Scanning**: Daily automated scans
- **Code Scanning**: Continuous security analysis
- **Vulnerability Response**: < 48 hour initial response SLA

## 🔄 Security Update Process

### Automatic Updates (No Action Required)

- **Patch updates** for development dependencies
- **Security patches** for all dependencies
- **GitHub Actions** security updates
- **Documentation** and tooling updates

### Manual Review Required

- **Major version** updates for core dependencies
- **Database connectivity** library updates (`mssql`, `tedious`)
- **Authentication** library updates (`@azure/*`, `aws-sdk`)
- **Breaking changes** in any dependency

## 🚀 Post-Security-Update Verification

After any security update:

1. **Automated Tests**: Full test suite runs automatically
2. **Smoke Testing**: Basic MCP functionality verification
3. **Security Validation**: Three-tier safety system verification
4. **Performance Monitoring**: Check for performance regressions

## 📞 Contact Information

- **Project Maintainer**: [@egarcia74](https://github.com/egarcia74)
- **Security Issues**: Use GitHub Security Advisories
- **General Issues**: [GitHub Issues](https://github.com/egarcia74/warp-sql-server-mcp/issues)

## 🏆 Security Recognition

We appreciate security researchers who responsibly disclose vulnerabilities. Contributors to security improvements may be recognized in:

- Repository security acknowledgments
- Release notes security section
- Project documentation

---

**Last Updated**: 2025-08-31  
**Policy Version**: 1.0
