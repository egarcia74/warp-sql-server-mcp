import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = vi.hoisted(() => ({ files: new Map() }));
vi.mock('node:fs', () => ({
  default: {
    existsSync: file => fixture.files.has(file),
    readFileSync: file => {
      if (!fixture.files.has(file)) throw new Error(`Missing fixture: ${file}`);
      return fixture.files.get(file);
    },
    mkdirSync: () => {},
    writeFileSync: (file, content) => fixture.files.set(file, content)
  }
}));
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

import { getAllTools } from '../../lib/tools/tool-registry.js';
import { generateToolsDocumentation } from '../../scripts/docs/extract-docs.js';

beforeEach(async () => {
  fixture.files.clear();
  fixture.files.set('package.json', '{"version":"1.2.3"}');
  const registryPath = path.resolve('lib/tools/tool-registry.js');
  fixture.files.set(registryPath, await readFile(registryPath, 'utf8'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('documentation generated from the live registry', () => {
  it('retains root schema constraints outside properties and required', () => {
    const result = generateToolsDocumentation([
      {
        name: 'sample',
        description: 'Sample',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { value: { type: 'string' } },
          required: ['value']
        }
      }
    ]);

    expect(result.tools[0].schema).toEqual({ type: 'object', additionalProperties: false });
    expect(result.tools[0].parameters).toEqual({ value: { type: 'string' } });
  });

  it('preserves quoted descriptions, enum values and numeric constraints', () => {
    const result = generateToolsDocumentation();
    const documented = Object.fromEntries(result.tools.map(tool => [tool.name, tool]));

    expect(result.toolsCount).toBe(getAllTools().length);
    expect(documented.get_performance_stats.parameters.timeframe).toEqual({
      type: 'string',
      description:
        'Time period for stats: "recent" (last 5 min), "session" (since startup), "all" (default)',
      enum: ['recent', 'session', 'all']
    });
    expect(documented.get_table_data.parameters.limit.minimum).toBe(1);
    expect(documented.execute_query.required).toEqual(['query']);
    expect(documented.get_performance_stats.examples.advanced.timeframe).toBe('recent');
    expect(documented.detect_query_bottlenecks.examples.advanced.severity_filter).toBe('LOW');
    expect(JSON.parse(fixture.files.get('docs-data/tools.json'))).toEqual(result);
  });

  it('keeps the previous timestamp when registry-derived data is unchanged', () => {
    generateToolsDocumentation();
    const previous = JSON.parse(fixture.files.get('docs-data/tools.json'));
    previous.generatedAt = '2000-01-01T00:00:00.000Z';
    fixture.files.set('docs-data/tools.json', JSON.stringify(previous));

    expect(generateToolsDocumentation()).toEqual(previous);
  });
});
