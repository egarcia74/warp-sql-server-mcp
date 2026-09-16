/**
 * The Markdown-reading rules both documentation gates need, in one place.
 *
 * `check-orphan-docs.mjs` and `check-env-var-docs.mjs` were deliberately standalone, each
 * carrying its own copy of these so a maintainer could read either top to bottom. That
 * stopped paying: the copies are ~55 lines apiece, which put the pull request over the
 * duplication budget, and - the reason that matters more - a fence rule that exists twice
 * is a fence rule that can disagree with itself. Codex's own finding was that the *same*
 * defect sat in both files, which is the argument for one definition rather than two.
 *
 * What stays duplicated is the part that genuinely differs: the orphan gate also strips
 * inline code spans, and the env-var gate deliberately does not, because every heading it
 * collects is written `### \`NAME\``.
 *
 * ## Known limitations
 *
 * These are decisions, not oversights. This module reads Markdown block structure well
 * enough to answer the two questions the gates ask; it is not a CommonMark parser, and the
 * cases below were each raised in review, checked against this repository, and left open
 * because closing them means tracking container state (blockquote depth, list-item indent)
 * - the same "become a parser" step already declined for `maskNonCode`, for the same
 * reason: a lint script should not carry a parser dependency. Every one of them was
 * verified to have ZERO instances in `docs/` when written, and both files a wrong verdict
 * would actually bite - `docs/README.md` and `docs/reference/ENV-VARS.md` - are clean of
 * all of them. Tracked in #1257; if one of these ever appears in a real document, the
 * answer is to fix it then, with the instance in hand.
 *
 *  - **Fenced blocks inside a blockquote or list item.** A `> ` or list-marker prefix sits
 *    before the fence, so the line-anchored scan never enters the block. Fences indented
 *    0-3 spaces ARE handled; only container-prefixed ones are not.
 *  - **Code-span closers of a different backtick-run length.** CommonMark closes a span
 *    only with a run of the same length; `stripCodeSpans` will also accept a shorter one.
 *  - **HTML-comment openers inside a code span.** A literal `<!--` shown as code reads as
 *    an unterminated comment and truncates the rest of the document.
 *  - **Reference definitions inside containers, and ones that interrupt a paragraph.**
 *    CommonMark treats a definition immediately after paragraph text as paragraph content.
 *    This repository uses inline links exclusively and contains no reference definitions
 *    at all, so both rules are currently moot.
 */

/**
 * Removes every fenced code block, opener and closer included.
 *
 * Line-based rather than one regular expression, because CommonMark fences are not a fixed
 * three characters: an opener is three *or more* backticks or tildes, a closer is the same
 * character repeated at least as many times as the opener, and the two are indented
 * independently (0-3 spaces each). A single `(```|~~~)` pattern with a back-referenced
 * indent missed all three variations, so a `~~~~` block - valid, lint-clean Markdown - was
 * read as content. That is the failure both gates exist to prevent: a heading or a link no
 * reader can see standing in for a real one.
 *
 * An unterminated fence runs to the end of the document, which is what a renderer does
 * with it and the safe direction here - unreadable content stays uncounted.
 *
 * Dropped lines become empty rather than disappearing, so line positions are preserved for
 * the line-anchored patterns that run afterwards.
 */
export function stripFencedBlocks(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let fence = null;

  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\n]*)/.exec(line);

    if (fence === null) {
      // A backtick fence's info string may not contain a backtick (CommonMark 4.5); that
      // rule is what keeps an inline code span like `` `a` `` from opening a block.
      if (marker && !(marker[1].startsWith('`') && marker[2].includes('`'))) {
        fence = { char: marker[1].charAt(0), length: marker[1].length };
        out.push('');
        continue;
      }
      out.push(line);
      continue;
    }

    // Inside a block: only a bare run of the same character, at least as long as the
    // opener, closes it. Anything else - including a shorter or different fence - is
    // content.
    if (marker?.[1].startsWith(fence.char) && marker[1].length >= fence.length) {
      if (marker[2].trim() === '') fence = null;
    }
    out.push('');
  }

  return out.join('\n');
}

/**
 * Removes `<pre>`, `<script>`, `<style>` and `<textarea>` blocks with their contents.
 *
 * CommonMark calls these raw-text elements: what is inside them is not parsed as Markdown,
 * so a link-shaped or heading-shaped line in a `<pre>` renders as literal text and must not
 * count. They are the HTML equivalent of a fenced block, and were the one block type the
 * gates still read through.
 *
 * Scanned rather than matched with `<(pre|script)\b[\s\S]*?</\1>`, which is quadratic when
 * an opening tag has no closing one: every opener would rescan to end of document. An
 * unterminated opener takes the rest of the document, which is what a renderer does with it.
 */
/**
 * The first `</name` in `lower` at or after `from` whose tag name actually ends there.
 *
 * Scanning rather than a regex keeps the linear behaviour the caller documents above.
 */
function findCloser(lower, name, from) {
  const needle = `</${name}`;
  let at = lower.indexOf(needle, from);

  while (at !== -1) {
    const after = lower[at + needle.length];
    if (after === undefined || after === '>' || /\s/.test(after)) return at;
    at = lower.indexOf(needle, at + needle.length);
  }

  return -1;
}

export function stripRawTextHtml(markdown) {
  const lower = markdown.toLowerCase();
  const opener = /<(pre|script|style|textarea)\b/gi;

  let out = '';
  let cursor = 0;
  let match;

  while ((match = opener.exec(markdown)) !== null) {
    out += markdown.slice(cursor, match.index);

    // The character after the tag name has to end it. `indexOf('</pre')` alone also matches
    // `</pretend>`, which closes the block early and lets everything between the impostor
    // and the real closer out - the same boundary mistake `href` needed `(?<![-\w:])` for,
    // on the closing side. Only whitespace or `>` may follow (`</pre >` is valid HTML).
    const closer = findCloser(lower, match[1].toLowerCase(), match.index);
    const tagEnd = closer === -1 ? -1 : markdown.indexOf('>', closer);
    if (tagEnd === -1) return out; // unterminated: the rest is raw text

    cursor = tagEnd + 1;
    opener.lastIndex = cursor;
  }

  return out + markdown.slice(cursor);
}

/**
 * Removes HTML comments, then truncates at the first one left unterminated.
 *
 * The loop is not redundant. Removing one balanced pair can expose an opener that was
 * inside it, which is the incomplete-sanitization shape CodeQL flags (alert 168): replacing
 * once is not a fixed point. And an unterminated `<!--` comments out the rest of the
 * document when rendered, so nothing after it is visible either - but the balanced-pair
 * pattern cannot match it and would leave that content looking real. Truncating at the
 * first survivor settles both, and terminates because the string only ever gets shorter.
 */
export function stripHtmlComments(markdown) {
  let visible = markdown;
  let previous;
  do {
    previous = visible;
    visible = visible.replaceAll(/<!--[\s\S]*?-->/g, '');
  } while (visible !== previous);

  const unterminated = visible.indexOf('<!--');
  return unterminated === -1 ? visible : visible.slice(0, unterminated);
}

/**
 * Code-unit ordering, as an explicit comparator.
 *
 * Deliberately NOT `localeCompare`, which SonarQube's default suggestion reaches for:
 * locale collation ignores case and punctuation weight, so it reorders these lists - on
 * this repository's docs it moves `docs/architecture/...` ahead of `docs/README.md` - and
 * it varies with the runtime's ICU data, which would make a CI report differ between
 * machines. Code-unit order is what the reports and the tests already encode, and it is
 * the same everywhere.
 */
export const byCodeUnit = (a, b) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};
