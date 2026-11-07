# Native MCP Client Setup

> **Audience**: users connecting a local AI client to SQL Server with this package

Install and configure the server once, then register it using your client's native MCP settings.
This guide covers local **stdio** connections, not an HTTP service, hosted connector or OAuth server.
A remote SQL Server is supported when the machine running the MCP process can reach it.

## Before you start

- Install Node.js **22.12 or later** and npm on the machine that will run the MCP process.
- Choose an approved SQL Server database and a least-privilege SQL authentication account.
  Do not use `sa` or an administrator account for the quickstart.
- Check your organization's policies before sending database rows or schema to an AI provider.
  Read-only access can still disclose sensitive data.
- Install a client version with local stdio MCP support. Organization policies may restrict servers.

The package is **`@egarcia74/warp-sql-server-mcp`**; its executable remains **`warp-sql-server-mcp`**.
Do not install the deprecated unscoped package. The examples use a global installation:

```bash
npm install -g @egarcia74/warp-sql-server-mcp
warp-sql-server-mcp --version
warp-sql-server-mcp init
```

For reproducible installations, select a supported release and replace `<version>` in the package
specifier `@egarcia74/warp-sql-server-mcp@<version>` before installing. Review newer security releases
deliberately. Version numbers in the [verification record](#compatibility-and-maintenance) describe
past checks, not a recommendation to stay on that release.

Edit the generated file locally:

- macOS/Linux: `~/.warp-sql-server-mcp.json`
- Native Windows: normally `%USERPROFILE%\.warp-sql-server-mcp.json`
- If `HOME` is set, the CLI uses it before `USERPROFILE`, including on Windows.

```json
{
  "SQL_SERVER_HOST": "sql.example.internal",
  "SQL_SERVER_PORT": "1433",
  "SQL_SERVER_DATABASE": "Reporting",
  "SQL_SERVER_USER": "mcp_reader",
  "SQL_SERVER_PASSWORD": "REPLACE_LOCALLY",
  "SQL_SERVER_ENCRYPT": "true",
  "SQL_SERVER_TRUST_CERT": "false",
  "SQL_SERVER_READ_ONLY": "true",
  "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "false",
  "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
}
```

Replace the connection values with your approved details. This is a **plaintext credential file**,
not an encrypted vault. `init` requests owner-only POSIX mode `0600`; review Windows ACLs separately.
Keep credentials out of Git, shell history and chat. Existing files are not overwritten by `init`,
so review older TLS settings. For an isolated local self-signed server only, explicitly set
`SQL_SERVER_TRUST_CERT=true` while keeping encryption enabled.

Nonempty environment values override the home file; the home file fills missing or empty values.
The launched server also loads absent values from its working directory's `.env`. Do not rely on
a client choosing the same working directory as your terminal. See
[configuration precedence](../reference/ENV-VARS.md#environment-variable-precedence).

Always launch **`warp-sql-server-mcp start`**. Omitting `start` prints help instead of starting MCP.
Direct `node index.js` skips the CLI's home-file loader. There is no `--config` or named-profile flag.

## Choose your client

| Client                                                  | Native setup                | Scope in this guide               |
| ------------------------------------------------------- | --------------------------- | --------------------------------- |
| [Codex](#codex)                                         | CLI or TOML                 | User; trusted project alternative |
| [Claude Code](#claude-code)                             | CLI                         | Explicit user scope               |
| [Claude Desktop](#claude-desktop)                       | JSON configuration          | User                              |
| [Cursor](#cursor)                                       | JSON configuration          | User or project                   |
| [Gemini CLI](#gemini-cli)                               | CLI or JSON                 | Explicit user scope               |
| [GitHub Copilot CLI](#github-copilot-cli)               | Interactive command or JSON | User                              |
| [OpenCode](#opencode)                                   | JSON configuration          | User or project                   |
| [Warp](#warp)                                           | MCP settings                | Local client configuration        |
| [GitHub Copilot in VS Code](#github-copilot-in-vs-code) | MCP command or JSON         | User or workspace                 |

Enabling a server exposes its tools to that client's agent under the client's permission policy.
Some clients invoke enabled tools without another prompt. Preserve project trust and confirmation
controls; do not enable trust-all or skip-permissions modes. Choose project scope if access should
not be available across projects. Merge JSON entries into existing files, preserving other servers.

The short commands below assume a macOS/Linux executable on PATH. For native Windows and GUI
launchers, use the [absolute Node/CLI recipe](#windows-and-gui-launchers).

Dates beside the source links below record documentation review, not runtime testing. See
[compatibility and maintenance](#compatibility-and-maintenance) for the execution checks performed.

### Codex

```bash
codex mcp add sql-server -- warp-sql-server-mcp start
codex mcp list
```

Alternatively, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.sql-server]
command = "warp-sql-server-mcp"
args = ["start"]
```

Trusted projects can use `.codex/config.toml`. Local CLI, IDE and desktop surfaces share configuration
for the same Codex host. Start a new session or restart the relevant client, inspect `/mcp`, then
[verify SQL access](#verify-the-connection). Hosted web sessions do not automatically use this file.

Source (reviewed 2026-11-07): [OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Claude Code

```bash
claude mcp add --transport stdio --scope user sql-server -- warp-sql-server-mcp start
claude mcp get sql-server
```

User scope is cross-project. The default `local` scope is private to the current project; both are
stored in `~/.claude.json`. `--scope project` writes `.mcp.json` and requires project approval.
Keep options before `--`. Start a new session and inspect `/mcp`. `mcp list` and `mcp get` may
health-check servers, so they are not guaranteed to be configuration-only reads.

Source (reviewed 2026-11-07): [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Claude Desktop

Open **Settings → Developer → Edit Config** and merge:

```json
{
  "mcpServers": {
    "sql-server": {
      "command": "warp-sql-server-mcp",
      "args": ["start"]
    }
  }
}
```

Config locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Fully quit and reopen the app, then inspect the server's available tools. Use absolute paths if
the GUI cannot find npm's executable. Do not assume `${VAR}` expands in Desktop JSON; the home-file
setup avoids that dependency. Standalone Claude Code does not automatically use Desktop chat's config.
For other desktop builds, confirm app availability and the config location in their current guide.

Sources (reviewed 2026-11-07): [MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers),
[Claude desktop guidance](https://code.claude.com/docs/en/desktop).

### Cursor

Use `~/.cursor/mcp.json` for user-wide access or `.cursor/mcp.json` for the project:

```json
{
  "mcpServers": {
    "sql-server": {
      "type": "stdio",
      "command": "warp-sql-server-mcp",
      "args": ["start"]
    }
  }
}
```

Enable the server in MCP settings and check its available tools; reload the server/client after
configuration changes if needed. View **Output → MCP Logs** for failures. Local configuration does
not automatically configure Cloud Agents.

Source (reviewed 2026-11-07): [Cursor MCP documentation](https://cursor.com/docs/mcp).

### Gemini CLI

```bash
gemini mcp add --scope user --transport stdio sql-server warp-sql-server-mcp start
gemini mcp list
```

User configuration is `~/.gemini/settings.json`; project configuration is `.gemini/settings.json`.
The registration default is **project**, so select user explicitly when cross-project access is
intended. Start a new session and inspect `/mcp`. Do not add `--trust`, which bypasses confirmations.
For environment-only credentials, explicitly map password variables as described
[below](#alternative-environment-injection); sensitive inherited names are filtered.

Sources (reviewed 2026-11-07): [Gemini MCP documentation](https://geminicli.com/docs/tools/mcp-server/),
[Gemini configuration](https://geminicli.com/docs/reference/configuration/).

### GitHub Copilot CLI

In an interactive session, enter **`/mcp add`**. Choose a local/stdio server, name it `sql-server`,
and use command `warp-sql-server-mcp start`. Set `HOME` in the server environment to the actual
absolute directory containing your saved configuration. Then inspect **`/mcp show sql-server`**.
Before querying, call `get_server_info` and confirm the expected host and database, following the
[connection verification steps](#verify-the-connection).

The user file is `~/.copilot/mcp-config.json`. **Template only:** replace `<absolute home directory>`
with the directory containing `.warp-sql-server-mcp.json` before enabling the server. A missing home
file does not stop startup; the server may instead use its working-directory `.env` or defaults:

```json
{
  "mcpServers": {
    "sql-server": {
      "type": "local",
      "command": "warp-sql-server-mcp",
      "args": ["start"],
      "env": { "HOME": "<absolute home directory>" },
      "tools": ["get_server_info", "execute_query"]
    }
  }
}
```

The current vendor guide only guarantees PATH inheritance; this CLI needs HOME or USERPROFILE. The example enables just
the two verification tools; add other tool names for your workflow. `tools: ["*"]` enables every
tool, not a least-privilege subset. Reload/restart the session after manually editing configuration.

Current vendor documentation also describes `copilot mcp add`, but installed version **0.0.382**
does not expose that subcommand in its help. The interactive/config-file route avoids that version
dependency. Copilot CLI does not read VS Code's `servers`-root `.vscode/mcp.json`. Newer project
configuration and trust behavior are documented separately by the vendor.

Source (reviewed 2026-11-07): [GitHub Copilot CLI MCP documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

### OpenCode

Use `~/.config/opencode/opencode.json` for user scope, or `opencode.json` in your project:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sql-server": {
      "type": "local",
      "command": ["warp-sql-server-mcp", "start"],
      "enabled": true
    }
  }
}
```

Start a new session and run `opencode mcp list` to inspect status. `opencode mcp add` is also
interactive. Unlike the other JSON examples, OpenCode uses `mcp`, a command array, and
`environment` for environment overrides. Do not copy an `mcpServers` entry unchanged.

Sources (reviewed 2026-11-07): [OpenCode MCP documentation](https://docs.opencode.ai/docs/mcp-servers/),
[configuration locations](https://docs.opencode.ai/docs/config/),
[CLI commands](https://docs.opencode.ai/docs/cli/).

### Warp

In **Settings → MCP**, add `sql-server`, command `warp-sql-server-mcp`, arguments `["start"]`.
Start/enable the server, inspect its tools and [verify SQL access](#verify-the-connection).
See the [existing Warp quickstart](QUICKSTART.md) for client logs and usage.

Source (reviewed 2026-11-07): [Warp MCP documentation](https://docs.warp.dev/agents/capabilities/mcp/).

### GitHub Copilot in VS Code

Run **MCP: Add Server → Command (stdio)**. Enter command `warp-sql-server-mcp`, argument `start`,
name `sql-server`, then choose user/global or workspace scope. The workspace file is
`.vscode/mcp.json`, using **`servers`**, not `mcpServers`:

```json
{
  "servers": {
    "sql-server": {
      "type": "stdio",
      "command": "warp-sql-server-mcp",
      "args": ["start"]
    }
  }
}
```

Start/restart the entry in `mcp.json`, choose Copilot Agent mode and enable the needed tools.
See the [VS Code quickstart](QUICKSTART-VSCODE.md).

Source (reviewed 2026-11-07): [VS Code MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Windows and GUI launchers

A desktop app may not inherit your terminal PATH, and clients differ in how they execute npm
`.cmd` shims. Launch the actual Node executable and installed **cli.js** as a portable alternative.
Use these PowerShell commands to discover paths; they do not change client settings:

```powershell
$Node = (Get-Command node.exe).Source
$McpCli = Join-Path (npm root -g) '@egarcia74/warp-sql-server-mcp/cli.js'
$McpHome = if ($env:HOME) { $env:HOME } else { $env:USERPROFILE }
& $Node $McpCli --version
$Node
$McpCli
$McpHome
```

Choose just the client you use:

```powershell
codex mcp add sql-server -- "$Node" "$McpCli" start
claude mcp add --transport stdio --scope user sql-server -- "$Node" "$McpCli" start
gemini mcp add --scope user --transport stdio sql-server "$Node" "$McpCli" start
```

For GUI clients or Copilot CLI's JSON file, substitute the discovered literal values into the
correct client wrapper. **Template only:** replace all three placeholders with the values printed
above before starting. This illustrates a command/args server entry, not a full client file:

```json
{
  "command": "<absolute path to node.exe>",
  "args": ["<absolute path to cli.js>", "start"],
  "env": { "HOME": "<absolute home directory>" }
}
```

Do not paste placeholders or PowerShell variables into your final JSON. Escape Windows backslashes:
for example, `"C:\\Tools\\node.exe"` in JSON represents the path `C:\Tools\node.exe`. Retain fields
required by the chosen client, including its type and tool selection. OpenCode needs
`command: [nodePath, cliPath, "start"]` and `environment`; TOML can use single-quoted literal Windows
paths. Do not switch to `index.js`, which would skip home configuration loading.

On macOS/Linux, obtain the equivalent values with `command -v node` and `npm root -g`, then use
the absolute Node path and `<global npm root>/@egarcia74/warp-sql-server-mcp/cli.js` with `start`.
Node-version-manager upgrades may move those paths. `cmd /c npx` is not a universal requirement;
an installed package avoids first-start downloads and additional shell parsing.

### WSL, containers and remote development

Install Node and the package where the MCP process actually runs. WSL uses its own paths and home
directory; do not silently mix Windows executables with Linux paths. Containers and SSH hosts also
have separate homes, networks and credentials. `localhost` means the MCP execution environment,
not automatically the laptop or SQL host. Local registration does not deploy an HTTP endpoint.

## Alternative environment injection

Use a trusted secret store or controlled launch environment when you do not want credentials in
the home JSON file. Supply a complete connection identity together: host, port, database, username
and password. Explicitly set TLS and safety values. Check required variables exist before starting:
an empty mapped value can fall back to a different saved home configuration.

For Codex, forward only the intended names:

```toml
[mcp_servers.sql-server]
command = "warp-sql-server-mcp"
args = ["start"]
env_vars = ["SQL_SERVER_HOST", "SQL_SERVER_PORT", "SQL_SERVER_DATABASE", "SQL_SERVER_USER", "SQL_SERVER_PASSWORD"]

[mcp_servers.sql-server.env]
SQL_SERVER_ENCRYPT = "true"
SQL_SERVER_TRUST_CERT = "false"
SQL_SERVER_READ_ONLY = "true"
SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS = "false"
SQL_SERVER_ALLOW_SCHEMA_CHANGES = "false"
```

For Gemini, the following server entry explicitly maps credentials, including the password that
would otherwise be filtered from inheritance. Merge it under `mcpServers` in `settings.json`:

```json
{
  "command": "warp-sql-server-mcp",
  "args": ["start"],
  "trust": false,
  "env": {
    "SQL_SERVER_HOST": "${SQL_SERVER_HOST}",
    "SQL_SERVER_PORT": "${SQL_SERVER_PORT}",
    "SQL_SERVER_DATABASE": "${SQL_SERVER_DATABASE}",
    "SQL_SERVER_USER": "${SQL_SERVER_USER}",
    "SQL_SERVER_PASSWORD": "${SQL_SERVER_PASSWORD}",
    "SQL_SERVER_ENCRYPT": "true",
    "SQL_SERVER_TRUST_CERT": "false",
    "SQL_SERVER_READ_ONLY": "true",
    "SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS": "false",
    "SQL_SERVER_ALLOW_SCHEMA_CHANGES": "false"
  }
}
```

The mappings are client-specific:

- **Claude Code project `.mcp.json`**: uses `${NAME}` in `env` values.
- **Cursor**: uses `${env:NAME}` in `env`; its optional `envFile` is a client feature.
- **OpenCode**: uses `{env:NAME}` in an `environment` object, not `env`.
- **Claude Desktop**: this guide does not assume variable interpolation. Use the home-file route
  or a separately validated secret-store launcher.
- **Copilot CLI**: use the home-file route with explicit HOME unless you have verified another
  secret-store integration. Do not place database passwords in `--env` command-line arguments.

Keep secret-bearing files out of Git. The home file and environment are accessible to programs
running with the same user's permissions; neither is an isolation boundary from that account.
For multiple databases, use distinct MCP names and complete connection overrides per server.
There is no built-in profile manager, and malformed home JSON still prevents CLI startup.

## Verify the connection

Registration, MCP initialization and SQL connectivity are three separate checks:

1. Confirm the client lists the server and its tools. Review any project-trust prompt.
2. Ask it to call `get_server_info` and check the intended host/database, encryption and all three
   safety settings. They should be read-only `true`, destructive `false`, schema changes `false`.
3. In your approved database, ask it to call `execute_query` with:

   ```sql
   SELECT 1 AS mcp_ok
   ```

   A single row with `mcp_ok = 1` proves a SQL operation succeeded. A “connected” MCP badge alone
   does not: the current implementation opens the database connection when an operation needs it.

Do not test destructive statements against production. Maintainers can use a disposable fixture
to verify the MCP safety-policy rejection separately from SQL permission failures. Database grants
remain an independent boundary even when the MCP guards are enabled.

## Troubleshooting

- **Executable not found:** check Node/npm installation in the execution environment, then use
  absolute Node and cli.js paths. Restart GUI clients after PATH changes.
- **Unexpected database or security settings:** inspect effective `get_server_info` output,
  inherited variables, HOME/USERPROFILE and working-directory `.env`. `config` shows the saved file,
  not every effective environment override.
- **Missing/malformed home config:** run `init` only to create a missing file; repair invalid JSON
  locally. Do not delete an existing credential file just to reset it.
- **Server registered but no tools:** check schema root, `start` argument, client enablement,
  project trust, tool selection and organization policy. Reload the server/session.
- **Invalid JSON-RPC:** do not launch `npm start`, a help command or a wrapper that writes banners
  to stdout. This server reserves stdout for MCP and sends diagnostics to stderr.
- **SQL operation fails:** check the target host/port, credentials, database grants and network
  route from the MCP machine. Use SQL authentication first; the NTLM branch is not evidence of
  working integrated Windows sign-on on your platform.
- **TLS error:** repair the trust chain or server certificate. Do not disable encryption; trust
  an unverified certificate only for an explicitly isolated local test server.
- **Slow first query:** SQL connection retries and query timeouts differ from the client's MCP
  startup/tool timeouts. Diagnose the failing stage before increasing either.
- **Logs:** use client-captured MCP stderr. Global npm installations do not contain repository
  `npm run logs*` scripts. For explicit files, see `LOG_FILE` and `SECURITY_LOG_FILE` in the
  [environment reference](../reference/ENV-VARS.md#logging-and-debugging-settings). Redact logs before sharing.

## Compatibility and maintenance

These are **documented native recipes**, not blanket certification of every client/platform.
Source and installed CLI-help review was performed on **2026-11-07**:

| Client                                | CLI help checked on macOS | Meaning                                                                         |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| Codex                                 | 0.166.0                   | Registration syntax confirmed                                                   |
| Claude Code                           | 2.1.314                   | Syntax and scope options confirmed                                              |
| Gemini CLI                            | 0.27.0                    | Syntax, scopes and trust option confirmed                                       |
| GitHub Copilot CLI                    | 0.0.382                   | Interactive `/mcp add` and `/mcp show` confirmed; newer subcommands unavailable |
| OpenCode                              | 1.15.11                   | Interactive add and list commands confirmed                                     |
| Claude Desktop, Cursor, Warp, VS Code | Not exercised             | Recipes reviewed against vendor documentation                                   |

Separately, package 2.1.2 was checked on macOS with Node 24.15.0 in an isolated home and working
directory: safe initialization, existing-file preservation, configuration precedence, clean JSON-RPC
startup, discovery of 16 tools, `get_server_info` and a safety-policy rejection before SQL access.
These package checks did not authenticate to or query a database.

CLI help is not a registration, protocol or database test. Native Windows, Linux, WSL and GUI-client
connections have not been runtime-tested for this guide. Record the package, Node, client version,
OS, scope and launch form whenever adding runtime validation. Do not infer minimum client versions
from this table. Recheck the linked primary sources when clients change their schemas.

The package implements stdio only: clients requiring an HTTP/SSE URL cannot connect directly.
Hosted chat/plugin/executor integration requires its own deployment and security design. Other
clients with local stdio support may work, but absence from this guide is not a claim of incompatibility.

See also the [security guide](../architecture/SECURITY.md),
[environment reference](../reference/ENV-VARS.md), and [documentation index](../README.md).
