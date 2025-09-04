# Security Policy

## 🔒 Overview

Warp SQL Server MCP implements a **three-tier graduated security system** designed to prevent
accidental or malicious database operations. This system provides granular control over what
SQL operations are permitted, with secure defaults that prioritize safety over functionality.

**🚀 First time setup?** Choose your preferred environment:

- **[Warp Terminal Quick Start Guide](QUICKSTART.md)** - Original 5-minute setup
- **[VS Code Quick Start Guide](QUICKSTART-VSCODE.md)** - Complete VS Code + Warp integration

Both guides get the server running with secure defaults, then return here for detailed security configuration.

## 🛡️ Security Architecture

### Three-Tier Safety System

The MCP server implements three independent security layers:

| Security Level                | Environment Variable                      | Default | Controls                         |
| ----------------------------- | ----------------------------------------- | ------- | -------------------------------- |
| **🔒 Read-Only Mode**         | `SQL_SERVER_READ_ONLY`                    | `true`  | Restricts to SELECT queries only |
| **⚠️ Destructive Operations** | `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | Controls INSERT/UPDATE/DELETE    |
| **🚨 Schema Changes**         | `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | Controls CREATE/DROP/ALTER       |

### Security by Default

**By default, the MCP server runs in maximum security mode:**

- ✅ Only SELECT queries are permitted
- ❌ No data modifications (INSERT/UPDATE/DELETE)
- ❌ No schema changes (CREATE/DROP/ALTER)
- ❌ No stored procedure execution
- ❌ No administrative operations

## 📋 Security Configurations

### 🔒 Maximum Security (Default - Production Recommended)

```bash
SQL_SERVER_READ_ONLY=true
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false
```

**Permitted Operations:**

- ✅ SELECT queries (with JOINs, CTEs, subqueries)
- ✅ SHOW/DESCRIBE/EXPLAIN operations
- ✅ Database and table inspection
- ❌ All modification operations blocked

**Use Cases:** Production monitoring, business intelligence, data analysis, reporting

### 📊 Data Analysis Mode

```bash
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false
```

**Permitted Operations:**

- ✅ All SELECT operations
- ✅ INSERT/UPDATE/DELETE operations
- ✅ Data import/export operations
- ❌ Schema modifications blocked

**Use Cases:** Data migration, ETL processes, application development, testing with real data

### 🛠️ Full Development Mode

```bash
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true
```

**Permitted Operations:**

- ✅ All SQL operations including DDL
- ✅ CREATE/DROP/ALTER operations
- ✅ Index and constraint management
- ⚠️ **UNRESTRICTED ACCESS**

**Use Cases:** Database development, schema migration, full development environments

**⚠️ WARNING:** Only use this configuration in isolated development environments!

## 🔍 Security Validation

### Query Validation Engine

The MCP server includes a comprehensive query validation engine that:

1. **Parses SQL statements** using regex patterns to identify operation types
2. **Enforces security policies** before query execution
3. **Provides clear error messages** when operations are blocked
4. **Logs security decisions** for audit purposes

### Validation Logic

```text
┌─────────────────┐
│   SQL Query     │
└─────────────────┘
         │
         ▼
┌─────────────────┐      ┌─────────────────┐
│ Read-Only Mode? │─Yes──▶│ Allow SELECT    │
│     Enabled     │      │ Block All Else  │
└─────────────────┘      └─────────────────┘
         │ No
         ▼
┌─────────────────┐      ┌─────────────────┐
│ Destructive     │─No───▶│ Block DML       │
│ Ops Allowed?    │      │ Operations      │
└─────────────────┘      └─────────────────┘
         │ Yes
         ▼
┌─────────────────┐      ┌─────────────────┐
│ Schema Changes  │─No───▶│ Block DDL       │
│    Allowed?     │      │ Operations      │
└─────────────────┘      └─────────────────┘
         │ Yes
         ▼
┌─────────────────┐
│ Allow All       │
│ Operations      │
└─────────────────┘
```

## 🚨 Threat Model

### Threats Mitigated

1. **Accidental Data Loss**
   - Protection: Read-only mode prevents accidental DELETE/UPDATE
   - Impact: Prevents business-critical data corruption

2. **Unauthorized Schema Changes**
   - Protection: Schema change controls prevent DROP TABLE/ALTER
   - Impact: Prevents structural database damage

3. **Malicious Query Injection**
   - Protection: Query validation blocks dangerous patterns
   - Impact: Reduces attack surface for SQL injection

4. **Insider Threats**
   - Protection: Granular permission controls
   - Impact: Limits potential damage from compromised credentials

5. **Configuration Drift**
   - Protection: Secure defaults with explicit opt-in for dangerous operations
   - Impact: Prevents accidental exposure of production systems

### Threats NOT Mitigated

⚠️ **Important Limitations:**

1. **Network Security**: This MCP does not provide network-level security
2. **Authentication**: Relies on SQL Server authentication mechanisms
3. **Authorization**: Does not implement user-level access controls
4. **Encryption**: Does not enforce connection encryption (configurable separately)
5. **Audit Logging**: Provides basic logging but not comprehensive audit trails

## 🔐 GitHub Actions & CI/CD Security

### Token Permissions Policy

All GitHub Actions workflows implement **least-privilege token permissions** to minimize attack surface:

```yaml
permissions:
  contents: read # Read repository code only
  pull-requests: write # Create/update PRs (if needed)
  packages: write # Publish packages (if needed)
```

**Security Benefits:**

- Prevents unauthorized repository modifications
- Limits scope of potential token compromise
- Follows GitHub's security best practices
- Reduces supply chain attack vectors

### CLI Security Hardening

**Atomic File Operations**: The CLI tool uses atomic file creation to prevent race conditions:

```javascript
// Secure: Atomic file creation with O_CREAT | O_EXCL
const fd = fs.openSync(configFile, flags, 0o600);
```

**Security Features:**

- **TOCTOU Prevention**: Eliminates Time-of-Check Time-of-Use vulnerabilities
- **Atomic Operations**: File creation and permission setting in single operation
- **Race Condition Safe**: Multiple concurrent processes handled safely
- **Secure Permissions**: Files created with 0o600 (owner read/write only)

**Vulnerability Mitigated:**

```javascript
// Insecure: Race condition vulnerable
if (!fs.existsSync(file)) {
  // ⚠️ TOCTOU vulnerability
  fs.writeFileSync(file, data); // Another process could create file here
}
```

## 🏥 Production Deployment Guidelines

### Environment-Specific Recommendations

> **📖 Complete Environment Variables Reference**: See **[ENV-VARS.md](ENV-VARS.md)** for comprehensive documentation of all environment variables and their defaults.

#### Production Environment

```bash
# MANDATORY SETTINGS FOR PRODUCTION
SQL_SERVER_READ_ONLY=true
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=false
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false

# RECOMMENDED SECURITY SETTINGS
SQL_SERVER_ENCRYPT=true
SQL_SERVER_TRUST_CERT=false  # Explicit for production - don't rely on auto-detection

# CONNECTION LIMITS
SQL_SERVER_CONNECT_TIMEOUT_MS=5000
SQL_SERVER_REQUEST_TIMEOUT_MS=10000
```

#### Staging Environment

```bash
# STAGING SETTINGS (Limited Write Access)
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=false

# SECURITY SETTINGS
SQL_SERVER_ENCRYPT=true
SQL_SERVER_TRUST_CERT=false  # Explicit for staging - ensure production-level SSL
```

#### Development Environment

```bash
# DEVELOPMENT SETTINGS (Full Access)
SQL_SERVER_READ_ONLY=false
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true
SQL_SERVER_ALLOW_SCHEMA_CHANGES=true

# RELAXED SETTINGS FOR DEVELOPMENT
SQL_SERVER_ENCRYPT=false
# SQL_SERVER_TRUST_CERT=true  # Usually not needed - auto-detects development environment
```

### Security Checklist

Before deploying to production:

- [ ] **Verify Read-Only Mode**: Confirm `SQL_SERVER_READ_ONLY=true`
- [ ] **Test Security Enforcement**: Verify DML/DDL operations are blocked
- [ ] **Enable Encryption**: Set `SQL_SERVER_ENCRYPT=true` for remote connections
- [ ] **Validate Certificates**: Set `SQL_SERVER_TRUST_CERT=false` for production (see SSL Certificate Trust section)
- [ ] **Configure Timeouts**: Set appropriate timeout values for your environment
- [ ] **Review Connection Limits**: Configure connection pool settings
- [ ] **Test Error Handling**: Verify blocked operations return clear error messages
- [ ] **Monitor Logs**: Ensure security warnings appear in MCP logs
- [ ] **Document Configuration**: Record security settings in deployment documentation
- [ ] **Regular Reviews**: Schedule periodic security configuration reviews

## 🔐 SSL Certificate Trust Security

### Smart Environment Detection

The MCP server uses **conservative security defaults** for SSL certificate trust through intelligent
environment detection. This prevents accidental certificate trust in production environments.

> **📖 Complete SSL Configuration**: See **[ENV-VARS.md#ssl-tls-security-settings](ENV-VARS.md#ssltls-security-settings)** for comprehensive SSL configuration options.

#### Trust Behavior

**🔧 Strong Development Indicators** (always auto-trust certificates):

- `NODE_ENV=development` or `NODE_ENV=test`
- `SQL_SERVER_HOST=localhost` or `SQL_SERVER_HOST=127.0.0.1`

**⚠️ Weak Development Indicators** (only trust with explicit NODE_ENV):

- `SQL_SERVER_HOST` ends with `.local` **AND** `NODE_ENV=development/test`
- Private IP addresses **AND** `NODE_ENV=development/test`:
  - `192.168.x.x` ranges
  - `10.x.x.x` ranges
  - `172.16.x.x` through `172.31.x.x` ranges

**🔒 Production Environment (default)** (require valid certificates):

- All other scenarios, including:
  - `NODE_ENV=production` or no NODE_ENV set
  - Public domain names and IP addresses
  - Private IPs without explicit NODE_ENV=development/test
  - `.local` domains without explicit NODE_ENV=development/test

#### Security Rationale

**Why Conservative Defaults Matter:**

1. **Cloud Production Safety**: Prevents accidental certificate trust in cloud environments
   using private IP addresses (AWS VPC, Azure vNET, GCP VPC)
2. **Corporate Network Security**: `.local` domains require explicit development marking
3. **Container Deployment Safety**: Internal networking doesn't automatically trust certificates
4. **Zero-Trust Principle**: Explicit configuration required for relaxed security

**Examples:**

```bash
# ✅ TRUSTED (Strong indicators)
NODE_ENV=development SQL_SERVER_HOST=localhost
NODE_ENV=test SQL_SERVER_HOST=127.0.0.1

# ✅ TRUSTED (Weak indicator + explicit NODE_ENV)
NODE_ENV=development SQL_SERVER_HOST=db.local
NODE_ENV=development SQL_SERVER_HOST=192.168.1.100

# ❌ NOT TRUSTED (Production defaults)
SQL_SERVER_HOST=db.local                    # Missing NODE_ENV
SQL_SERVER_HOST=192.168.1.100              # Could be cloud production
NODE_ENV=production SQL_SERVER_HOST=db.local # Explicit production
```

#### Explicit Override Options

For explicit control, override the smart detection:

```bash
# Force trust certificates (development only)
SQL_SERVER_TRUST_CERT=true

# Force require valid certificates (production)
SQL_SERVER_TRUST_CERT=false
```

**⚠️ Security Warning**: Only use `SQL_SERVER_TRUST_CERT=true` in isolated development
environments with self-signed certificates.

## 🔧 Configuration Validation

### Startup Security Summary

The MCP server prints a configuration summary at startup showing current security status:

```text
Connected to localhost:1433/master (Windows Auth)
Security: 🔒 SECURE (RO, DML-, DDL-)
```

### Security Status Indicators

| Indicator   | Meaning                                     | Security Level |
| ----------- | ------------------------------------------- | -------------- |
| `🔒 SECURE` | Maximum security - read-only mode           | **Secure**     |
| `⚠️ UNSAFE` | Reduced security - write operations allowed | **Caution**    |
| `RO`        | Read-only mode enabled                      | **Secure**     |
| `RW`        | Read-write mode enabled                     | **Caution**    |
| `DML-`      | Destructive operations blocked              | **Secure**     |
| `DML+`      | Destructive operations allowed              | **Caution**    |
| `DDL-`      | Schema changes blocked                      | **Secure**     |
| `DDL+`      | Schema changes allowed                      | **High Risk**  |

### Runtime Security Information

Every query response includes current security status:

```json
{
  "safetyInfo": {
    "readOnlyMode": true,
    "destructiveOperationsAllowed": false,
    "schemaChangesAllowed": false
  }
}
```

## 🛠️ Testing Security Features

### Security Test Suite

The MCP server includes comprehensive security tests:

```bash
# Run all security-related tests
npm test -- --grep "safety\|security\|validation"

# Test security configuration
npm test -- --grep "validateQuery"
```

### Manual Security Testing

#### Test Read-Only Mode

```sql
-- This should work in read-only mode
SELECT * FROM Users LIMIT 10;

-- These should be blocked in read-only mode
INSERT INTO Users (name) VALUES ('test');
UPDATE Users SET name = 'test' WHERE id = 1;
DELETE FROM Users WHERE id = 1;
```

#### Test DML Protection

```sql
-- With destructive operations disabled, these should be blocked
INSERT INTO Products (name) VALUES ('test');
UPDATE Products SET price = 10 WHERE id = 1;
DELETE FROM Products WHERE id = 1;
```

#### Test DDL Protection

```sql
-- With schema changes disabled, these should be blocked
CREATE TABLE TestTable (id INT);
ALTER TABLE Products ADD COLUMN description TEXT;
DROP TABLE TestTable;
```

## 📞 Security Issue Reporting

### Reporting Security Vulnerabilities

If you discover a security vulnerability, please:

1. **Do NOT create a public GitHub issue**
2. **Email security concerns privately** to the maintainer
3. **Provide detailed information** about the vulnerability
4. **Allow reasonable time** for assessment and patching

### Security Response Process

1. **Acknowledgment**: Security reports are acknowledged within 48 hours
2. **Assessment**: Vulnerability is assessed and prioritized within 7 days
3. **Patching**: Critical issues are patched within 14 days
4. **Disclosure**: Coordinated disclosure after patch is available
5. **Credit**: Security researchers are credited (if desired)

## 📚 Additional Resources

- [OWASP SQL Injection Prevention](https://owasp.org/www-project-cheat-sheets/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [Microsoft SQL Server Security Documentation](https://learn.microsoft.com/en-us/sql/relational-databases/security/)
- [CIS Database Security Guidelines](https://www.cisecurity.org/controls/v8/)

---

**Remember**: Security is a layered approach. This MCP's safety features are one layer in your overall database security strategy.
