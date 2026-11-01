# Project Agent Directives

## Purpose

- Ensure the AI assistant always treats `WARP.md` as the primary knowledge document for this repo.

## Knowledge Rules

- Always consult `WARP.md` first for project context, architecture, terminology, workflows, and conventions.
- When the user asks about behavior, features, decisions, or standards, search `WARP.md` for relevant sections before scanning other files.
- Prefer headings and anchors in `WARP.md` to locate context; quote the closest section title when helpful.
- If an answer might conflict with `WARP.md`, defer to `WARP.md` and call out the discrepancy.
- If `WARP.md` is missing details, then consult `README.md`, `docs/`, and code.

## Operational Guidance

- On first interaction in this workspace, quickly scan `WARP.md` to build context.
- If `WARP.md` changes during a session, re-open it to refresh context.
- Keep answers concise; link to `WARP.md` sections by filename and heading when referencing details.

## Standing Plan Review Requirement

- Before implementing any plan, obtain an independent adversarial review from a subagent.
- Review assumptions, scope, security boundaries, failure modes, tests, verification evidence,
  and acceptance criteria. Require an explicit PASS or actionable revision requests.
- Revise and repeat the independent review until PASS; do not begin implementation beforehand.
- Material changes to an approved plan require renewed adversarial review before proceeding.
- Record the review outcome and remaining constraints, and report them concisely to the user.
- Plan approval does not authorize additional scope or replace code reviews, checks, or release gates.

## Key Commands

Run these before proposing a change as finished:

- `npm run lint` - ESLint over the repository
- `npm run format:check` - Prettier formatting check (`npm run format` to fix)
- `npm run markdown:lint` - markdownlint over all Markdown (`npm run markdown:fix` to fix)
- `npm run test:unit` - Vitest unit suite in `test/unit`; fast, no database required
- `npm run ci` - full local gate: lint, format, markdown, doc checks, link check, coverage, npm audit

`npm test` and `npm run test:integration` start a SQL Server container, so they need a working
Docker daemon.

## Further Reading

- `CONTRIBUTING.md` - development workflow, test-driven development (TDD) requirements, git hooks,
  and safety-testing rules.
- `WARP.md` - the detailed source of truth for architecture, security policy, and release process.
