import fs from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { generateLandingPageHTML } from '../../scripts/docs/generate-landing-page.js';

const manifestUrl = new URL('../../package.json', import.meta.url);

function withNodeEngine(node, run) {
  const original = fs.readFileSync;
  const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...options) => {
    if (file instanceof URL && file.href === manifestUrl.href) {
      return JSON.stringify({ engines: { node } });
    }
    return original(file, ...options);
  });
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

describe('landing page Node.js badge', () => {
  it('renders the package runtime range in the generated and committed landing pages', () => {
    const { engines } = JSON.parse(fs.readFileSync(manifestUrl, 'utf8'));
    const escapedRange = engines.node
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const badge = `<span class="badge">Node.js ${escapedRange}</span>`;
    expect(generateLandingPageHTML()).toContain(badge);
    expect(fs.readFileSync('docs/index.html', 'utf8')).toContain(badge);
  });

  it('preserves compound range semantics while escaping HTML text', () => {
    const html = withNodeEngine('>=18.0.0 <19.0.0 || >=20.10.0', generateLandingPageHTML);
    expect(html).toContain(
      '<span class="badge">Node.js &gt;=18.0.0 &lt;19.0.0 || &gt;=20.10.0</span>'
    );
  });

  it.each([undefined, '', '   ', 22])('rejects invalid engines.node %j', node => {
    expect(() => withNodeEngine(node, generateLandingPageHTML)).toThrow(
      'package.json must define a nonempty engines.node range.'
    );
  });
});
