Continue config added

What’s configured

- System rule: Reminds the assistant to consult `WARP.md` first.
- Context preset: Adds a one‑click "WARP Knowledge Doc" item (file provider) to include `WARP.md` in prompts.
- Embeddings provider: Set to `local` if available to support semantic search.

How to use

- In the Continue sidebar, click "Add context" and choose "WARP Knowledge Doc" to attach `WARP.md` to a chat.
- Or paste `@file WARP.md` (if your build supports mentions) to include it.

Optional: enable full‑repo semantic search

- In the Continue sidebar, run "Index workspace" or enable embeddings in settings. This uses the local embeddings provider set in `.continue/config.json`.
- You can also add a repo‑wide preset by extending `customContext` with the `codebase` provider, for example:

  {
  "name": "Repo Codebase",
  "provider": "codebase",
  "params": { "include": ["."] }
  }

Notes

- Continue schemas vary slightly by version; this config uses common fields
  (`systemMessage`, `contextProviders`, `customContext`, `embeddingsProvider`).
  If your Continue build reports a schema error, let me know and I’ll adapt it.
