import { describe, expect, it } from 'vitest';
import { micromark } from 'micromark';
import { math, mathHtml } from 'micromark-extension-math';

describe('Markdown math security', () => {
  it('does not inherit trust from a polluted Object prototype', () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'trust');
    try {
      Object.defineProperty(Object.prototype, 'trust', {
        configurable: true,
        writable: true,
        value: true
      });
      const html = micromark('$\\href{https://example.com/}{attacker}$', {
        extensions: [math()],
        htmlExtensions: [mathHtml()]
      });
      expect(html).not.toMatch(/<a(?:\s|>)/i);
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'trust', original);
      else delete Object.prototype.trust;
    }
  });

  it.each([
    ['inline', '$x^2 + 1$', 'math-inline'],
    ['block', '$$\nx^2 + 1\n$$', 'math-display']
  ])('renders ordinary %s math', (_kind, markdown, className) => {
    const html = micromark(markdown, {
      extensions: [math()],
      htmlExtensions: [mathHtml()]
    });
    expect(html).toContain(className);
    expect(html).toContain('class="katex"');
    expect(html).toContain('<msup>');
    expect(html).not.toContain('katex-error');
  });

  it('allows deliberate links with explicit trust enabled', () => {
    const html = micromark('$\\href{https://example.com/}{deliberate}$', {
      extensions: [math()],
      htmlExtensions: [mathHtml({ trust: true })]
    });
    expect(html).toContain('<a href="https://example.com/">');
  });
});
