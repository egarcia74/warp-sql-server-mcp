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

import { stripFencedBlocks, stripHtmlComments, byCodeUnit } from './markdown-blocks.mjs';

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

/** End of a `//` comment: the newline, which is left in place. */
function endOfLineComment(source, start) {
  let j = start;
  while (j < source.length && source[j] !== '\n') j++;
  return j;
}

/** End of a `/* *\/` comment, or end of file when it is never closed. */
function endOfBlockComment(source, start) {
  const closer = source.indexOf('*/', start + 2);
  return closer === -1 ? source.length : closer + 2;
}

/**
 * End of a `${...}` substitution, counting brace nesting so that an object literal or a
 * nested template inside it does not end the substitution early.
 *
 * This is the second of the two declined limits described at the top of the file: braces
 * are counted structurally, so a `}` inside a string or a comment closes the substitution
 * even though it is not executable. Closing that properly means tokenising the embedded
 * expression, and skipping quoted spans alone would only move the failure to braces inside
 * regular expressions and comments.
 */
function endOfSubstitution(source, start) {
  // `start` is the index of the opening `{`, and the scan begins there so that brace
  // contributes to the depth. Starting one later leaves depth at zero, the first `}` takes
  // it negative and the substitution never closes - which is what a differential run
  // against the previous implementation caught on `lib/utils/logger.js`.
  let depth = 0;
  for (let k = start; k < source.length; k++) {
    if (source[k] === '{') depth++;
    else if (source[k] === '}') {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return source.length;
}

/**
 * Masks one template literal, leaving its substitutions standing, and returns the index
 * just past it.
 *
 * A template literal is not simply a string: everything inside `${...}` is executable
 * code, so blanking the whole body would hide a real read - `` `${process.env.X}` `` is
 * exactly how a URL or connection string gets built. The literal text around the
 * substitutions is still masked; only the substitutions survive.
 */
function maskTemplateLiteral(source, start, blank) {
  let j = start + 1;
  let literalStart = start + 1;

  while (j < source.length) {
    if (source[j] === '\\') {
      j += 2;
      continue;
    }
    if (source[j] === '`') break;
    if (source[j] === '$' && source[j + 1] === '{') {
      blank(literalStart, j);
      j = endOfSubstitution(source, j + 1);
      literalStart = j;
      continue;
    }
    j++;
  }

  blank(literalStart, j);
  return j < source.length ? j + 1 : source.length;
}

/**
 * Masks one `'...'` or `"..."` string body, keeping its delimiters, and returns the index
 * just past it.
 *
 * The delimiters survive so that `process.env['NAME']` stays recognisable as a bracket
 * access even though NAME itself is read back from the original source.
 *
 * An unescaped newline ends the string. A non-template string literal cannot span one, so
 * a quote still open at the line end was never a string opener - most often it is a quote
 * inside a regular-expression literal, the first of the two declined limits described at
 * the top of the file. Stopping here confines the damage to a single line instead of
 * letting it run to the next matching quote or to end of file, which is how a real
 * `process.env` read used to vanish from a shipped module.
 */
function maskStringLiteral(source, start, blank) {
  const quote = source[start];
  let j = start + 1;
  let closed = false;

  while (j < source.length) {
    if (source[j] === '\\') {
      // A backslash-newline is a line continuation, so this deliberately steps over a
      // newline: such a string really does carry on to the next line.
      j += 2;
      continue;
    }
    if (source[j] === '\n') break;
    if (source[j] === quote) {
      closed = true;
      break;
    }
    j++;
  }

  blank(start + 1, j);
  return closed ? j + 1 : j;
}

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
 * ## Deliberately not a JavaScript parser
 *
 * Two residual limits are known, named here so the next reader finds the decision rather
 * than the gap. Both would need real tokenisation to close, and taking on a parser
 * dependency for a lint script costs more than it buys - it puts a transitive dependency
 * tree in the path of a check whose whole job is to be trustworthy.
 *
 *  1. **Regular-expression literals are not tracked.** A literal containing a quote -
 *     `lib/utils/csv.js`'s `/[",\r\n]/` is a real shipped example - opens what this
 *     scanner reads as a string. Deciding whether a `/` starts a regex or is division
 *     requires knowing the preceding token, which is the parser.
 *
 *     This *was* unbounded: the false string ran to the next matching quote or to EOF,
 *     and it masked 95% of `csv.js`, so a `process.env` read added anywhere below line 29
 *     of that file would have vanished from the scan. That is now bounded to the rest of
 *     the offending line, by the correct language rule rather than a heuristic: a
 *     non-template string literal cannot contain an unescaped newline, so an unterminated
 *     quote ends at the line end. A quote inside a regex still masks the remainder of
 *     *its own* line - a real but much smaller hole, and one no shipped source hits,
 *     since every such literal here is the last expression on its line.
 *
 *  2. **Braces inside template substitutions are counted structurally.** The walker below
 *     matches `{`/`}` without regard for quotes or comments, so `` `${"}" && x}` `` ends
 *     the substitution at the quoted brace. Unlike case 1 there is no correct local rule
 *     to reach for: finding where `${` ends means tokenising the embedded expression, and
 *     skipping quoted spans only moves the failure to braces in regexes and comments.
 *     No source in this repository contains a braced string literal inside a
 *     substitution, and the shape is rare in practice.
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
      const end = endOfLineComment(source, i);
      blank(i, end);
      i = end;
    } else if (pair === '/*') {
      const end = endOfBlockComment(source, i);
      blank(i, end);
      i = end;
    } else if (source[i] === '`') {
      i = maskTemplateLiteral(source, i, blank);
    } else if (source[i] === '"' || source[i] === "'") {
      i = maskStringLiteral(source, i, blank);
    } else {
      i++;
    }
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
 * True when the access starting at `at` is the operand of `delete`.
 *
 * `delete process.env.CHILD_FLAG` removes a variable this program set for a child process.
 * Like the assignment it mirrors, it is an output of this program rather than a setting a
 * user supplies, and demanding an ENV-VARS.md entry for it would document a knob that does
 * not exist - pushing whoever hits the failure towards a bogus entry, which is the one
 * outcome this check must never cause.
 *
 * The lookback is bounded because only the immediately preceding token can be `delete`,
 * and it runs over the masked source so the word cannot come from a comment or a string.
 */
function isDeleteTarget(masked, at) {
  return /\bdelete\s+$/.test(masked.slice(Math.max(0, at - 32), at));
}

/**
 * Every `process.env.NAME` / `process.env['NAME']` that is actually code in one file.
 *
 * Both spellings are matched because both appear in JavaScript generally; only the dotted
 * one appears in this repo today with a literal name (`cli.js` writes `process.env[key]`
 * with a computed one, which no static scan can name). Both spellings apply the same
 * assignment exclusion - leaving it on one spelling only is how the two drift apart.
 *
 * The lookbehind requires an identifier boundary before `process`, so an unrelated object
 * whose name merely ends in it - `subprocess.env.CHILD_FLAG`, `myProcess.env.X` - is not
 * read as the Node global. Without it the gate demands an ENV-VARS.md entry for a variable
 * this server never reads, which is the false-failure direction that pushes someone toward
 * a bogus entry. The `.` in the class also rules out `foo.process.env.X`, a property of
 * something else rather than the global.
 *
 * Optional chaining is accepted in both: `process.env?.NAME` and `process.env?.['NAME']`
 * are ordinary JavaScript and read exactly the same variable. Requiring a bare `.` would
 * mean a defensive refactor to `?.` silently empties the scan, and that is a miss in the
 * load-bearing direction - the gate reports "in sync" while a live setting is undocumented.
 */
export function readEnvVarsFromSource(source) {
  const masked = maskNonCode(source);
  const found = new Set();

  for (const match of masked.matchAll(/(?<![\w$.])process\.env\??\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    if (isAssignmentTarget(masked, match.index + match[0].length)) continue;
    if (isDeleteTarget(masked, match.index)) continue;
    found.add(match[1]);
  }

  // The bracket form is located in the masked source (so a quoted mention inside a comment
  // cannot match) and its name is then read back from the original, where the string body
  // still exists.
  for (const match of masked.matchAll(/(?<![\w$.])process\.env(?:\?\.)?\[\s*(['"])/g)) {
    const name = readBracketName(source, masked, match);
    if (name !== null) found.add(name);
  }

  return found;
}

/**
 * The variable a bracket access names, or null when it does not name one literally.
 *
 * The name comes from the ORIGINAL source, where the string body still exists; the position
 * came from the masked source, so a quoted mention inside a comment never reaches here.
 */
function readBracketName(source, masked, match) {
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
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return null;

  // The string has to BE the subscript, not merely start it. `process.env['PREFIX_' + key]`
  // is a computed read - the documented blind spot - and reading `PREFIX_` out of it names a
  // variable that does not exist, which is the false-failure direction.
  if (!/^\s*\]/.test(source.slice(end + 1))) return null;

  // Past the closing quote AND the closing bracket, so the assignment check sees the same
  // thing it sees for the dotted form. Skipping only to the quote would read `]` as the
  // next token and never match `=`.
  const closingBracket = source.indexOf(']', end);
  if (closingBracket !== -1 && isAssignmentTarget(masked, closingBracket + 1)) return null;
  if (isDeleteTarget(masked, match.index)) return null;

  return name;
}

/**
 * Markdown a reader never sees: fenced blocks and HTML comments.
 *
 * The comment pass loops to a fixed point and then truncates at the first surviving
 * opener, matching the orphan check's treatment - an unterminated `<!--` hides the rest of
 * the document, and removing one balanced pair can expose an opener that was inside it.
 */
export function stripHiddenMarkdown(markdown) {
  return stripHtmlComments(stripFencedBlocks(markdown));
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
 *
 * The optional trailing run of hashes is the closed ATX form, `### \`NAME\` ###`, which is
 * valid Markdown, passes this repository's markdownlint configuration, and renders as the
 * identical heading. Rejecting it would fail CI over a correct reference - the expensive
 * direction, because it teaches maintainers that the gate is wrong rather than the docs.
 * A space before the hashes is required, as CommonMark requires: in `### \`NAME\`###` the
 * hashes are literal text and the heading is not a clean definition of NAME.
 */
export function readDocumentedEnvVars(markdown) {
  const rendered = stripHiddenMarkdown(markdown);
  const found = new Set();
  for (const match of rendered.matchAll(/^#{2,4}[ \t]+`([A-Z][A-Z0-9_]*)`(?:[ \t]+#+)?[ \t]*$/gm)) {
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

  const configurable = [...readSet].filter(name => !ambient.has(name)).sort(byCodeUnit);
  const ignored = [...readSet].filter(name => ambient.has(name)).sort(byCodeUnit);

  const undocumented = configurable.filter(name => !documentedSet.has(name));
  // An ambient variable that someone documented anyway is a contradiction between this
  // list and the document, so it is reported rather than quietly accepted either way.
  const unread = [...documentedSet]
    .filter(name => !readSet.has(name) || ambient.has(name))
    .sort(byCodeUnit);

  return {
    ok: undocumented.length === 0 && unread.length === 0,
    read: [...readSet].sort(byCodeUnit),
    configurable,
    ignored,
    documented: [...documentedSet].sort(byCodeUnit),
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
 * Directories the glob walker never descends into. They cannot hold published sources, and
 * a root-anchored pattern like `**;/*.js` would otherwise wander into every dependency's
 * bundled JavaScript and report nonsense.
 */
const UNPUBLISHABLE_DIRS = new Set(['node_modules', '.git', '.claude', 'coverage']);

/**
 * One path segment against one glob segment, where `*` matches any run of characters that
 * is not a `/` and `?` matches one.
 *
 * Spelled out rather than translated into a `RegExp`: a regular expression built from a
 * non-literal pattern is a static-analysis finding (Semgrep's non-literal-regexp rule), and
 * the same reasoning already applies to the workflow path-filter matcher in the tests.
 */
function matchGlobSegment(pattern, name) {
  const walk = (p, n) => {
    if (p === pattern.length) return n === name.length;
    if (pattern[p] === '*') {
      for (let k = n; k <= name.length; k++) {
        if (walk(p + 1, k)) return true;
      }
      return false;
    }
    if (n === name.length) return false;
    if (pattern[p] !== '?' && pattern[p] !== name[n]) return false;
    return walk(p + 1, n + 1);
  };
  return walk(0, 0);
}

/**
 * A repo-relative posix path against a `files` glob. `**` crosses `/` and may match zero
 * segments, so `docs/**;/*.md` covers `docs/a.md` as well as `docs/user/a.md` - the same
 * semantics npm's packer uses.
 */
export function matchesGlob(pattern, file) {
  const patternSegments = pattern.split('/');
  const fileSegments = file.split('/');

  const walk = (p, f) => {
    if (p === patternSegments.length) return f === fileSegments.length;
    if (patternSegments[p] === '**') {
      for (let k = f; k <= fileSegments.length; k++) {
        if (walk(p + 1, k)) return true;
      }
      return false;
    }
    if (f === fileSegments.length) return false;
    return matchGlobSegment(patternSegments[p], fileSegments[f]) && walk(p + 1, f + 1);
  };

  return walk(0, 0);
}

/**
 * The JavaScript files npm publishes, from package.json's `files` list.
 *
 * Globs are expanded rather than skipped. Skipping them was defensible while every glob in
 * `files` ended in `.md` or `.html`, but it is not a property of the entry - it is a
 * property of today's list. A future `plugins/**;/*.js` would publish modules that this
 * scan returned none of, and the damage compounds: the workflow-drift guard derives the
 * paths it demands trigger coverage for from this very function, so the new directory would
 * be unscanned *and* unwatched, and later `process.env` reads under it would merge with
 * neither check running. Only JavaScript is matched, so this stays far short of
 * reimplementing npm's packing rules - it answers one question, which files can hold a
 * `process.env` read.
 *
 * `!` negations are applied for the same reason, in the opposite direction: an excluded
 * file is not published, and scanning it would demand documentation for a variable no user
 * can ever set.
 */
export function shippedJsFiles(pkgFiles, root = repoRoot) {
  const found = new Set();

  const walk = (relative, keep) => {
    let entries;
    try {
      entries = readdirSync(path.resolve(root, relative), { withFileTypes: true });
    } catch {
      return; // listed but absent - npm's own packing already warns about that
    }
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!UNPUBLISHABLE_DIRS.has(entry.name)) walk(child, keep);
      } else if (isJsModule(entry.name) && keep(child)) {
        found.add(child);
      }
    }
  };

  const positives = pkgFiles.filter(entry => !entry.startsWith('!'));

  for (const entry of positives) {
    const clean = entry.replace(/\/$/, '');

    if (clean.includes('*') || clean.includes('?')) {
      // Walk from the longest wildcard-free prefix so a `docs/**` pattern does not restart
      // at the repository root, then keep only the files the whole pattern matches.
      const segments = clean.split('/');
      const firstWildcard = segments.findIndex(
        segment => segment.includes('*') || segment.includes('?')
      );
      const base = segments.slice(0, firstWildcard).join('/');
      walk(base === '' ? '.' : base, file => matchesGlob(clean, file));
      continue;
    }

    let stats;
    try {
      stats = statSync(path.resolve(root, clean));
    } catch {
      continue; // listed but absent - npm's own packing already warns about that
    }
    if (stats.isDirectory()) walk(clean, () => true);
    else if (isJsModule(clean)) found.add(clean);
  }

  // npm applies `files` in ARRAY ORDER and the LAST match wins, so a re-include after a
  // negation packs the file: `['lib/**', '!lib/internal/**', 'lib/internal/public.js']`
  // ships `public.js`. Collecting the negations and applying them all at the end instead
  // dropped it unconditionally, and a dropped file is one this gate never scans - its
  // `process.env` reads would be invisible and the workflow-trigger guard would not
  // require coverage for it. A negation can name a file (`!lib/internal.js`) or a subtree
  // (`!docs/superpowers/**`).
  const matchesEntry = (entry, file) => {
    const clean = entry.replace(/^!/, '').replace(/\/$/, '');
    return matchesGlob(clean, file) || file === clean || file.startsWith(`${clean}/`);
  };

  const published = file => {
    let included = false;
    for (const entry of pkgFiles) {
      if (matchesEntry(entry, file)) included = !entry.startsWith('!');
    }
    return included;
  };

  return [...found]
    .map(file => (file.startsWith('./') ? file.slice(2) : file))
    .filter(published)
    .sort(byCodeUnit);
}

/**
 * The entry points npm packs whether or not `files` lists them: `main` and every `bin`
 * target. npm adds them to the tarball unconditionally, so a `main` pointing outside
 * `files` still ships - and this scan, and the workflow-coverage assertion derived from it,
 * would both have skipped it. Paths are normalised off any leading `./` so they match the
 * repo-relative spelling `shippedJsFiles` walks with.
 */
export function alwaysPackedEntries(pkg) {
  const bin = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
  return [pkg.main, ...bin]
    .filter(entry => typeof entry === 'string' && entry !== '')
    .map(entry => entry.replace(/^\.\//, ''));
}

/** Reads the shipped sources and the doc off disk, and runs the comparison. */
export function checkEnvVarDocs(root = repoRoot) {
  const pkg = JSON.parse(readFileSync(path.resolve(root, 'package.json'), 'utf8'));
  // The entry points are resolved separately rather than appended to `files`, because npm
  // packs them regardless of what the negations in `files` exclude. Folding them into the
  // same list would let `!index.js` remove the very module npm is guaranteed to ship.
  const sources = [
    ...new Set([
      ...shippedJsFiles(pkg.files ?? [], root),
      ...shippedJsFiles(alwaysPackedEntries(pkg), root)
    ])
  ].sort(byCodeUnit);

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
