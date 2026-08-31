import { describe, it, expect } from 'vitest';
import { scanMarkdown } from '../../scripts/check-fenced-blocks.mjs';

const lines = n => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

describe('scanMarkdown', () => {
  it('accepts a normal fenced block', () => {
    const { unclosed, oversized } = scanMarkdown('# Doc\n\n```bash\nnpm test\n```\n\ntext\n');
    expect(unclosed).toEqual([]);
    expect(oversized).toEqual([]);
  });

  it('reports a fence that is never closed', () => {
    const { unclosed } = scanMarkdown('# Doc\n\n```bash\nnpm test\n\n## Still A Heading\n');
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0].start).toBe(3);
  });

  it('reports a block that swallows the rest of the document', () => {
    // The real defect shape: a longer fence opens, shorter ones inside are literal
    // text, and nothing closes it until far below.
    const doc = [
      '# Doc',
      '',
      '````bash',
      'npm run ci',
      '```bash',
      lines(200),
      '````',
      'after'
    ].join('\n');
    const { unclosed, oversized } = scanMarkdown(doc);
    expect(unclosed).toEqual([]); // it IS balanced - that is why linters missed it
    expect(oversized).toHaveLength(1);
    expect(oversized[0].span).toBeGreaterThan(120);
  });

  it('does not treat a shorter run as closing a longer fence', () => {
    const { unclosed } = scanMarkdown('````bash\ncmd\n```\nstill inside\n');
    expect(unclosed).toHaveLength(1);
  });

  it('does not treat a line with an info string as a closing fence', () => {
    const { unclosed } = scanMarkdown('```bash\ncmd\n```js\nstill inside\n');
    expect(unclosed).toHaveLength(1);
  });

  it('allows headings inside a code sample, which are legal', () => {
    const doc = '# Doc\n\n```markdown\n## Unreleased\n### Security\n```\n';
    const { unclosed, oversized } = scanMarkdown(doc);
    expect(unclosed).toEqual([]);
    expect(oversized).toEqual([]);
  });

  it('allows a long-but-plausible code sample under the limit', () => {
    const doc = ['```bash', lines(60), '```'].join('\n');
    expect(scanMarkdown(doc).oversized).toEqual([]);
  });

  it('handles tilde fences', () => {
    expect(scanMarkdown('~~~bash\ncmd\n~~~\n').unclosed).toEqual([]);
    expect(scanMarkdown('~~~bash\ncmd\n').unclosed).toHaveLength(1);
  });

  it('does not let a tilde run close a backtick fence', () => {
    expect(scanMarkdown('```bash\ncmd\n~~~\n').unclosed).toHaveLength(1);
  });
});
