# Stabilization lessons — 2026-11-01

> **Audience**: contributors and maintainers planning stabilization or validation work

This dated review records lessons from completed stabilization work and the decisions adopted
for future investigations. It does not supply fresh runtime or security validation.

## Observations

The public record separates several kinds of completed work:

- [#1518](https://github.com/egarcia74/warp-sql-server-mcp/pull/1518): shared dependency audit blockers.
- [#1519](https://github.com/egarcia74/warp-sql-server-mcp/pull/1519): an SDK capability regression.
- [#1520](https://github.com/egarcia74/warp-sql-server-mcp/pull/1520): SQL test lifecycle stabilization.
- [#1521](https://github.com/egarcia74/warp-sql-server-mcp/pull/1521): the standing independent plan review policy.

Product regressions and environment failures needed different responses. Preserved failed runs
made those distinctions reviewable. Successful non-SQL checks and a passing high-severity audit
gate left explicit validation and remediation gaps; neither established complete resolution.

## Adopted decisions

[WARP's durable guidance](../../WARP.md#bounded-investigations-and-evidence) now captures bounded
investigations, independent review, evidence preservation, precise verification states, early
publication readiness and per-finding scanner decisions. The
[contributor checklist](../../CONTRIBUTING.md#investigation-checklist) provides the practical sequence.
Deferred remediation and validation remain separately scoped work rather than implicit extensions.

## Review process and limits

Independent adversarial review of this documentation plan returned **PASS with wording constraints**:
preserve initial plan review, material-change re-review, final source/evidence review and required
checks. Independent final review of the exact documentation changes returned **PASS**.
The required local lint, formatting, Markdown, unit and non-SQL CI checks passed;
this does not establish fresh SQL validation or the status of later remote checks.
No additional independent security scan or SQL/Docker validation was performed for this review.
Historical results remain attached to their source revisions; skipped SQL checks are not passes.

As of 2026-11-01, the public follow-ups remain open:

- [#1522](https://github.com/egarcia74/warp-sql-server-mcp/issues/1522): compatible remediation and
  verification of the remaining minimatch advisory; a severity-gate pass does not resolve it.
- [#1523](https://github.com/egarcia74/warp-sql-server-mcp/issues/1523): fresh, bounded SQL integration
  validation of the combined stabilization baseline. Historical SQL evidence does not fill this gap.

These issues record future acceptance criteria and safeguards; they do not authorize new workloads.
