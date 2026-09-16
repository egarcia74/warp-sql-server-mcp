import { describe, it, expect } from 'vitest';

import {
  stripFencedBlocks,
  stripHtmlComments,
  stripRawTextHtml,
  byCodeUnit
} from '../../scripts/docs/markdown-blocks.mjs';

/**
 * The fence, comment and ordering rules both documentation gates read Markdown with.
 *
 * These live here rather than twice over in `check-orphan-docs.test.js` and
 * `check-env-var-docs.test.js`: the rules are now one shared implementation, so testing
 * the variations once is what keeps the two gates from drifting apart. Each gate suite
 * keeps a single test proving it actually applies this.
 */
describe('stripFencedBlocks', () => {
  const stripped = markdown => stripFencedBlocks(markdown).trim();

  it('removes a plain three-character block, opener and closer included', () => {
    expect(stripped(['```md', 'hidden', '```'].join('\n'))).toBe('');
    expect(stripped(['~~~markdown', 'hidden', '~~~'].join('\n'))).toBe('');
  });

  // Regression: the previous pattern matched exactly three characters with a
  // back-referenced indent, so every variation below was invisible and its contents were
  // read as real documentation.
  it('removes a block opened with more than three characters', () => {
    expect(stripped(['~~~~', 'hidden', '~~~~'].join('\n'))).toBe('');
    expect(stripped(['````', 'hidden', '````'].join('\n'))).toBe('');
  });

  it('accepts a closer longer than the opener, as CommonMark does', () => {
    expect(stripped(['```', 'hidden', '`````'].join('\n'))).toBe('');
  });

  it('accepts a closer indented differently from the opener', () => {
    expect(stripped(['  ```', 'hidden', '```'].join('\n'))).toBe('');
    expect(stripped(['```', 'hidden', '   ```'].join('\n'))).toBe('');
  });

  it('does not let a shorter inner fence close a longer block', () => {
    expect(stripped(['````', '```', 'still hidden', '````'].join('\n'))).toBe('');
  });

  it('does not let a different fence character close a block', () => {
    expect(stripped(['```', '~~~', 'still hidden', '```'].join('\n'))).toBe('');
  });

  it('runs an unterminated fence to the end of the document, as a renderer does', () => {
    expect(stripped(['visible', '~~~~', 'hidden', 'also hidden'].join('\n'))).toBe('visible');
  });

  it('keeps content on both sides of a block', () => {
    const markdown = ['before', '~~~~', 'hidden', '~~~~', 'after'].join('\n');
    expect(stripped(markdown)).toBe('before\n\n\n\nafter');
  });

  it('preserves line positions so the line-anchored passes still line up', () => {
    const markdown = ['a', '```', 'x', '```', 'b'].join('\n');
    expect(stripFencedBlocks(markdown).split('\n')).toHaveLength(5);
  });

  it('does not let an inline code span open a block', () => {
    // A backtick fence's info string may not contain a backtick (CommonMark 4.5).
    expect(stripped('```a` still prose')).toBe('```a` still prose');
  });

  it('leaves a document with no fences untouched', () => {
    const markdown = ['# Title', '', 'Prose with `code` in it.'].join('\n');
    expect(stripFencedBlocks(markdown)).toBe(markdown);
  });
});

describe('stripHtmlComments', () => {
  it('removes single- and multi-line comments', () => {
    expect(stripHtmlComments('a <!-- gone --> b').trim()).toBe('a  b');
    expect(stripHtmlComments(['a', '<!--', 'gone', '-->', 'b'].join('\n')).trim()).toBe('a\n\nb');
  });

  it('truncates at an unterminated comment, which hides the rest of the document', () => {
    expect(stripHtmlComments('visible <!-- dangling').trim()).toBe('visible');
  });

  // Regression (CodeQL alert 168): replacing once is not a fixed point, because removing
  // one balanced pair can expose an opener that was inside it.
  it('reaches a fixed point rather than replacing once', () => {
    expect(stripHtmlComments('a <!-- <!-- inner --> --> b')).not.toContain('<!--');
    expect(stripHtmlComments('a <!--x<!--y-->z--> b')).not.toContain('<!--');
  });
});

describe('stripRawTextHtml', () => {
  // Regression: the closer was found with a bare `indexOf('</pre')`, so `</pretend>` ended
  // the block - everything between the impostor and the real closer escaped and counted as
  // navigable. The same boundary mistake `href` needed `(?<![-\w:])` for, on the other side.
  it('does not close a raw-text block on a tag that merely starts with its name', () => {
    const markdown = '<pre>a </pretend> [hidden](H.md) </pre> [live](L.md)';

    expect(stripRawTextHtml(markdown)).not.toContain('H.md');
    expect(stripRawTextHtml(markdown)).toContain('L.md');
  });

  it('still closes on the real tag, with or without trailing space', () => {
    expect(stripRawTextHtml('<pre>[a](A.md)</pre> [live](L.md)')).not.toContain('A.md');
    expect(stripRawTextHtml('<pre>[a](A.md)</pre > [live](L.md)')).toContain('L.md');
  });

  it('applies the same boundary to every raw-text tag, not just pre', () => {
    const markdown = '<script>x</scripty> [hidden](H.md) </script> [live](L.md)';

    expect(stripRawTextHtml(markdown)).not.toContain('H.md');
    expect(stripRawTextHtml(markdown)).toContain('L.md');
  });

  it('takes the rest of the document when the opener is never closed', () => {
    expect(stripRawTextHtml('<pre>[a](A.md) [b](B.md)')).toBe('');
  });
});

describe('byCodeUnit', () => {
  it('orders by code unit, which is what the reports and fixtures encode', () => {
    expect(['b', 'a', 'C'].sort(byCodeUnit)).toEqual(['C', 'a', 'b']);
  });

  // Deliberately not localeCompare: it moves `docs/architecture/...` ahead of
  // `docs/README.md`, and it varies with the runtime's ICU data, so a CI report would
  // differ between machines.
  it('keeps an uppercase filename ahead of a lowercase directory, unlike locale collation', () => {
    const paths = ['docs/architecture/ARCHITECTURE.md', 'docs/README.md'];
    expect([...paths].sort(byCodeUnit)).toEqual([
      'docs/README.md',
      'docs/architecture/ARCHITECTURE.md'
    ]);
  });

  it('reports equality as zero so sorts stay stable', () => {
    expect(byCodeUnit('same', 'same')).toBe(0);
    expect(byCodeUnit('a', 'b')).toBe(-1);
    expect(byCodeUnit('b', 'a')).toBe(1);
  });
});
