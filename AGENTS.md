Project Agent Directives

Purpose

- Ensure the AI assistant always treats `WARP.md` as the primary knowledge document for this repo.

Knowledge Rules

- Always consult `WARP.md` first for project context, architecture, terminology, workflows, and conventions.
- When the user asks about behavior, features, decisions, or standards, search `WARP.md` for relevant sections before scanning other files.
- Prefer headings and anchors in `WARP.md` to locate context; quote the closest section title when helpful.
- If an answer might conflict with `WARP.md`, defer to `WARP.md` and call out the discrepancy.
- If `WARP.md` is missing details, then consult `README.md`, `docs/`, and code.

Operational Guidance

- On first interaction in this workspace, quickly scan `WARP.md` to build context.
- If `WARP.md` changes during a session, re-open it to refresh context.
- Keep answers concise; link to `WARP.md` sections by filename and heading when referencing details.
