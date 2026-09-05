# Security Policy

This file is the disclosure and support policy for `@egarcia74/warp-sql-server-mcp`.
For how the server's safety controls work and how to configure them, see the
**[Security Guide](../docs/architecture/SECURITY.md)**.

## 🔒 Supported Versions

Only the current minor line receives fixes. Security fixes are shipped as a new patch
release on `latest`; we do not backport.

| Version          | Supported | Notes                                                                  |
| ---------------- | --------- | ---------------------------------------------------------------------- |
| 1.7.x (≥ 1.7.18) | ✅ Yes    | Current line. Contains fixes for all published advisories below.       |
| 1.7.11–17        | ❌ No     | Deprecated on npm — each carries at least one of the advisories below. |
| < 1.7.11         | ❌ No     | Not available on npm.                                                  |

Run `npm view @egarcia74/warp-sql-server-mcp@<version> deprecated` to see why a given
version was deprecated, or just upgrade: `npm i -g @egarcia74/warp-sql-server-mcp@latest`.

## 📣 Published Security Advisories

| Advisory                                                                                                        | Severity | Affected | Fixed in | Summary                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | -------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| [GHSA-qhf4-jmhq-73c8](https://github.com/egarcia74/warp-sql-server-mcp/security/advisories/GHSA-qhf4-jmhq-73c8) | High     | ≤ 1.7.15 | 1.7.16   | Read-only mode bypass: SELECT-prefixed batch without `;` executed DML/DDL via `execute_query`                 |
| [GHSA-crw3-hmxc-f53p](https://github.com/egarcia74/warp-sql-server-mcp/security/advisories/GHSA-crw3-hmxc-f53p) | High     | ≤ 1.7.16 | 1.7.17   | Safety tiers bypassed by a bare procedure call as the first statement of a batch                              |
| [GHSA-p8gx-89fp-x73j](https://github.com/egarcia74/warp-sql-server-mcp/security/advisories/GHSA-p8gx-89fp-x73j) | High     | ≤ 1.7.17 | 1.7.18   | SQL injection in data/exploration tools via unvalidated `table_name`, `schema`, `database`, `limit`, `offset` |

Each was found by internal review and, within a day of confirmation, fixed, published and
had its affected npm versions deprecated. The full list is always at the
[Security Advisories tab](https://github.com/egarcia74/warp-sql-server-mcp/security/advisories).

## 🚨 Reporting a Vulnerability

**Please do not open a public issue for a suspected vulnerability.**

Private vulnerability reporting is enabled on this repository:

1. Go to the [Security Advisories tab](https://github.com/egarcia74/warp-sql-server-mcp/security/advisories)
2. Click **Report a vulnerability**
3. Describe the issue, affected version(s), and a reproduction (a SQL payload and the
   tool/arguments it went through is ideal)
4. Submit — the report is visible only to you and the maintainer

If you cannot use GitHub's form, open a plain issue that says only _"security report —
please contact me"_ with no details, and the maintainer will open a private advisory
and invite you to it.

### What to expect

| Stage                          | Target                                         |
| ------------------------------ | ---------------------------------------------- |
| Acknowledgement                | Within 48 hours                                |
| Triage and severity assessment | Within 7 days                                  |
| Fix for High/Critical          | Within 7 days of confirmation                  |
| Fix for Medium/Low             | Within 30 days of confirmation                 |
| Disclosure                     | Coordinated; advisory published with the fix   |
| Affected npm versions          | Deprecated with a pointer to the fixed version |

Reporters are credited in the advisory and release notes unless they ask not to be.

## 🛡️ What is in scope

- The MCP server (`index.js`, `lib/**`) as published to npm
- The three-tier safety system and any way to execute a statement the active tier forbids
- SQL injection through any tool argument (`table_name`, `schema`, `database`, `where_clause`,
  `limit`, `offset`, query text, etc.)
- Credential handling (environment, Azure Key Vault, AWS Secrets Manager)
- The release pipeline and GitHub Actions workflows in this repository

Out of scope: vulnerabilities in SQL Server itself, misconfiguration of the user's own
database permissions, and issues that require the caller to already have full development
mode (`SQL_SERVER_READ_ONLY=false`, `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS=true`,
`SQL_SERVER_ALLOW_SCHEMA_CHANGES=true`) — that mode intentionally bypasses the guards.

## 🧱 Security Controls (summary)

Detailed behaviour, configuration and threat model live in the
[Security Guide](../docs/architecture/SECURITY.md). In brief:

### Three-tier safety system

| Tier                      | Environment variable                      | Default | Controls                                             |
| ------------------------- | ----------------------------------------- | ------- | ---------------------------------------------------- |
| 🔒 Read-only              | `SQL_SERVER_READ_ONLY`                    | `true`  | SELECT only; rejects WAITFOR, `OPENROWSET(BULK)`     |
| ⚠️ Destructive operations | `SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS` | `false` | INSERT/UPDATE/DELETE/MERGE/TRUNCATE, EXEC, admin ops |
| 🚨 Schema changes         | `SQL_SERVER_ALLOW_SCHEMA_CHANGES`         | `false` | CREATE/DROP/ALTER, GRANT/REVOKE/DENY, `SELECT INTO`  |

### How queries are guarded

The guards are lexical, not a full SQL parser — this is deliberate, and documented in the
source (`lib/security/`):

- **Whole-batch statement guard** (`sql-batch-guard.js`) — every statement in a batch is
  checked against the active tier, whether or not it is separated by `;`. Batches with
  unterminated strings, identifiers or comments fail closed.
- **Query policy** (`query-policy.js`) — pure, unit-tested tier rules shared by
  `execute_query`, `explain_query` and the table-scoped tools.
- **WHERE-clause guard** (`where-clause-guard.js`) — depth-aware lexical guard for
  caller-supplied predicates in `get_table_data` / `export_table_csv`.
- **Identifier and numeric validation** — `database`, `schema`, `table_name` are
  allow-list validated and bracket-escaped (`]` doubled); `limit`/`offset` must be
  non-negative integers. Every caller value reaches SQL only through one of these
  escaper/coercion helpers — with one deliberate exception: the `where` clause is
  interpolated verbatim, and relies solely on the WHERE-clause guard above.
- **Audit logging** — every **denied** operation (query or WHERE clause blocked by the
  safety policy, connection failures) is written to the security audit log
  (`npm run logs:audit`). Permitted queries are recorded in the ordinary application
  log, not the audit trail.
- **Connection security** — TLS with certificate verification on by default; see the
  Security Guide for the trust-server-certificate caveats.

## 🔍 How we test security

- **Behavioural SQL-injection battery** (`test/unit/sql-injection-battery.test.js`) —
  drives every SQL-building handler with injection payloads and asserts the emitted SQL
  is neutralised. This is the authoritative regression guard for GHSA-p8gx-89fp-x73j.
- **SQL-construction static lint** (`test/unit/sql-construction-guard.test.js`) — scans
  the sources and fails if a SQL template literal interpolates an unvalidated value; a
  tripwire for new SQL-building sites nobody wired into the battery.
- **Tier bypass regressions** — unit tests for every published advisory's payload.
- **Live integration suite** (`test/integration/`, Docker SQL Server) — exercises all
  three tiers against a real instance on every release.
- **CodeQL** on every push/PR and weekly; **OSSF Scorecard** on `main` and weekly.
- **Dependabot** daily, with a triage workflow (`security-triage.yml`) that opens issues
  for new alerts.

## 🔄 Dependency and supply-chain policy

- GitHub Actions are pinned to full commit SHAs.
- npm releases are published only from GitHub Actions (`npm-publish.yml`) with `--provenance`,
  which records a Sigstore attestation linking the tarball to the exact commit and workflow that
  built it. Verify with `npm audit signatures` after installing.
- Dependabot patch/minor updates auto-merge once CI passes. **Major** updates, and any
  update to `github/codeql-action` or `step-security/*`, require manual review.
- Updates to the database driver (`mssql`, `tedious`) and secret-management clients
  (`@azure/identity`, `@azure/keyvault-secrets`, `@aws-sdk/*`) are grouped as
  _security-critical_ and never auto-merge a major version.
- Minimum supported runtime is Node.js 20.19 (see `engines` in `package.json`).

## 📞 Contact

- **Maintainer**: [@egarcia74](https://github.com/egarcia74)
- **Vulnerabilities**: [private advisory](https://github.com/egarcia74/warp-sql-server-mcp/security/advisories/new) (preferred)
- **Everything else**: [GitHub Issues](https://github.com/egarcia74/warp-sql-server-mcp/issues)

---

**Last Updated**: 2026-08-28
**Policy Version**: 2.0
