import { describe, expect, it } from 'vitest';

import { generateToolsHTML } from '../../scripts/docs/generate-tools-html.js';

function parameterRow(section, name) {
  return [...section.matchAll(/<tr>[\s\S]*?<\/tr>/g)]
    .map(match => match[0])
    .find(row => row.includes(`<span class="param-name">${name}</span>`));
}

describe('published tool reference', () => {
  it('shows root-level schema constraints when present', () => {
    const html = generateToolsHTML({
      version: '2.0.0',
      tools: [
        {
          name: 'sample',
          description: 'Sample',
          schema: { type: 'object', additionalProperties: false },
          parameters: {},
          required: [],
          examples: { basic: {}, advanced: {} }
        }
      ]
    });

    expect(html).toContain('Additional properties: false');
  });

  it('escapes registry text and example values before inserting them into HTML', () => {
    const markup = '<img src=x onerror=alert(1)>';
    const html = generateToolsHTML({
      version: '2.0.0',
      tools: [
        {
          name: 'sample',
          description: markup,
          schema: { type: 'object' },
          parameters: { choice: { type: 'string', description: markup, enum: [markup] } },
          required: [],
          examples: { basic: {}, advanced: { choice: markup } }
        }
      ]
    });

    expect(html).not.toContain(markup);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shows enum values and minimum constraints from the registry-derived data', () => {
    const html = generateToolsHTML();
    const performance = html.split('<div class="tool" id="get_performance_stats">')[1];
    const tableData = html.split('<div class="tool" id="get_table_data">')[1];

    expect(parameterRow(performance, 'timeframe')).toContain('recent, session, all');
    expect(parameterRow(tableData, 'limit')).toContain('Minimum: 1');
  });
});
