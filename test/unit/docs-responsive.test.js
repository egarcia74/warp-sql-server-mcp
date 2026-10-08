import { readFileSync } from 'node:fs';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import { generateLandingPageHTML } from '../../scripts/docs/generate-landing-page.js';

const committed = readFileSync('docs/index.html', 'utf8');
const pages = [
  ['generated', generateLandingPageHTML()],
  ['committed', committed]
];

function rule(markup, selector) {
  const styles = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  expect(styles).toBeDefined();
  const declarations = styles.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`))?.[1];
  expect(declarations, `Missing ${selector} CSS rule`).toBeDefined();
  return Object.fromEntries(
    [...declarations.matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim()
    ])
  );
}

describe('landing page responsive layout', () => {
  for (const [source, markup] of pages) {
    it(`${source} page caps grid columns to mobile content width`, () => {
      expect(rule(markup, '.grid')['grid-template-columns']).toMatch(
        /minmax\(min\(100%,\s*300px\),\s*1fr\)/
      );
    });

    it(`${source} page wraps long code labels without shrinking them`, () => {
      const code = rule(markup, '.code');
      expect(code['overflow-wrap']).toBe('anywhere');
      expect(code['font-size']).toBe('0.9em');
      expect(markup).toContain('SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS');
    });
  }

  it('keeps the committed HTML equal to the formatted generator output', async () => {
    const options = await prettier.resolveConfig('docs/index.html');
    const formatted = await prettier.format(generateLandingPageHTML(), {
      ...options,
      filepath: 'docs/index.html'
    });
    expect(committed).toBe(formatted);
  }, 15000);
});
