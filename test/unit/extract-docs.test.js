import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
// Formatting is an external process; all extraction and JSON serialization stay real.
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

import { generateToolsDocumentation } from '../../scripts/docs/extract-docs.js';

const property = "actual: { type: 'string', description: 'A value' }";
const parameter = { type: 'string', description: 'A value' };

function generateRegistry(content) {
  fixture.files.set(path.resolve('lib/tools/tool-registry.js'), content);
  const result = generateToolsDocumentation();
  expect(JSON.parse(fixture.files.get('docs-data/tools.json'))).toEqual(result);
  return result;
}

function generate(schema) {
  return generateRegistry(
    `const TEST_TOOLS = [{ name: 'test_tool', description: 'Test tool', inputSchema: { ${schema} } }];`
  );
}

beforeEach(() => {
  fixture.files.clear();
  fixture.files.set('package.json', '{"version":"1.2.3"}');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('documentation extraction compatibility', () => {
  it('separates adjacent tools without treating quoted or nested braces as object boundaries', () => {
    const result = generateRegistry(String.raw`const TEST_TOOLS = [
      { name: 'first', description: 'First', note: "escaped \" } quote", inputSchema: {
        properties: { query: { type: 'string', description: 'Query } text' } }, required: ['query']
      } },
      { name: 'second', description: 'Second', inputSchema: {
        properties: { limit: { type: 'number', description: 'Count' } }, required: []
      } }
    ];`);

    expect(result.toolsCount).toBe(2);
    expect(result.tools.map(tool => tool.name)).toEqual(['first', 'second']);
    expect(result.tools[0].parameters).toEqual({
      query: { type: 'string', description: 'Query } text' }
    });
    expect(result.tools[0].required).toEqual(['query']);
    expect(result.tools[1].parameters).toEqual({
      limit: { type: 'number', description: 'Count' }
    });
  });

  it('keeps nested property braces and escaped quotes within one property', () => {
    const result = generate(String.raw`properties: {
      first: { type: 'string', description: 'brace } text', hint: "escaped \" } quote", nested: { flag: true } },
      second: { type: 'boolean', description: 'Enabled' }
    }, required: ['first']`);

    expect(result.tools[0].parameters).toEqual({
      first: { type: 'string', description: 'brace } text' },
      second: { type: 'boolean', description: 'Enabled' }
    });
    expect(result.tools[0].required).toEqual(['first']);
  });

  it.each([
    ['comma before required', `properties: { ${property} }, required: ['actual']`],
    ['no comma before required', `properties: { ${property} } required: ['actual']`],
    ['whitespace around comma', `properties: { ${property} } \t,\n required: ['actual']`],
    ['embedded properties keyword', `notproperties: { ${property} }, required: ['actual']`],
    ['required prefix', `properties: { ${property} }, requiredExtra: [], required: ['actual']`]
  ])('preserves %s', (_name, schema) => {
    expect(generate(schema)).toMatchObject({
      version: '1.2.3',
      toolsCount: 1,
      tools: [
        {
          name: 'test_tool',
          description: 'Test tool',
          parameters: { actual: parameter },
          required: ['actual'],
          examples: { basic: { actual: 'example_value' }, advanced: { actual: 'example_value' } }
        }
      ]
    });
  });

  it.each([
    ['ordinary name', property, 'actual'],
    ['dollar-prefixed name', `$${property}`, 'actual'],
    ['Unicode prefix', `é${property}`, 'actual'],
    ['digit-prefixed name', `12_${property}`, '12_actual'],
    ['comment before name', `/* misleading */ ${property}`, 'actual']
  ])('preserves %s', (_name, content, key) => {
    expect(generate(`properties: { ${content} }, required: []`).tools[0].parameters).toEqual({
      [key]: parameter
    });
  });

  it('keeps scanning past a nonmatching suffix to the schema closing brace', () => {
    expect(generate(`properties: { ${property} }, additional: true`).tools[0].parameters).toEqual({
      actual: parameter
    });
  });

  it('preserves the prior timestamp when extracted documentation is unchanged', () => {
    generate(`properties: { ${property} }, required: []`);
    const previous = JSON.parse(fixture.files.get('docs-data/tools.json'));
    previous.generatedAt = '2000-01-01T00:00:00.000Z';
    fixture.files.set('docs-data/tools.json', JSON.stringify(previous));
    expect(generate(`properties: { ${property} }, required: []`)).toEqual(previous);
  });
});

describe('documentation extraction CPU bounds', () => {
  it.each([
    [
      'property suffix whitespace',
      `properties: { ${property}${' '.repeat(32_000)}, second: { type: 'number', description: 'Count' } }, required: []`,
      { actual: parameter, second: { type: 'number', description: 'Count' } }
    ],
    [
      'word in leading comment',
      `properties: { /* ${'x'.repeat(32_000)} */ ${property} }, required: []`,
      { actual: parameter }
    ]
  ])('bounds CPU work for %s', (_name, schema, expected) => {
    generate(`properties: { ${property} }, required: []`);
    const start = process.cpuUsage();
    const result = generate(schema);
    const elapsed = process.cpuUsage(start);
    expect(result.tools[0].parameters).toEqual(expected);
    // CPU time excludes scheduler delays, with ample room for coverage instrumentation.
    expect(elapsed.user + elapsed.system).toBeLessThan(250_000);
  });
});
