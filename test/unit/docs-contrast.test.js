import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateLandingPageHTML } from '../../scripts/docs/generate-landing-page.js';
import { generateToolsHTML } from '../../scripts/docs/generate-tools-html.js';

const MIN_NORMAL_TEXT_CONTRAST = 4.5;
const pages = [
  {
    name: 'landing page',
    generate: generateLandingPageHTML,
    file: 'docs/index.html',
    badge: '.badge'
  },
  {
    name: 'tools reference',
    generate: generateToolsHTML,
    file: 'docs/tools.html',
    badge: '.optional'
  }
];

function declarations(markup, selector) {
  const styles = markup.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  const rule = new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`).exec(styles)?.[1];
  expect(rule, `Missing ${selector} rule`).toBeDefined();
  return Object.fromEntries(
    [...rule.matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()])
  );
}

function channels(color) {
  if (color === 'white') return [255, 255, 255];
  expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
}

function luminance(color) {
  const [red, green, blue] = channels(color).map(channel => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('generated documentation contrast', () => {
  for (const page of pages) {
    for (const [source, markup] of [
      ['generator', page.generate()],
      ['published HTML', readFileSync(page.file, 'utf8')]
    ]) {
      it(`${page.name} ${source} keeps normal header text readable across its gradient`, () => {
        const header = declarations(markup, '.header');
        const gradientStops = header.background.match(/#[0-9a-f]{6}/gi);
        expect(gradientStops).toHaveLength(2);
        for (const stop of gradientStops) {
          expect(contrast(header.color, stop)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_CONTRAST);
        }
      });

      it(`${page.name} ${source} keeps small badge text readable`, () => {
        const badge = declarations(markup, page.badge);
        expect(contrast(badge.color, badge.background)).toBeGreaterThanOrEqual(
          MIN_NORMAL_TEXT_CONTRAST
        );
      });
    }
  }
});
