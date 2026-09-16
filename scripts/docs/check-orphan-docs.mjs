#!/usr/bin/env node
/**
 * Fails when a file under `docs/` is not reachable from the documentation nav.
 *
 * Why this exists: `docs.yml` already validates the links that *exist* - the
 * markdown-link-check action follows every link and reports the broken ones. Nothing
 * catches the opposite failure, a document that nothing links *to*. That failure is not
 * hypothetical: before the docs restructure (issue #97), 10 of 29 files under `docs/`
 * were absent from the index, and the only symptom was that nobody could find them.
 * Broken links are loud; orphans are silent, which is exactly why they need a gate.
 *
 * What "reachable" means here: start at `docs/README.md` - the nav - and walk markdown
 * links, staying inside `docs/`. Links that leave `docs/` (`../README.md`,
 * `../CONTRIBUTING.md`, the live site) are resolved far enough to know they left, and
 * then dropped. Traversing back in through them would defeat the check: a document
 * linked only from the root README would count as "reachable from the nav" when it is
 * precisely not in the nav. Link *health* across the whole repo is the link checker's
 * job; this check is only about the index.
 *
 * Exemptions are deliberate and listed in EXEMPTIONS below, with the reason each one
 * exists. They are reported on every run rather than silently skipped, so an exemption
 * that has outlived its reason is visible instead of load-bearing-by-accident.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  stripFencedBlocks,
  stripHtmlComments,
  stripRawTextHtml,
  byCodeUnit
} from './markdown-blocks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The nav. Reachability is defined as "walkable from here". */
export const ENTRY = 'docs/README.md';

/** The subtree the check owns. Anything outside it is another tool's problem. */
export const DOCS_ROOT = 'docs';

/**
 * Directory names the walker never descends into, wherever they appear.
 *
 *  - `superpowers` and `coverage` are the two that matter under `docs/`: both are
 *    gitignored (`.gitignore:85` and `.gitignore:38` respectively), the first being
 *    agent scratch plans kept locally and the second generated V8 coverage HTML.
 *    Neither is documentation and neither is ever linked from the nav.
 *  - `node_modules`, `.git` and `.claude` (which holds `.claude/worktrees/`, also
 *    gitignored) cannot appear under `docs/` today. They are listed anyway because the
 *    cost is one Set entry and the cost of the alternative - a walker that wanders into
 *    a dependency's bundled markdown, or into a linked worktree's copy of this repo -
 *    is a check that reports nonsense.
 */
export const SKIPPED_DIRS = new Set(['node_modules', '.git', '.claude', 'superpowers', 'coverage']);

/** The archive subtree, and the one file in it that must stay reachable from the nav. */
export const ARCHIVE_INDEX_DIR = 'docs/archive';
export const ARCHIVE_INDEX = `${ARCHIVE_INDEX_DIR}/README.md`;

/**
 * Files allowed to be unreachable from the nav, each with the reason it is allowed.
 *
 * Kept as predicates rather than a flat path list because one of the two is a subtree.
 */
export const EXEMPTIONS = [
  {
    // Linked from CONTRIBUTING.md as "start new documents from this", which is where a
    // contributor meets it. The nav does point at it today; the exemption stands so that
    // a future nav that drops the pointer fails on the missing *document*, not on the
    // template, which is scaffolding rather than something anyone reads end to end.
    reason: 'doc template - linked from CONTRIBUTING.md, not required in the nav',
    matches: file => file === 'docs/TEMPLATE.md'
  },
  {
    // The archive is entered through exactly one pointer - `docs/archive/README.md` -
    // and that pointer is what the nav is expected to carry. Its contents are historical
    // and unmaintained by design, so requiring each of them in the index would push
    // superseded material back into the nav, which is the opposite of archiving.
    //
    // ARCHIVE_INDEX itself is deliberately NOT exempt. Exempting it too would make the
    // "single pointer" a claim nothing enforces: delete the one nav link and the whole
    // archive, index included, becomes unreachable with the check still reporting success.
    // The invariant only means something if the pointer is the one file that must stay
    // reachable, so the exemption covers the descendants and stops there.
    reason: 'archive contents - reached through the (non-exempt) docs/archive/README.md',
    matches: file => file.startsWith(`${ARCHIVE_INDEX_DIR}/`) && file !== ARCHIVE_INDEX
  }
];

/**
 * Markdown link labels are matched case-insensitively and with runs of whitespace
 * collapsed, so `[See Also]` and `[see   also]` are the same label.
 */
const normaliseLabel = label => label.trim().toLowerCase().replaceAll(/\s+/g, ' ');

/**
 * Strips the target of its optional angle brackets and decodes its backslash escapes.
 *
 * `[g]: Guide\(advanced\).md` renders as a link to `Guide(advanced).md`, so leaving the
 * backslashes in produces a path no file matches and reports a reachable document orphaned.
 * The inline form already decodes them in `readBareDestination`; this is the same rule for
 * the reference form, which is the asymmetry that let one spelling drift from the other.
 */
const bareTarget = target => target.replace(/^<|>$/g, '').replace(/\\([^\w\s])/g, '$1');

/**
 * Reads one inline link destination starting just after the `](`, returning it bare.
 *
 * CommonMark allows an unbracketed destination to contain parentheses as long as they
 * balance, which is why this counts depth instead of stopping at the first `)`. Filenames
 * of the `Guide_(advanced).md` shape are ordinary, and treating one as a truncated path
 * turns a working link into a reported orphan - a false alarm, which costs more than a
 * miss because it teaches maintainers to distrust the gate rather than the documentation.
 *
 * A `<...>` destination is taken verbatim; otherwise the scan ends at the first whitespace
 * (the title begins there) or at a `)` that is not matched by an earlier `(`. Backslash
 * escapes are honoured so `\(` counts as a literal character, not as nesting.
 */
function readInlineDestination(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;

  if (text[i] === '<') {
    const close = text.indexOf('>', i + 1);
    if (close === -1) return null;
    const paren = text.indexOf(')', close);
    return paren === -1 ? null : { destination: text.slice(i + 1, close), end: paren };
  }

  const { destination, end, closed } = readBareDestination(text, i);

  // The link has to close. `[x](ORPHAN.md` with no `)` renders as literal text, so counting
  // it would let a genuinely orphaned document pass on the strength of a typo - and a typo
  // is exactly the state a half-written link is in. Whitespace ends the destination but the
  // title still has to be followed by `)`, so scan on for it.
  const paren = closed ? end : text.indexOf(')', end);
  if (paren === -1 || destination === '') return null;

  return { destination, end: paren };
}

/**
 * The unbracketed form of a destination: everything up to the first whitespace (where a
 * title would begin) or to a `)` that no earlier `(` opened. Backslash escapes are honoured
 * so `\(` is a literal character rather than nesting.
 */
function readBareDestination(text, from) {
  let depth = 0;
  let destination = '';
  let i = from;

  for (; i < text.length; i++) {
    const character = text[i];
    if (character === '\\' && i + 1 < text.length) {
      destination += text[i + 1];
      i++;
      continue;
    }
    if (/\s/.test(character)) break;
    if (character === ')' && depth === 0) return { destination, end: i, closed: true };
    if (character === '(') depth++;
    else if (character === ')') depth--;
    destination += character;
  }

  return { destination, end: i, closed: false };
}

/**
 * Everything in a document that is not navigable prose.
 *
 *  - **Fenced code blocks.** A link inside a fence is sample text; counting it would let a
 *    documented example silently satisfy the nav requirement. Fences are matched
 *    line by line (see `stripFencedBlocks`) because CommonMark allows runs longer than
 *    three characters and indents the opener and closer independently; the previous
 *    single-regex form recognised neither, so a link inside a valid `~~~~` block counted
 *    as navigation. The same function is duplicated in `check-env-var-docs.mjs`, which
 *    needs the identical rule, and both copies are pinned by tests in both suites.
 *  - **HTML comments.** `<!-- [x](y.md) -->` renders as nothing, so a reader cannot follow
 *    it. Commenting a nav entry out instead of deleting it is the ordinary way a link
 *    stops working, and it is exactly the case the gate has to notice rather than excuse.
 *  - **Inline code spans.** `` `[example](X.md)` `` renders as literal text, exactly like a
 *    fenced example but on one line. This document is full of them, and a doc reachable
 *    only from somebody's illustration of link syntax is not reachable at all.
 *
 * Inline code is stripped last, after fences: a backtick inside a fenced block belongs to
 * the fence, and stripping spans first could pair one of those with a later real span.
 *
 * The second pass is not redundant. An UNTERMINATED `<!--` comments out the rest of the
 * document when rendered, so nothing after it is navigable either - but the balanced-pair
 * regex above cannot match it and would leave those links looking like edges. Removing one
 * pair can also expose an opener that was previously inside the matched span, which is the
 * incomplete-sanitization shape CodeQL flags (alert 168): replacing once is not a fixed
 * point. Truncating at the first surviving `<!--` settles both, and terminates because the
 * string only ever gets shorter.
 *
 * ## One block type deliberately not stripped
 *
 * **Four-space indented code blocks.** They render as code, so a link inside one is not
 * navigable and counting it can let a real orphan pass. They are not removed anyway,
 * because "indented four spaces" does not identify one: an indented code block cannot
 * interrupt a paragraph, and inside a list item indentation is measured from the list
 * marker, so a list continuation is routinely indented four spaces and is prose.
 * Telling the two apart needs to know which block is open and at what indent - a Markdown
 * block parser, which is the same dependency this repository declines in
 * `check-env-var-docs.mjs` for the same reason.
 *
 * The trade was measured rather than assumed. Every four-space-indented line containing a
 * link in this repository - `CONTRIBUTING.md:356`, `:357` and
 * `docs/reference/ENV-VARS.md:381` - is a list continuation, and two of them point at
 * `docs/README.md` and `docs/TEMPLATE.md`. A line-based strip would delete real links
 * today to close a miss that needs someone to put a link to an otherwise-unreferenced
 * document inside an indented example. If that miss ever becomes real, the honest fix is a
 * block parser replacing this whole chain, not another pass bolted onto it.
 */
function stripNonProse(markdown) {
  return stripCodeSpans(stripHtmlComments(stripRawTextHtml(stripFencedBlocks(markdown))));
}

/**
 * Removes inline code spans, longest fence first so ``a ` b`` is consumed as one span
 * rather than as two single-backtick spans around it.
 *
 * Hand-rolled rather than `/(`+)(?:(?!\1)[\s\S])*\1/g`, which is quadratic: the greedy
 * `(`+)` offers one alternative per backtick and each is retried against the rest of the
 * document, so a long run of backticks - a table border, ASCII art, a pasted diff - made
 * the pass super-linear (measured 4x per doubling: 10ms at 4k backticks, 158ms at 16k).
 * These scanners run over every Markdown file in the repository on every CI job, where the
 * symptom would be a mysteriously hung build rather than an error.
 *
 * The behaviour is deliberately identical to that regular expression, backtracking
 * included: the longest opening run is tried first and the span ends at the next literal
 * occurrence of that same run, then progressively shorter openers are tried, and a run
 * with no closer stays in the text as ordinary characters. That equivalence is pinned by a
 * differential test over the repository's own Markdown plus randomised backtick soup,
 * because "passes the suite" is not the same claim as "matches the old pattern".
 */
function stripCodeSpans(text) {
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '`') {
      out += text[i];
      i += 1;
      continue;
    }

    const openStart = i;
    while (i < text.length && text[i] === '`') i += 1;

    // The closer is searched for from `openStart + length`, which for a shortened opener
    // still lies *inside* the run - so a lone ``` does close against its own third
    // backtick, and the search cannot be clamped to the text after the run. A differential
    // test caught exactly that: clamping made `   ``` ` survive whole where the regular
    // expression leaves `   ` `.
    let end = -1;
    for (let length = i - openStart; length >= 1; length -= 1) {
      const closer = text.indexOf('`'.repeat(length), openStart + length);
      if (closer !== -1) {
        end = closer + length;
        break;
      }
    }

    if (end === -1) {
      out += text.slice(openStart, i); // no closer: the run is literal text
      continue;
    }
    i = end; // drop opener, content and closer together
  }

  return out;
}

/**
 * Every inline link destination in `body`, found by one left-to-right scan.
 *
 * A stack of open brackets rather than a regular expression, for two reasons that pull the
 * same way. Correctness: CommonMark allows balanced brackets in link text, so
 * `[Advanced [preview]](user/Guide.md)` is a link a reader can follow, and a character
 * class that refuses the nested `[` collected nothing and reported the target orphaned.
 * Cost: matching nested brackets with a pattern means re-scanning from every `[`, which is
 * the quadratic behaviour this file was just rewritten to remove - a run of brackets took
 * over a second at 16k characters. Pushing each `[` and popping at the matching `]` is
 * linear in the length of the document and exact about nesting at the same time.
 *
 * An opener whose preceding character is `!` is an image. Its destination is fetched, not
 * navigated to, so it is not an edge - and because the stack pops the *inner* pair first,
 * `[![CI](badge.svg)](workflow-url)` skips the image and still yields the outer link, which
 * is the one a reader clicks.
 *
 * A backslash escapes the character after it, so `\[example](ORPHAN.md)` never opens a
 * bracket at all: it renders as literal text, which is how a document shows link syntax
 * without creating a link.
 */
function collectInlineLinks(body) {
  const targets = [];
  const open = [];
  let lastEscaped = -1;

  for (let i = 0; i < body.length; i++) {
    const character = body[i];

    if (character === '\\') {
      lastEscaped = i + 1; // the escaped character is literal, whatever it is
      i++;
      continue;
    }
    if (character === '[') {
      // `\![x](y)` is a literal `!` followed by a real link, so an escaped bang does not
      // make this an image - the escape is what stops it being one.
      open.push({ isImage: i > 0 && body[i - 1] === '!' && lastEscaped !== i - 1 });
      continue;
    }
    if (character !== ']') continue;

    const opener = open.pop();
    if (opener === undefined || body[i + 1] !== '(') continue;

    const link = readInlineDestination(body, i + 2);
    if (link === null) continue;

    if (!opener.isImage) targets.push(link.destination);

    // Jump past the closing `)`. Everything between is the destination and the title, and a
    // title may legitimately contain brackets - `[outer](some.md "[inner]")` - which would
    // otherwise be pushed onto the stack and misread as another link.
    i = link.end;
  }

  return targets;
}

/**
 * Markdown link targets a reader can actually follow, in the spellings this repo uses.
 *
 * Reference *definitions* are deliberately not edges on their own. `[old]: child.md` with
 * no `[...][old]` anywhere renders as nothing at all - the definition is invisible and the
 * child is unreachable - so counting every definition would let a stale leftover keep a
 * document "reachable" that no reader can navigate to. A definition contributes its target
 * only when some link actually uses its label.
 */
export function collectLinkTargets(markdown) {
  const prose = stripNonProse(markdown);
  const targets = [];

  // Reference definitions: [label]: target. Collected first, then removed, so that the
  // definition line cannot later look like a shortcut reference to itself.
  // `[ \t]{0,3}` rather than `\s{0,3}`: a definition's indent is spaces or tabs, and `\s`
  // also matches the newline that `^` has just anchored to, which let one `^` position
  // reach into the following lines and gave the engine overlapping ways to reach the same
  // match. Restricting it is both closer to CommonMark and one less backtracking source.
  const definitions = new Map();
  for (const match of prose.matchAll(
    /^[ \t]{0,3}\[([^[\]]+)\]:[ \t]*(?:\n[ \t]+)?(<[^>]*>|\S+)/gm
  )) {
    definitions.set(normaliseLabel(match[1]), bareTarget(match[2]));
  }
  const body = prose.replace(/^[ \t]{0,3}\[[^[\]]+\]:[ \t]*(?:\n[ \t]+)?(?:<[^>]*>|\S+).*$/gm, '');

  // Inline links: [text](target), [text](<target>), [text](target "title").
  //
  // The lookbehind excludes images. `![diagram](X.md)` is a destination the browser
  // fetches, not somewhere a reader can navigate to, so an image is not an edge in a
  // reachability graph - and a doc "reachable" only as somebody's image source is
  // unreachable in every sense that matters.
  //
  // Only the `](` opener is matched here; the destination itself is scanned by hand,
  // because a bare destination may contain balanced parentheses and a regular expression
  // that stops at the first `)` truncates them. `[guide](user/Guide_(advanced).md)` is a
  // link every renderer and the repository's own link checker follow, and truncating it to
  // `user/Guide_(advanced` made `resolveTarget` discard it as non-Markdown - so the gate
  // called a perfectly navigable document an orphan and failed CI over it.
  targets.push(...collectInlineLinks(body));

  // Raw HTML anchors, which markdown permits and this repo's generated pages use.
  //
  // The lookbehind pins the attribute name: without it any attribute *ending* in `href` -
  // `data-href`, `x-href` - is read as a real one, and `<a data-href="ORPHAN.md">` renders
  // no link at all while marking its target reachable. Metadata is not navigation.
  // The tag is matched as a sequence of quoted and unquoted runs rather than `[^>]*`, so a
  // `>` inside a quoted value - `<a title="1 > 0" href="Guide.md">` - does not end the tag
  // early and hide the href behind it.
  for (const tag of body.matchAll(/<a(?=[\s>])((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)) {
    const href = /(?<![-\w:])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=]+))/i.exec(tag[1]);
    if (href === null) continue;
    const value = href[1] ?? href[2] ?? href[3];
    if (value !== undefined && value !== '') targets.push(value);
  }

  // Labels a link actually uses: full `[text][label]`, collapsed `[label][]`, and
  // shortcut `[label]`. A shortcut only renders as a link when a definition exists, which
  // is precisely the condition applied below, so over-matching plain bracketed text here
  // cannot invent an edge.
  // The lookbehinds drop reference-style images (`![alt][label]`, `![label]`) for the same
  // reason the inline pass drops `![alt](x)`: an image destination is not navigation.
  //
  // The character classes exclude `[` as well as `]`. A CommonMark link label cannot
  // contain an unescaped bracket anyway, so this is the stricter reading - and it is what
  // makes the pass linear: with `[^\]]` a run of `[` gave every one of them a scan to the
  // end of the document (measured 4x per doubling, 382ms at 16k brackets), whereas a class
  // that cannot consume `[` fails at once and moves on.
  const used = new Set();
  for (const match of body.matchAll(/(?<![!\\])\[([^[\]]*)\]\[([^[\]]*)\]/g)) {
    used.add(normaliseLabel(match[2].trim() === '' ? match[1] : match[2]));
  }
  // `(?<!\])` keeps the second half of a full reference out of the shortcut pass: in
  // `![alt][img]` the `[img]` is not preceded by `!` and would otherwise sneak the image
  // back in. Nothing is lost - the full-reference pass above already records that label.
  for (const match of body.matchAll(/(?<![!\]\\])\[([^[\]]+)\](?![([:])/g)) {
    used.add(normaliseLabel(match[1]));
  }
  for (const label of used) {
    if (definitions.has(label)) targets.push(definitions.get(label));
  }

  return targets;
}

/**
 * Percent-decodes a link path so it can be compared against a filename on disk.
 *
 * A filename with a space is written `user/My%20Guide.md` in markdown and renders as a
 * working link, but the raw text never equals the `docs/user/My Guide.md` key in the map.
 * Left encoded, the check calls a perfectly navigable document an orphan and fails CI over
 * it - a false alarm, which costs more than a miss: it teaches maintainers that the gate
 * is wrong rather than that the docs are.
 *
 * A malformed escape (a bare `%` in a filename, say) makes `decodeURIComponent` throw. The
 * original is the right answer then: it is what the filename actually looks like.
 */
function decodePath(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/**
 * Resolves one link target to a repo-relative markdown path, or null when it is not a
 * markdown file inside `docs/` - an external URL, a bare anchor, a folder link, or a
 * path that leaves the docs tree.
 */
export function resolveTarget(target, fromFile) {
  // Absolute URLs, protocol-relative URLs and mailto: never point at a file here.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;

  const withoutFragment = decodePath(target.split('#')[0].split('?')[0].trim());
  if (withoutFragment === '') return null; // same-page anchor
  if (!withoutFragment.toLowerCase().endsWith('.md')) return null; // folder or .html

  // Root-relative links are relative to the repo, not to the filesystem root.
  const resolved = withoutFragment.startsWith('/')
    ? path.posix.normalize(withoutFragment.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), withoutFragment));

  // Left `docs/` - deliberately not followed; see the file header.
  if (resolved !== DOCS_ROOT && !resolved.startsWith(`${DOCS_ROOT}/`)) return null;

  return resolved;
}

/**
 * Breadth-first walk of the link graph from `entry`, over an in-memory `docs` map of
 * repo-relative path -> file contents. Links to files that are not in the map (a typo,
 * or a deleted file) are ignored: that is a broken link, which the link checker reports,
 * and treating it as an error here would report the same fault twice in two vocabularies.
 */
export function reachableFrom(docs, entry = ENTRY) {
  const seen = new Set();
  if (!docs.has(entry)) return seen;

  const queue = [entry];
  seen.add(entry);

  while (queue.length > 0) {
    const current = queue.shift();
    for (const target of collectLinkTargets(docs.get(current))) {
      const resolved = resolveTarget(target, current);
      if (resolved === null || seen.has(resolved) || !docs.has(resolved)) continue;
      seen.add(resolved);
      queue.push(resolved);
    }
  }

  return seen;
}

/**
 * The check itself, as a pure function over an in-memory docs map so it can be tested
 * without a checkout.
 *
 * @param {Map<string,string>} docs repo-relative path -> contents
 * @param {object} [options]
 * @param {string} [options.entry] nav file to start from
 * @param {Array<{reason: string, matches: (file: string) => boolean}>} [options.exemptions]
 */
export function findOrphanDocs(docs, { entry = ENTRY, exemptions = EXEMPTIONS } = {}) {
  const files = [...docs.keys()].sort(byCodeUnit);
  const reachable = reachableFrom(docs, entry);

  const orphans = [];
  const exempted = [];
  const missingEntry = !docs.has(entry);

  for (const file of files) {
    if (reachable.has(file)) continue;
    const exemption = exemptions.find(item => item.matches(file));
    if (exemption) {
      exempted.push({ file, reason: exemption.reason });
    } else {
      orphans.push(file);
    }
  }

  return {
    ok: !missingEntry && orphans.length === 0,
    entry,
    missingEntry,
    total: files.length,
    reachable: files.filter(file => reachable.has(file)),
    orphans,
    exempted
  };
}

/** Every markdown file under `dir`, as repo-relative posix paths, skipping SKIPPED_DIRS. */
export function listMarkdownFiles(dir, root = repoRoot) {
  const absolute = path.resolve(root, dir);
  const found = [];

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      found.push(...listMarkdownFiles(path.posix.join(dir, entry.name), root));
      continue;
    }
    // Follow-the-symlink guard: a symlinked file still has to be a regular markdown file.
    const target = path.resolve(absolute, entry.name);
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    if (!statSync(target).isFile()) continue;
    found.push(path.posix.join(dir, entry.name));
  }

  return found.sort(byCodeUnit);
}

/** Reads the docs tree off disk into the map `findOrphanDocs` consumes. */
export function readDocs(root = repoRoot) {
  return new Map(
    listMarkdownFiles(DOCS_ROOT, root).map(file => [
      file,
      readFileSync(path.resolve(root, file), 'utf8')
    ])
  );
}

/**
 * The report body, in the shape the existing MCP tool-doc-sync check in `docs.yml`
 * writes, so both land in `link-report.md` reading like one document.
 */
export function formatReport(result) {
  const list = files => files.map(file => `- \`${file}\``).join('\n');
  const lines = [
    `**Docs found under \`${DOCS_ROOT}/\`**: ${result.total}`,
    `**Reachable from \`${result.entry}\`**: ${result.reachable.length}`
  ];

  if (result.exempted.length > 0) {
    lines.push(
      `**Exempt (by design, ${result.exempted.length})**:`,
      result.exempted.map(item => `- \`${item.file}\` - ${item.reason}`).join('\n')
    );
  }

  if (result.missingEntry) {
    lines.push(`❌ **Nav file \`${result.entry}\` is missing** - nothing can be reachable`);
  } else if (result.orphans.length > 0) {
    lines.push(`❌ **Orphaned docs** (${result.orphans.length}):`, list(result.orphans));
  } else {
    lines.push('✅ **Every doc is reachable from the nav**');
  }

  return lines.join('\n');
}

function main() {
  const result = findOrphanDocs(readDocs());
  const report = formatReport(result);

  console.log(report);

  if (result.ok) return;

  console.error(
    `\n::error::Documentation orphans: ${result.orphans.length} file(s) under ${DOCS_ROOT}/ ` +
      `are not reachable from ${result.entry}.`
  );
  console.error(
    'Add each one to the documentation index (or to a page the index already links to).\n' +
      'If a file genuinely belongs outside the nav, add it to EXEMPTIONS in\n' +
      'scripts/docs/check-orphan-docs.mjs with the reason - do not delete the check.'
  );
  process.exitCode = 1;
}

// Compare as file URLs: process.argv[1] is a plain filesystem path while import.meta.url
// is percent-encoded, so a hand-built `file://` + path string fails to match whenever the
// checkout contains a space, and main() would be skipped silently - exit 0, gate never run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
