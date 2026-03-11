# Automatic Environment Configuration Detection — Research & Analysis

> **Issue**: [#57](https://github.com/egarcia74/warp-sql-server-mcp/issues/57)  
> **Status**: 🔬 Research Complete — Ready for Staged Implementation Planning  
> **Last Updated**: March 2026  
> **Author**: Technical Analysis (Copilot)

---

## 1. Purpose of This Document

This document records the research findings, user scenario analysis, existing capability inventory, and proposed staged delivery plan for the **Automatic Environment Configuration Detection** feature (`detect_optimal_config` MCP tool).

No code is implemented here. This document is the basis for driving implementation decisions.

---

## 2. User Scenarios — Who Benefits and How

The following scenarios were identified by cross-referencing the project's stated use cases (`README.md`, `docs/SECURITY.md`, `docs/QUICKSTART.md`), the three-tier security model, and the configuration surface area in `.env.example` and `docs/ENV-VARS.md`.

### Scenario 1 — First-Time Developer Setup

**Persona**: Developer setting up the MCP server for the first time against a local SQL Server instance.

**Pain today**:
- Must manually read `.env.example` (155 lines) and `docs/ENV-VARS.md` to understand which settings matter.
- Gets connection failures due to `SQL_SERVER_TRUST_CERT` mismatches without clear guidance.
- Unsure which pool size, timeout, or security level to start with.

**How `detect_optimal_config` helps**:
- Analyses the current environment (`localhost` / `NODE_ENV`) and confirms auto-detection is working.
- Recommends appropriate starter config (e.g., read-only + trust cert auto for dev).
- Surfaces any explicit settings that contradict auto-detection.

**Value**: Very High — reduces time-to-first-success from 15+ minutes to under 2 minutes.

---

### Scenario 2 — Moving From Development to Production Deployment

**Persona**: DevOps engineer or developer taking the MCP server from a local dev environment into production (cloud VM, container, CI pipeline).

**Pain today**:
- `SQL_SERVER_TRUST_CERT` auto-detection is conservative but the error message when it fails is not actionable.
- Private IP ranges in cloud VPCs (AWS VPC, Azure vNET) may look like dev to the user but default to prod security posture — confusing.
- Security level settings (`READ_ONLY`, `ALLOW_DESTRUCTIVE_OPERATIONS`, `ALLOW_SCHEMA_CHANGES`) have no tooling to verify the final effective configuration.
- No way to get a "go/no-go" checklist before promoting to production.

**How `detect_optimal_config` helps**:
- Detects the environment type (dev/staging/prod) with confidence scoring.
- Produces a **security posture report**: current vs recommended settings for the detected environment.
- Flags mismatches (e.g., `ALLOW_SCHEMA_CHANGES=true` on what appears to be a production host).
- Provides an explicit "production-ready" checklist with pass/fail per criterion.

**Value**: Very High — prevents security incidents at promotion time. Directly addresses `SECURITY.md` production checklist items.

---

### Scenario 3 — Diagnosing Connection Problems Under Load

**Persona**: Developer or DBA using the MCP server during a load test or high-traffic period and experiencing timeouts or slow responses.

**Pain today**:
- `get_connection_health` shows pool state but does not correlate pool exhaustion with configured `POOL_MAX`.
- `get_performance_stats` shows slow query counts but does not suggest which config setting to change.
- No guidance on whether `SQL_SERVER_CONNECT_TIMEOUT_MS` or `SQL_SERVER_REQUEST_TIMEOUT_MS` is too tight vs the observed query durations.

**How `detect_optimal_config` helps**:
- Compares live `PerformanceMonitor` query stats (avg/p95 duration) against `requestTimeout` config.
- Compares pool utilisation (`active/total`) against `POOL_MAX` config.
- Emits concrete, actionable recommendations: `"Observed p95 query time is 4,800ms but SQL_SERVER_REQUEST_TIMEOUT_MS=5000 — increase to 10000ms to avoid transient timeouts"`.

**Value**: High — turns raw metrics into decisions. This is the highest-impact scenario for the existing performance monitoring investment.

---

### Scenario 4 — Security Audit / Compliance Review

**Persona**: Security team member or compliance officer reviewing the MCP server deployment for a regulated environment (financial, healthcare, etc.).

**Pain today**:
- Security posture is split across the startup log, query responses (`safetyInfo`), and `get_connection_health`.
- No single MCP tool produces a consolidated security configuration report.
- SSL certificate trust decisions are logged at startup but not queryable at runtime.

**How `detect_optimal_config` helps**:
- Returns a single security configuration snapshot: security tier, SSL posture, cert trust decision and its source (explicit vs auto-detected), environment classification.
- Provides a **configuration health score** (0–100) for the security dimension.
- Highlights any setting that deviates from the recommended posture for the detected environment.

**Value**: High — directly supports audit evidence collection and reduces the need for manual log trawling.

---

### Scenario 5 — Performance Tuning for Large Databases

**Persona**: Data analyst or DBA running complex JOINs and large exports against a multi-gigabyte database.

**Pain today**:
- `STREAMING_BATCH_SIZE`, `STREAMING_MAX_MEMORY_MB`, and `STREAMING_MAX_RESPONSE_SIZE` are set by default and rarely re-evaluated.
- Slow large exports have no guidance on whether to tune streaming settings vs pool settings vs request timeouts.
- The `get_optimization_insights` tool covers query-level analysis but not MCP server-level config tuning.

**How `detect_optimal_config` helps**:
- Analyses `PerformanceMonitor` metrics for tools like `export_table_csv` and `get_table_data`.
- Detects patterns (e.g., frequent streaming aborts, high memory delta) and recommends streaming config adjustments.
- Separates SQL-level optimisation (already covered by `analyze_query_performance`) from server config optimisation.

**Value**: Medium — valuable for power users but requires enough historical metrics to be meaningful. Best addressed in a later stage.

---

### Scenario 6 — Cloud Secret Manager Integration

**Persona**: Cloud engineer connecting the MCP server to AWS Secrets Manager or Azure Key Vault.

**Pain today**:
- `SECRET_MANAGER_TYPE` is set but there is no way to verify the secret provider is healthy or reachable before use.
- No status report on cache hit rates or secret refresh state.

**How `detect_optimal_config` helps**:
- Reports the active secret manager type and its health state.
- Flags misconfigured or unreachable secret providers.

**Value**: Medium — niche but high-pain when it goes wrong. Feasible with very low effort since `SecretManager` already has a health interface.

---

### Scenario 7 — Multi-Environment CI/CD Pipeline

**Persona**: DevOps engineer running the MCP server in a CI/CD pipeline across dev, staging, and production environments.

**Pain today**:
- No way to assert "this configuration is appropriate for this environment" as a pipeline step.
- Manual verification required before each environment promotion.

**How `detect_optimal_config` helps**:
- Could be called as a pipeline step to produce a machine-readable config health report.
- Exit code / structured output allows blocking a pipeline on a failing security check.

**Value**: Medium — valuable as a future phase capability; requires the core tool to be stable first.

---

## 3. Capability Inventory — What Already Exists

The following table maps each feature requirement from Issue #57 to existing code, and identifies the specific gap to close.

| Requirement | Existing Code | Gap |
|---|---|---|
| **`detect_optimal_config` MCP tool** | `lib/tools/tool-registry.js` (OPTIMIZATION_TOOLS array) | No entry. One new object + handler branch needed. |
| **Connection pool size analysis** | `PerformanceMonitor.getPoolStats()`, `assessPoolHealth()`, `calculateHealthScore()` in `lib/utils/performance-monitor.js` | No correlation to `POOL_MAX` config value. |
| **Security level detection** | `ServerConfig.getSecurityConfig()`, `lib/security/query-validator.js`, `ServerConfig._analyzeEnvironment()` | No recommendation engine that compares posture to environment. |
| **SSL/TLS configuration detection** | `ConnectionManager.getConnectionHealth()`, `ConnectionManager._extractSSLInfo()`, `ServerConfig.getConnectionSummary()` (trustCert + securityDecision) | Already fully implemented. Needs surfacing only. |
| **Timeout optimisation** | `ServerConfig` exposes all timeout values; `PerformanceMonitor.generateRecommendations()` generates query-time recommendations | Not correlated: no code compares `requestTimeout` config to observed p95 query durations. |
| **Configuration health scoring** | `PerformanceMonitor.calculateHealthScore()` (pool-only, 0–100) | Partial. Pool-only, does not cover security, SSL, or timeouts. Needs holistic scorer. |
| **Configuration adjustment recommendations** | `PerformanceMonitor.generateRecommendations()` (query/pool prose) | Recommendations do not include concrete env var names and values. |
| **Security model compliance** | Three-tier safety system fully implemented and validated | Needs to be reflected in tool output without exposing credentials. |

### What Does NOT Need to Be Built

- SSL certificate introspection below the config layer — the `mssql` library does not expose TLS socket details (explicitly documented in `ConnectionManager._extractSSLInfo()`).
- Automatic config write-back — all output should be advisory recommendations only.
- Statistical ML-based pattern detection — rule-based threshold comparisons deliver 80%+ of the value at a fraction of the complexity.

---

## 4. High-Value vs Nice-to-Have Classification

### 🟢 Must-Have (Deliver in Stage 1–2)

1. **`detect_optimal_config` tool registration** — Without this, nothing is user-facing. One entry in `tool-registry.js`. Zero risk, mandatory.

2. **Security posture report** (Scenarios 2 & 4) — Surfaces already-computed `ServerConfig` and `ConnectionManager` state in a single structured response. Directly reduces production security incidents. The raw data is all available; this is orchestration only.

3. **Connection pool analysis with config correlation** (Scenario 3) — Compares live pool utilisation from `PerformanceMonitor` against `POOL_MAX` env var. High business value because it converts a metric the user can already see (`get_performance_stats`) into an action (`increase POOL_MAX`).

4. **Timeout recommendation** (Scenario 3) — Compares `requestTimeout` / `connectionTimeout` config against `PerformanceMonitor.metrics.aggregates.avgQueryTime` and `maxQueryTime`. Concrete, deterministic, testable.

5. **Holistic configuration health score** — Extend the existing pool health score to cover security tier, SSL posture, and timeout headroom. Single 0–100 score gives users an immediate signal.

### 🟡 Should-Have (Deliver in Stage 3)

6. **First-time setup guidance** (Scenario 1) — Useful but the quick-start guide already covers this. Add to `detect_optimal_config` output as a lower-priority section.

7. **Production readiness checklist** (Scenario 2) — Machine-readable pass/fail items derived from `ServerConfig.validate()` (which already produces warnings and errors). Low additional code, but needs careful design of the output schema.

8. **Secret manager health** (Scenario 6) — `SecretManager` already exists. Adding its status to the output is low effort but low urgency.

### 🔵 Nice-to-Have (Stage 4 or later)

9. **Streaming config recommendations** (Scenario 5) — Valuable but requires sufficient historical metrics to be non-trivial. Adds complexity to the scoring algorithm. Defer until Stage 3 core is proven.

10. **CI/CD pipeline mode** (Scenario 7) — Requires structured exit-code semantics and a CLI integration point. Significant scope addition. Defer to a separate feature request.

11. **Statistical pattern detection** — The issue mentions "statistical analysis". Rule-based thresholds deliver most of the value. Statistical modelling is genuinely Phase 2 complexity; defer or scope explicitly.

---

## 5. Key Design Constraints

### Security — Credential Safety

The `detect_optimal_config` tool output **must never** include:
- `SQL_SERVER_PASSWORD` (or any derivative)
- `SQL_SERVER_USER` in plain text beyond what `ServerConfig._redactSensitive()` already produces
- AWS/Azure secret values
- Any key material from the secret manager

The existing `ServerConfig._redactSensitive()` method and the `getConnectionSummary()` redaction pattern should be used as the model.

### No Runtime Configuration Mutation

Recommendations are **advisory only**. The tool must not:
- Write to `.env` files
- Call `ServerConfig.reload()` or `updateConfig()` automatically
- Change any in-memory configuration state

### Output Schema Stability

The MCP tool response schema should be versioned from day one. Adding fields later is fine; removing or renaming fields would break integrations.

### Performance Impact

`detect_optimal_config` must read only in-memory state (already computed by `PerformanceMonitor`, `ServerConfig`, `ConnectionManager`). It must not issue additional SQL Server queries.

---

## 6. Proposed Staged Delivery Plan

### Stage 1 — Core Tool Foundation

**Objective**: Deliver a working `detect_optimal_config` MCP tool that returns structured, useful output for Scenarios 2 and 4.

**Delivery Items**:
1. Create `lib/config/config-detector.js` — new class `ConfigDetector` that reads from `PerformanceMonitor`, `ServerConfig`, and `ConnectionManager`.
2. Implement `detectOptimalConfig()` method returning:
   - `environment` — detected type, confidence, indicators
   - `security` — current tier, SSL posture, recommended posture for environment, mismatches
   - `connection` — pool current state, pool config values, health status
   - `configScore` — 0–100 holistic score (security 40%, connection 35%, performance 25%)
   - `recommendations` — array of `{ category, priority, message, envVar, recommendedValue }`
3. Add `detect_optimal_config` entry to `OPTIMIZATION_TOOLS` in `lib/tools/tool-registry.js`.
4. Add handler branch in the main index.js tool dispatch for `detect_optimal_config`.
5. Add unit tests in `test/unit/config-detector.test.js` (Vitest, consistent with existing test patterns).

**Quality Gate**:
- All existing unit tests pass (`npm test`).
- `config-detector.test.js` has ≥ 12 test cases covering: score calculation, security mismatch detection, SSL posture, credential redaction, and recommendation format.
- CodeQL scan clean.
- Manual verification: call the tool via the MCP protocol and inspect the response.

---

### Stage 2 — Timeout & Pool Recommendations

**Objective**: Add data-driven, actionable timeout and pool-size recommendations by correlating live `PerformanceMonitor` data with current config (Scenario 3).

**Delivery Items**:
1. Extend `ConfigDetector.detectOptimalConfig()` with a `performance` section:
   - Compare `requestTimeout` config vs `PerformanceMonitor.metrics.aggregates.maxQueryTime` and `avgQueryTime`.
   - Compare `POOL_MAX` config vs `PerformanceMonitor.getPoolStats().current.activeConnections` peak.
   - Compare `idleTimeoutMillis` vs observed idle connection patterns.
2. Each recommendation must include the concrete env var name and recommended value (not just prose).
   - Example: `{ envVar: "SQL_SERVER_REQUEST_TIMEOUT_MS", recommendedValue: 10000, reason: "p95 query time is 4800ms, current timeout is 5000ms — increase headroom" }`.
3. Handle the cold-start case gracefully: if `PerformanceMonitor` has fewer than N queries recorded, emit a `"Insufficient data — collect more usage history before acting on performance recommendations"` advisory.

**Quality Gate**:
- Stage 1 quality gate still passes.
- New tests cover: cold-start advisory, correct recommendation when `maxQueryTime > requestTimeout * 0.8`, no recommendation when headroom is sufficient.

---

### Stage 3 — Production Readiness Checklist & Secret Manager Health

**Objective**: Add a machine-readable production readiness checklist and secret manager status (Scenarios 2 and 6).

**Delivery Items**:
1. Extend `ConfigDetector` with a `productionReadiness` section — array of checklist items, each with:
   - `item` — e.g., `"Read-only mode enabled"`
   - `status` — `pass` / `fail` / `warn`
   - `envVar` — the controlling variable
   - `currentValue` — the redacted current value
   - `recommendation` — what to do if not passing
2. Checklist items map directly to the `docs/SECURITY.md` production checklist.
3. Add `secretManager` section to `detect_optimal_config` output — type, health, cache stats (no secret values).
4. Update `WARP.md` MCP tools table to include `detect_optimal_config`.
5. Update `CHANGELOG.md`.

**Quality Gate**:
- All previous quality gates pass.
- Tests cover: all checklist items pass in a correctly configured production-like env; at least 3 specific failure conditions.
- `detect_optimal_config` response passes JSON schema validation.

---

### Stage 4 — Streaming Config Recommendations & Hardening

**Objective**: Complete the feature with streaming config tuning and full integration validation (Scenario 5).

**Delivery Items**:
1. Extend `ConfigDetector` with a `streaming` section — compare current `STREAMING_BATCH_SIZE`, `STREAMING_MAX_MEMORY_MB` against observed memory deltas and tool-specific performance metrics from `PerformanceMonitor`.
2. Add integration test that starts the MCP server (mock connection), calls `detect_optimal_config`, and validates the response schema end-to-end.
3. PR converted from Draft to Ready.
4. Update `PRODUCT-BACKLOG.md` status to ✅ Complete.

**Quality Gate**:
- Full test suite passes.
- CodeQL scan clean.
- Integration test validates response shape.
- Peer review of `ConfigDetector` class, especially the credential-filtering logic.

---

## 7. Risk Register

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| `detect_optimal_config` output leaks `SQL_SERVER_PASSWORD` or secret values | Low (if redaction enforced) | **Critical** | Explicitly use `ServerConfig._redactSensitive()` pattern; test with a non-empty password set. |
| Recommendations suggest lowering security settings | Low | **High** | Recommendations must never suggest disabling `READ_ONLY` unless current mode is already non-read-only. Security recommendations go upward (more secure), never downward. |
| Score algorithm misleads users into false confidence | Medium | Medium | Score must be clearly labelled as "configuration health" not "system health". Performance score requires data threshold. |
| SSL introspection gaps mislead about actual TLS state | Low | Low | Explicitly note in output that SSL posture is config-derived, not live TLS socket verification. |
| Over-engineering statistical analysis | Medium | Medium | Explicitly constrain Stage 1–3 to rule-based thresholds. Statistical analysis is deferred post-Stage 4. |
| Streaming config recommendations too noisy without enough data | Medium | Low | Cold-start advisory in Stage 2 gates performance recommendations on minimum data threshold (configurable, default: 50 queries). |

---

## 8. Scenario Priority Matrix

| Scenario | Business Value | Implementation Effort | Stage |
|---|---|---|---|
| 1 — First-time setup guidance | High | Low | Stage 1 (partial: environment detection already done) |
| 2 — Dev-to-production promotion | **Very High** | Low | Stage 1 |
| 3 — Diagnosing load/timeout issues | **Very High** | Medium | Stage 2 |
| 4 — Security audit / compliance | **High** | Low | Stage 1 |
| 5 — Large database performance tuning | Medium | Medium | Stage 4 |
| 6 — Cloud secret manager health | Medium | Low | Stage 3 |
| 7 — CI/CD pipeline integration | Medium | High | Post-Stage 4 / separate feature |

---

## 9. Summary

The feature is well-scoped and the majority of required data is already computed by existing classes (`PerformanceMonitor`, `ServerConfig`, `ConnectionManager`). The core implementation gap is:

1. A new `ConfigDetector` orchestrator class (~200 lines).
2. One tool registry entry.
3. One handler dispatch branch.

The highest-value delivery is **Stage 1** (security posture + environment detection + basic health score), which can be completed with minimal risk and directly addresses Scenarios 2 and 4 — the scenarios most likely to cause production incidents today.

The credential safety constraint is the single most important design rule for this feature and must be enforced at code review.

---

**Next Step**: Begin Stage 1 implementation when ready. This document should be treated as the specification for the first PR.
