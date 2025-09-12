# Release v1.7.12

## Highlights

- Windows stdio handshake fix when launching via CLI in MCP environments (VS Code/Warp):
  - CLI startup banners now go to stderr in MCP/stdio environments, preventing JSON handshake pollution on stdout.
  - Detection via `VSCODE_MCP`, `MCP_TRANSPORT=stdio`, or non‑TTY stdio.
  - No behavior change for normal terminal usage.

## Changes

- fix(cli): route CLI startup banners to stderr in MCP/stdio envs to avoid handshake pollution on Windows
- docs: add Windows note about v1.7.12 stdio fix; guidance for older versions

## Upgrade Notes

- Recommended on Windows if using VS Code/Warp MCP with the CLI wrapper.
- If you cannot upgrade yet, you can:
  - Launch the server entry directly with Node: `node <global-npm-path>/@egarcia74/warp-sql-server-mcp/index.js`
  - Set `VSCODE_MCP=true` (and optionally `MCP_TRANSPORT=stdio`) so logs route to stderr.

## Verification

- Full unit, integration, protocol, and performance test suites passed.
