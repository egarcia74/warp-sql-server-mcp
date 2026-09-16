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

/** Strips the target of its optional angle brackets. */
const bareTarget = target => target.replace(/^<|>$/g, '');

/**
 * Everything in a document that is not navigable prose.
 *
 *  - **Fenced code blocks.** A link inside a fence is sample text; counting it would let a
 *    documented example silently satisfy the nav requirement.
 *  - **HTML comments.** `<!-- [x](y.md) -->` renders as nothing, so a reader cannot follow
 *    it. Commenting a nav entry out instead of deleting it is the ordinary way a link
 *    stops working, and it is exactly the case the gate has to notice rather than excuse.
 *
 * The second pass is not redundant. An UNTERMINATED `<!--` comments out the rest of the
 * document when rendered, so nothing after it is navigable either - but the balanced-pair
 * regex above cannot match it and would leave those links looking like edges. Removing one
 * pair can also expose an opener that was previously inside the matched span, which is the
 * incomplete-sanitization shape CodeQL flags (alert 168): replacing once is not a fixed
 * point. Truncating at the first surviving `<!--` settles both, and terminates because the
 * string only ever gets shorter.
 */
function stripNonProse(markdown) {
  const withoutFences = markdown.replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2\s*$/gm, '');

  let prose = withoutFences;
  let previous;
  do {
    previous = prose;
    prose = prose.replaceAll(/<!--[\s\S]*?-->/g, '');
  } while (prose !== previous);

  const unterminated = prose.indexOf('<!--');
  return unterminated === -1 ? prose : prose.slice(0, unterminated);
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
  const definitions = new Map();
  for (const match of prose.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+)/gm)) {
    definitions.set(normaliseLabel(match[1]), bareTarget(match[2]));
  }
  const body = prose.replace(/^\s{0,3}\[[^\]]+\]:\s*(?:<[^>]*>|\S+).*$/gm, '');

  // Inline links: [text](target), [text](<target>), [text](target "title").
  for (const match of body.matchAll(/\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)[^)]*\)/g)) {
    targets.push(bareTarget(match[1]));
  }

  // Raw HTML anchors, which markdown permits and this repo's generated pages use.
  for (const match of body.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    targets.push(match[1]);
  }

  // Labels a link actually uses: full `[text][label]`, collapsed `[label][]`, and
  // shortcut `[label]`. A shortcut only renders as a link when a definition exists, which
  // is precisely the condition applied below, so over-matching plain bracketed text here
  // cannot invent an edge.
  const used = new Set();
  for (const match of body.matchAll(/\[([^\]]*)\]\[([^\]]*)\]/g)) {
    used.add(normaliseLabel(match[2].trim() === '' ? match[1] : match[2]));
  }
  for (const match of body.matchAll(/\[([^\]]+)\](?![([:])/g)) {
    used.add(normaliseLabel(match[1]));
  }
  for (const label of used) {
    if (definitions.has(label)) targets.push(definitions.get(label));
  }

  return targets;
}

/**
 * Resolves one link target to a repo-relative markdown path, or null when it is not a
 * markdown file inside `docs/` - an external URL, a bare anchor, a folder link, or a
 * path that leaves the docs tree.
 */
export function resolveTarget(target, fromFile) {
  // Absolute URLs, protocol-relative URLs and mailto: never point at a file here.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;

  const withoutFragment = target.split('#')[0].split('?')[0].trim();
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
  const files = [...docs.keys()].sort();
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

  return found.sort();
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
