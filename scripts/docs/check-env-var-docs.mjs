#!/usr/bin/env node
/**
 * Fails when `docs/reference/ENV-VARS.md` and the shipped code disagree about which
 * environment variables exist, in either direction.
 *
 * This mirrors the MCP tool-doc-sync check already in `docs.yml` (the "Validate MCP tool
 * documentation" step): extract what the code declares, compare it against what the docs
 * declare, report both counts and the difference. The difference is that the tool check
 * only reports, while this one exits non-zero - ENV-VARS.md calls itself "the single
 * source of truth" for configuration, and a source of truth that is allowed to drift is
 * just another document.
 *
 * ## How the code's variables are found, and what that can miss
 *
 * There is no manifest to read. `lib/config/server-config.js` is the central config
 * module and it does centralise *loading*, but it enumerates nothing: each setting is a
 * separate `process.env.NAME` expression inside `_loadConfiguration()`, and four more
 * modules (`index.js`, `cli.js`, `lib/database/connection-manager.js`,
 * `lib/utils/logger.js`) read `process.env` directly for logging paths and environment
 * detection. Instantiating `ServerConfig` behind a `process.env` Proxy was considered and
 * rejected for the same reason: it would observe only the variables read during
 * construction, missing everything `ConnectionManager` reads at connect time and
 * everything the logger reads when a transport is built.
 *
 * So the method is a static scan for `process.env.NAME` and `process.env['NAME']` over
 * the JavaScript npm actually publishes - the `.js` entries and directories in
 * package.json's `files` list. Deriving the scan scope from `files` rather than hardcoding
 * it means a new shipped directory is covered without touching this script, and keeps the
 * check aligned with the thing the docs describe: the published server, not the repo's
 * test and CI tooling (which has its own knobs - MCP_TESTING_MODE, TESTING_MODE,
 * GITHUB_OUTPUT - that are not user configuration and are deliberately out of scope).
 *
 * What the scan misses, stated plainly:
 *
 *  - **Computed names.** `cli.js`'s `loadConfigToEnv()` does `process.env[key]` over the
 *    keys of `~/.warp-sql-server-mcp.json`. A variable that only ever arrives that way is
 *    invisible here. In practice that path only re-exports names the server then reads by
 *    literal name, so it is covered indirectly - but a genuinely dynamic name would not be.
 *  - **Destructuring.** `const { FOO } = process.env` would not match. There is none today.
 *  - **Reads in dependencies.** Anything `mssql` or `winston` consults on their own.
 *  - **Dead reads.** A `process.env.FOO` on an unreachable branch still counts as read,
 *    so the check can demand documentation for something no longer used. That direction
 *    is a cheap failure: the fix is deleting the read.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The document being held to the code. */
export const ENV_VARS_DOC = 'docs/reference/ENV-VARS.md';

/**
 * Variables read by the shipped code that ENV-VARS.md is *not* expected to document,
 * because they are not settings of this server: the OS, the editor or the test runner
 * puts them in the environment, and documenting them would invite users to set them.
 *
 * Anything this server actually responds to as configuration - including the awkward
 * cases like NODE_ENV, which changes the SSL certificate-trust default - belongs in the
 * document instead of on this list.
 */
export const AMBIENT_VARS = new Map([
  ['HOME', 'set by the OS; used only to locate ~/.warp-sql-server-mcp.json'],
  ['USERPROFILE', 'the Windows spelling of HOME'],
  ['VSCODE_PID', 'set by VS Code itself; read as an MCP-environment indicator'],
  ['VSCODE_IPC_HOOK', 'set by VS Code itself; read as an MCP-environment indicator'],
  ['VITEST', 'set by the test runner; guards a test-only branch']
]);

/**
 * Blanks out everything that is not executable code - the body of every comment and of
 * every string or template literal - replacing each character with a space so that offsets
 * into the result still line up with the original source.
 *
 * Without this, `// SQL_SERVER_LEGACY was removed, we no longer read process.env.X` or a
 * usage string quoting `process.env.X` counts as a read, and the gate then demands an
 * ENV-VARS.md entry for a variable nothing reads. The failure mode is worse than a miss:
 * the cheapest way out is to add a bogus entry, so the check would actively corrupt the
 * document it exists to protect.
 *
 * Newlines survive so that line numbers are preserved for anything that reports them.
 *
 * Not a JavaScript parser: regular-expression literals are not tracked, so a literal
 * containing an unescaped `//` could be mistaken for a line comment. No such literal
 * exists in the shipped sources, and the alternative - taking on a parser dependency for
 * a lint script - costs more than it buys here.
 */
export function maskNonCode(source) {
  // Split into UTF-16 code units, NOT code points: every index below - `i`, `j`,
  // `source.length`, `indexOf` - is a code-unit offset, and `[...source]` would yield a
  // code-point array whose indices drift left of those by one per astral character. The
  // drift silently relocates each blanked span, and past a dozen emoji it erases a real
  // `process.env` read outright, so the scan reports "in sync" while a variable goes
  // undocumented. `Array.from` with a length is the spelling that stays in code units.
  const out = Array.from({ length: source.length }, (_, index) => source[index]);
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);

    if (pair === '//') {
      let j = i;
      while (j < source.length && source[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', i + 2);
      const j = end === -1 ? source.length : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    // A template literal is not simply a string: everything inside `${...}` is executable
    // code, so blanking the whole body would hide a real read - `` `${process.env.X}` ``
    // is exactly how a URL or connection string gets built. The literal text around the
    // substitutions is still masked; only the substitutions are left standing.
    if (source[i] === '`') {
      let j = i + 1;
      let literalStart = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === '`') break;
        if (source[j] === '$' && source[j + 1] === '{') {
          blank(literalStart, j);
          // Walk to the matching close brace, counting nesting so that an object literal
          // or a nested template inside the substitution does not end it early.
          let depth = 0;
          let k = j + 1;
          for (; k < source.length; k++) {
            if (source[k] === '{') depth++;
            else if (source[k] === '}') {
              depth--;
              if (depth === 0) break;
            }
          }
          j = k < source.length ? k + 1 : source.length;
          literalStart = j;
          continue;
        }
        j++;
      }
      blank(literalStart, j);
      i = j < source.length ? j + 1 : source.length;
      continue;
    }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      // Blank the body, keep the delimiters: `process.env['NAME']` must stay recognisable
      // as a bracket access even though NAME itself is read back from the original source.
      blank(i + 1, j - 1);
      i = j;
      continue;
    }
    i++;
  }

  return out.join('');
}

/**
 * True when the access ending at `after` is being written to rather than read.
 *
 * `process.env.CHILD_FLAG = '1'` sets a variable for a child process; it is an output of
 * this program, not a setting a user supplies, so demanding an ENV-VARS.md entry for it
 * would document a knob that does not exist and push someone towards a bogus entry.
 *
 * Only a plain `=` counts. `==`, `===` and `=>` are not assignments at all, and the
 * compound forms (`+=`, `||=`, `??=`) read the current value before writing it back, which
 * makes them genuine reads.
 */
function isAssignmentTarget(masked, after) {
  const rest = masked.slice(after);
  return /^\s*=(?![=>])/.test(rest);
}

/**
 * Every `process.env.NAME` / `process.env['NAME']` that is actually code in one file.
 *
 * Both spellings are matched because both appear in JavaScript generally; only the dotted
 * one appears in this repo today with a literal name (`cli.js` writes `process.env[key]`
 * with a computed one, which no static scan can name). Both spellings apply the same
 * assignment exclusion - leaving it on one spelling only is how the two drift apart.
 */
export function readEnvVarsFromSource(source) {
  const masked = maskNonCode(source);
  const found = new Set();

  for (const match of masked.matchAll(/process\.env\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    if (isAssignmentTarget(masked, match.index + match[0].length)) continue;
    found.add(match[1]);
  }

  // The bracket form is located in the masked source (so a quoted mention inside a comment
  // cannot match) and its name is then read back from the original, where the string body
  // still exists.
  for (const match of masked.matchAll(/process\.env\[\s*(['"])/g)) {
    const quote = match[1];
    const start = match.index + match[0].length;
    let end = start;
    while (end < source.length) {
      if (source[end] === '\\') {
        end += 2;
        continue;
      }
      if (source[end] === quote) break;
      end++;
    }
    const name = source.slice(start, end);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;

    // Past the closing quote AND the closing bracket, so the assignment check sees the same
    // thing it sees for the dotted form. Skipping only to the quote would read `]` as the
    // next token and never match `=`. The bracket form needs this exactly as much as the
    // dotted one does: `process.env['X'] = '1'` is a write, not a setting a user supplies,
    // and demanding a doc entry for it is the false failure the dotted-form check avoids.
    const closingBracket = source.indexOf(']', end);
    if (closingBracket !== -1 && isAssignmentTarget(masked, closingBracket + 1)) continue;

    found.add(name);
  }

  return found;
}

/**
 * Markdown a reader never sees: fenced blocks and HTML comments.
 *
 * The comment pass loops to a fixed point and then truncates at the first surviving
 * opener, matching the orphan check's treatment - an unterminated `<!--` hides the rest of
 * the document, and removing one balanced pair can expose an opener that was inside it.
 */
export function stripHiddenMarkdown(markdown) {
  const withoutFences = markdown.replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2\s*$/gm, '');

  let visible = withoutFences;
  let previous;
  do {
    previous = visible;
    visible = visible.replaceAll(/<!--[\s\S]*?-->/g, '');
  } while (visible !== previous);

  const unterminated = visible.indexOf('<!--');
  return unterminated === -1 ? visible : visible.slice(0, unterminated);
}

/**
 * The variables ENV-VARS.md documents, taken from its `### \`NAME\`` headings.
 *
 * Headings rather than every backticked capitalised token: the prose legitimately
 * mentions values (`CORP`, `WORKGROUP`) and cross-references other variables, and only a
 * heading means "this document defines this variable".
 *
 * Fenced blocks and HTML comments are removed first. A heading-shaped line inside either
 * renders as nothing - a `.env` sample in a fence is exactly the shape that collides - and
 * counting it would let a shipped read satisfy the gate against documentation no reader
 * can see, which is the precise failure this check exists to prevent.
 *
 * Inline code is deliberately NOT stripped here, unlike in the orphan check: every heading
 * in this document is written `### \`NAME\``, so removing code spans would delete the very
 * thing being collected.
 */
export function readDocumentedEnvVars(markdown) {
  const rendered = stripHiddenMarkdown(markdown);
  const found = new Set();
  for (const match of rendered.matchAll(/^#{2,4}\s+`([A-Z][A-Z0-9_]*)`\s*$/gm)) {
    found.add(match[1]);
  }
  return found;
}

/**
 * The comparison, as a pure function so it is testable without a checkout.
 *
 * @param {object} input
 * @param {Iterable<string>} input.read variables the code reads
 * @param {Iterable<string>} input.documented variables ENV-VARS.md defines
 * @param {Map<string,string>} [input.ambient] variables exempt from documentation
 */
export function compareEnvVarDocs({ read, documented, ambient = AMBIENT_VARS }) {
  const readSet = new Set(read);
  const documentedSet = new Set(documented);

  const configurable = [...readSet].filter(name => !ambient.has(name)).sort();
  const ignored = [...readSet].filter(name => ambient.has(name)).sort();

  const undocumented = configurable.filter(name => !documentedSet.has(name));
  // An ambient variable that someone documented anyway is a contradiction between this
  // list and the document, so it is reported rather than quietly accepted either way.
  const unread = [...documentedSet].filter(name => !readSet.has(name) || ambient.has(name)).sort();

  return {
    ok: undocumented.length === 0 && unread.length === 0,
    read: [...readSet].sort(),
    configurable,
    ignored,
    documented: [...documentedSet].sort(),
    undocumented,
    unread
  };
}

/**
 * Every extension Node treats as a JavaScript module. `.js` alone would skip a shipped
 * `.mjs` or `.cjs` silently - and silently is the problem: npm packs the file, the server
 * reads its variables at runtime, and the gate would report "in sync" regardless. The repo
 * already writes `.mjs` elsewhere (`scripts/lib/release-plan.mjs`), so a published one is
 * a matter of time rather than a hypothetical.
 */
const JS_MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs'];

const isJsModule = name => JS_MODULE_EXTENSIONS.some(extension => name.endsWith(extension));

/**
 * The JavaScript files npm publishes, from package.json's `files` list.
 *
 * Entries that are neither a `.js` file nor a directory (the markdown and HTML globs, and
 * the `!` negations) are skipped: they carry no `process.env` reads, and expanding globs
 * here would be a second, worse copy of npm's own packing rules.
 */
export function shippedJsFiles(pkgFiles, root = repoRoot) {
  const found = [];

  const walk = relative => {
    const absolute = path.resolve(root, relative);
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (isJsModule(entry.name)) found.push(child);
    }
  };

  for (const entry of pkgFiles) {
    if (entry.startsWith('!') || entry.includes('*')) continue;
    const clean = entry.replace(/\/$/, '');
    let stats;
    try {
      stats = statSync(path.resolve(root, clean));
    } catch {
      continue; // listed but absent - npm's own packing already warns about that
    }
    if (stats.isDirectory()) walk(clean);
    else if (isJsModule(clean)) found.push(clean);
  }

  return found.sort();
}

/** Reads the shipped sources and the doc off disk, and runs the comparison. */
export function checkEnvVarDocs(root = repoRoot) {
  const pkg = JSON.parse(readFileSync(path.resolve(root, 'package.json'), 'utf8'));
  const sources = shippedJsFiles(pkg.files ?? [], root);

  const read = new Set();
  for (const file of sources) {
    for (const name of readEnvVarsFromSource(readFileSync(path.resolve(root, file), 'utf8'))) {
      read.add(name);
    }
  }

  const documented = readDocumentedEnvVars(readFileSync(path.resolve(root, ENV_VARS_DOC), 'utf8'));

  return { sources, ...compareEnvVarDocs({ read, documented }) };
}

/**
 * The report body, in the shape the existing tool-doc-sync check in `docs.yml` writes, so
 * both land in `link-report.md` reading like one document.
 */
export function formatReport(result) {
  const list = names => names.map(name => `\`${name}\``).join(', ');
  const lines = [
    `**Variables read by shipped code**: ${result.configurable.length}` +
      (result.ignored.length > 0 ? ` (plus ${result.ignored.length} ambient, not settings)` : ''),
    `**Variables documented in \`${ENV_VARS_DOC}\`**: ${result.documented.length}`
  ];

  if (result.undocumented.length > 0) {
    lines.push(`❌ **Read but undocumented**: ${list(result.undocumented)}`);
  }
  if (result.unread.length > 0) {
    lines.push(`❌ **Documented but not read by any shipped code**: ${list(result.unread)}`);
  }
  if (result.ok) {
    lines.push('✅ **Environment variable documentation matches the code**');
  }

  return lines.join('\n');
}

function main() {
  const result = checkEnvVarDocs();
  console.log(formatReport(result));

  if (result.ok) return;

  console.error(
    `\n::error::${ENV_VARS_DOC} has drifted from the code: ` +
      `${result.undocumented.length} undocumented, ${result.unread.length} stale.`
  );
  if (result.undocumented.length > 0) {
    console.error(`  - document: ${result.undocumented.join(', ')}`);
  }
  if (result.unread.length > 0) {
    console.error(`  - remove from the doc, or restore the read: ${result.unread.join(', ')}`);
  }
  console.error(
    '\nIf a variable is not a setting of this server - the OS, the editor or the test\n' +
      'runner supplies it - add it to AMBIENT_VARS in scripts/docs/check-env-var-docs.mjs\n' +
      'with the reason, instead of documenting it as configuration.'
  );
  process.exitCode = 1;
}

// Compare as file URLs: process.argv[1] is a plain filesystem path while import.meta.url
// is percent-encoded, so a hand-built `file://` + path string fails to match whenever the
// checkout contains a space, and main() would be skipped silently - exit 0, gate never run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
