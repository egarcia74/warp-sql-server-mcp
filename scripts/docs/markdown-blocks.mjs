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
export function stripRawTextHtml(markdown) {
  const lower = markdown.toLowerCase();
  const opener = /<(pre|script|style|textarea)\b/gi;

  let out = '';
  let cursor = 0;
  let match;

  while ((match = opener.exec(markdown)) !== null) {
    out += markdown.slice(cursor, match.index);

    const closer = lower.indexOf(`</${match[1].toLowerCase()}`, match.index);
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
