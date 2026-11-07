# Guided Configuration and Connection Validation

> **Audience**: Users setting up or changing a local SQL Server MCP connection.

## Commands

```bash
warp-sql-server-mcp config edit
warp-sql-server-mcp config validate
```

`config edit` requires interactive stdin and stdout terminals. It opens Connection,
Authentication, TLS, Safety and Advanced sections, with Back, Review, Validate connection,
Save and Cancel actions. Changes stay in memory until you explicitly confirm Save. A failed
connection test does not prevent saving locally valid settings. Validation alone never saves.

`config validate` works without a terminal and checks the saved file and effective settings
before connecting. It runs only `SELECT 1 AS mcp_ok` in the configured database, then closes
the connection. Success verifies that probe, not permissions for every MCP tool. It neither
starts MCP nor changes TLS flags after a certificate error. No password or arbitrary SQL
command-line options are supported.

`init` still creates the existing template once. Bare `config` still displays the saved file
with password aliases and known saved credential copies masked, including nested scalar values.
Only secret-bearing display values may become mask strings; ordinary unknown JSON values/types,
empty values and escaped controls are preserved. This display never resolves dotenv/environment
values or changes the saved file. `start`, help and version commands retain their existing roles.
Use `start` when registering this server in an MCP client.

## Saved and effective values

The destination is `.warp-sql-server-mcp.json` under `HOME`, falling back to `USERPROFILE`.
A missing home location is an error. The editor preserves unexposed settings without displaying
their contents and distinguishes the draft from effective settings and their sources:

1. Inherited environment variables win when nonempty.
2. The saved file fills missing or empty inherited values, with the runtime's string conversions.
3. Dotenv loads the selected source, normally the working directory's `.env`. By default it fills
   absent keys, so an explicitly empty key blocks dotenv. `DOTENV_OVERRIDE=true` instead replaces
   existing inherited or saved values, including empty or identical values; Review labels every
   dotenv assignment `[dotenv]`. The runtime may still apply built-in defaults.
4. The runtime applies defaults and contextual certificate trust.

Removing a saved key can expose a value from another source. Keep preserves an existing empty
value and JSON type. Changed boolean/numeric editor values are stored as strings. On Windows,
environment keys are case-insensitive and the worker receives one canonical key per name;
new commands reject case-colliding saved or inherited keys. POSIX keys remain case-sensitive.
Direct `node index.js` still skips the home file and uses the same dotenv controls.

Dotenv controls are resolved after the home-file overlay. `DOTENV_PATH`, `DOTENV_ENCODING`,
`DOTENV_OVERRIDE` and `DOTENV_FAST` take precedence over the corresponding `DOTENV_CONFIG_*`
fallback aliases when present, even if empty. Thus a saved direct alias can outrank an inherited
fallback alias. Empty path/encoding means the default `.env`/UTF-8; boolean false tokens are
`false`, `0`, `no`, `off` and empty (case-insensitive). Other strings enable the boolean option.
Paths may be absolute, relative to the working directory, or start with `~` for the candidate
native home. A path is one filename, not a comma list or JSON array. This installed dotenv has
no vault handling. Controls inside the loaded file do not trigger another load. Output remains
quiet with debug disabled regardless of verbosity aliases. Missing sources are allowed; unreadable
sources or invalid encodings fail new-command local checks. Review and Validate use the same
candidate options as startup, without taking options from a different ambient environment.

Both stored and effective recognized fields must be valid, even when an environment override
hides a bad stored value. Local checks reject malformed numbers, invalid booleans, partial
effective username/password pairs and pool minimum greater than maximum. Advanced maximum
connection attempts maps to `SQL_SERVER_MAX_RETRIES` and accepts 1 through 10.
See the [environment reference](../reference/ENV-VARS.md) for settings and ranges.

Review always labels password presence/source using a fixed mask. Environment and dotenv
credentials are never copied into the draft. Password actions are Keep, Replace with hidden
entry, and explicitly confirmed Remove; replacement preserves whitespace and does not echo
password length. Empty replacement is rejected: use Remove instead.

## Authentication, TLS and safety

Supply both effective SQL username and password for SQL authentication. Both may be absent,
but the legacy NTLM branch is limited: the default Tedious driver does **not** provide trusted
current-Windows-login authentication, and this branch passes only a domain. The editor warns
rather than claiming a working integrated-login path. An inherited credential can prevent
removal of a saved key from changing the effective authentication mode.

New drafts explicitly enable encryption and certificate validation, keep read-only mode on,
and disable destructive and schema permissions. Existing explicit values and absent trust keys
are preserved. Contextual certificate trust can change after a host or `NODE_ENV` change;
security reductions require acknowledgment. TLS failures never weaken settings automatically.

Read-only mode dominates both other safety flags. Enabled flags beneath it are dormant and
become active if read-only mode is disabled. With read-only off, data modification and schema
changes are independent. Review and confirmation explain these risks rather than silently
resetting flags.

## File safety and plaintext passwords

Saved passwords are **plaintext**, not encrypted secrets. Use existing environment-based
credentials when appropriate. On POSIX, saving creates a restrictive mode `0600` replacement
inside a current-user-owned home directory that is not group/other-writable. Unsafe targets,
symlinks, multiple hard links, malformed JSON and files over 1 MiB are refused rather than
silently replaced. Windows mode bits do not establish a private DACL: check the user-profile ACL.

Save holds a sibling `.warp-sql-server-mcp.json.lock` directory and compares the original file's
identity and content before atomic publication. A conflicting editor must reload explicitly or
cancel; there is no forced overwrite or automatic merge. Busy/stale locks are not broken
silently. Confirm that no editor is running before manually removing a stale lock.

Errors or cancellation before publication preserve the old file. After rename/link publication,
Save is committed and reported as Saved even if durability or owned temporary-name cleanup
cannot be confirmed. There are no persistent backups. A hard crash or an ordinary filesystem cleanup failure can leave a recognizable,
mode-`0600` `.warp-sql-server-mcp.tmp-…` file containing credentials; inspect and remove only
confirmed orphan files. Portable filesystems cannot protect against arbitrary hostile same-user
writers, SIGKILL, unreliable remote filesystems or hardware failure.

## Cancellation, limits and statuses

Validation's total deadline is 60 seconds, including retries and normal cleanup. It then allows
2 seconds for graceful shutdown and 1 second to confirm hard termination, normally at most
63 seconds plus OS scheduling. A second Ctrl+C requests immediate termination. Success requires
both successful query/cleanup and clean worker exit; unconfirmed termination is a failure.
If termination cannot be confirmed, the parent releases its own handles so it can exit; this does
not prove the worker stopped.
During an editor probe, Cancel validation returns to the editor. Ctrl+C or SIGTERM exits the
editor without another discard prompt. Menu Cancel confirms discarding unsaved changes.

Validation refuses nonempty `NODE_OPTIONS`, `NODE_V8_COVERAGE`, `LD_PRELOAD`, `LD_AUDIT`,
`DYLD_INSERT_LIBRARIES` and `LD_DEBUG_OUTPUT`. Rerun in a shell without them. It does not strip
these silently, change `NODE_ENV`, or remove normal TLS trust inputs. Save and start are unaffected.

New-command exit statuses:

- `0`: saved successfully or clean validation.
- `1`: probe, runtime, total timeout or cleanup failure.
- `2`: usage, file, local configuration, noninteractive editor or unsupported environment.
- `130`: Cancel or SIGINT.
- `143`: SIGTERM.

The implementation has macOS PTY and POSIX file-safety evidence, Windows environment-semantics
unit coverage, and Node runtime-floor/package smoke tests. Native Windows/Linux terminal and
Windows ACL behavior need separate platform validation; unit coverage does not establish it.

See [Native MCP Client Setup](MCP-CLIENT-SETUP.md) to register the configured server.
