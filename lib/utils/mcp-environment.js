/**
 * One answer to one question: **is this process's stdout carrying an MCP protocol
 * stream?**
 *
 * Under the stdio transport, stdout is the JSON-RPC channel. Anything else written
 * there - a dotenv banner, a CLI greeting, a Winston line - is interleaved with
 * protocol frames and can corrupt the stream. Every module that needs to keep output
 * off stdout is asking this same question, so it is answered in exactly one place.
 *
 * It used to be answered in three (issue #1256): `index.js` gated dotenv's banner on one
 * predicate, `cli.js` gated its startup banners on a slightly narrower copy, and
 * `Logger._isMcpEnvironment()` gated the stderr routing on a third that read only the
 * three VS Code variables. A client setting `MCP_TRANSPORT=stdio` - the documented way to
 * declare stdio transport - satisfied the first two and not the third, so its log lines
 * went to stdout. Three predicates answering one question is how that happens; this module
 * is the single judgement they now share.
 *
 * ## The signals, strongest first
 *
 * 1. `MCP_TRANSPORT=stdio` - the client stating the transport outright.
 * 2. `VSCODE_MCP=true` - the deliberate user override, honoured under any client.
 * 3. `VSCODE_PID` / `VSCODE_IPC_HOOK` - set by VS Code for its child processes.
 * 4. `PARENT_PROCESS` containing `code` or `mcp` - an optional launcher hint.
 * 5. Both stdio ends are pipes and a parent process exists - the shape of a spawned
 *    stdio server. This is the fallback that covers a client which declares nothing.
 *
 * Signal 5 deliberately requires *both* ends. `node index.js > out.log` from a terminal
 * redirects stdout but leaves stdin a TTY, and that is a human reading output, not a
 * protocol peer; treating it as one would move a developer's logs to stderr for no reason.
 *
 * The cost of a false positive is small and recoverable - output lands on stderr, which
 * MCP clients capture as server logs and a terminal still shows. The cost of a false
 * negative is a corrupted protocol stream. The signals are therefore a union, not a
 * consensus.
 *
 * @returns {boolean} True when stdout must be treated as a protocol stream
 */
export function isMcpStdioTransport() {
  // Explicit declarations by the client or the user.
  if (process.env.MCP_TRANSPORT === 'stdio') {
    return true;
  }

  if (process.env.VSCODE_MCP === 'true') {
    return true;
  }

  // VS Code sets these for processes it launches.
  if (process.env.VSCODE_PID || process.env.VSCODE_IPC_HOOK) {
    return true;
  }

  // Optional launcher hint.
  const parentProcess = process.env.PARENT_PROCESS;
  if (parentProcess?.includes('code') || parentProcess?.includes('mcp')) {
    return true;
  }

  // Fallback: a spawned process with pipes on both ends. `isTTY` is `undefined` rather
  // than `false` on a pipe, so both spellings are treated as "not a terminal".
  const stdoutIsPipe = !process.stdout.isTTY;
  const stdinIsPipe = !process.stdin.isTTY || process.stdin.isTTY === undefined;

  return Boolean(stdoutIsPipe && stdinIsPipe && process.ppid);
}
