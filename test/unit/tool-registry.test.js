import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getAllTools, getTool } from '../../lib/tools/tool-registry.js';

/**
 * Unit Tests for the MCP tool registry
 *
 * The registry is the contract that schema-validating MCP clients use to decide
 * which arguments they are allowed to send. These tests guard that contract:
 * - every tool exposes a well-formed inputSchema (type object, properties present,
 *   required is a subset of properties, unique names)
 * - get_table_data declares the offset parameter its handler implements (#1081)
 *
 * Dispatch-coverage guard (#1058)
 * -------------------------------
 * The root cause of #1058 was "dead" schema properties: a tool declared an input
 * property (so schema-validating clients happily sent it) that the dispatcher in
 * index.js never read, so the value was silently dropped. To stop that class of
 * bug from recurring we statically parse index.js, isolate each tool's `case`
 * block in the CallTool switch, and assert every property the tool declares is
 * referenced there as `args.<property>`.
 *
 * This is intentionally a *static source* check (not a runtime spy): it is cheap,
 * needs no DB, and fails loudly the moment a new declared property is added
 * without wiring. Properties are consumed under their declared (snake_case) name
 * because the dispatcher reads `args.<declared_name>` before mapping to any
 * camelCase handler argument, so no alias table is required today. A small,
 * explicitly documented allow-list covers properties that are declared but
 * knowingly NOT yet wired (see DEFERRED_PROPS) so the deferral is visible and
 * must be consciously removed when the gap is closed.
 */

// Properties that are declared in a tool schema but intentionally not yet
// consumed by the dispatcher, with the reason. Keeping them here (rather than
// deleting the assertion) makes the honesty gap explicit and auditable.
//
// Currently empty. get_optimization_insights.analysis_period used to live here:
// the insight combines two DMV sources with different time semantics (the
// missing-index DMVs are cumulative aggregates that cannot be windowed), so the
// period is still NOT applied — but since #1103 the dispatcher reads it and the
// optimizer echoes it back in the response's `analysisPeriod` disclosure
// (`applied: false`), so it is no longer an unread "dead" property.
const DEFERRED_PROPS = {};

const indexSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../index.js'),
  'utf8'
);

/**
 * Extract the body of a single tool's `case '<name>':` block from the CallTool
 * switch in index.js: from that case label up to the next `case '...'` label or
 * the switch's `default:`.
 */
function dispatchBlockFor(toolName) {
  const switchStart = indexSource.indexOf('switch (name)');
  expect(switchStart).toBeGreaterThan(-1);
  const region = indexSource.slice(switchStart);

  const caseMarker = `case '${toolName}':`;
  const start = region.indexOf(caseMarker);
  if (start === -1) return null;

  const rest = region.slice(start + caseMarker.length);
  const nextCase = rest.search(/case '[a-z_]+':/);
  const nextDefault = rest.search(/\n\s*default:/);
  const candidates = [nextCase, nextDefault].filter(i => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : rest.length;
  return rest.slice(0, end);
}

describe('Tool Registry', () => {
  const tools = getAllTools();

  describe('schema invariants', () => {
    test('registry exposes at least one tool', () => {
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('tool names are unique', () => {
      const names = tools.map(tool => tool.name);
      expect(new Set(names).size).toBe(names.length);
    });

    test.each(tools.map(tool => [tool.name, tool]))(
      '%s has a name, description and object inputSchema',
      (_name, tool) => {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeTypeOf('object');
        expect(tool.inputSchema.properties).not.toBeNull();
      }
    );

    test.each(tools.map(tool => [tool.name, tool]))(
      '%s lists only declared properties as required',
      (_name, tool) => {
        const { properties, required = [] } = tool.inputSchema;
        expect(Array.isArray(required)).toBe(true);
        for (const key of required) {
          expect(Object.keys(properties)).toContain(key);
        }
      }
    );
  });

  describe('dispatch consumes every declared property (#1058)', () => {
    test('each tool has a case block in the index.js CallTool switch', () => {
      for (const tool of tools) {
        expect(dispatchBlockFor(tool.name), `no dispatch case for ${tool.name}`).not.toBeNull();
      }
    });

    test.each(tools.map(tool => [tool.name, tool]))(
      '%s: dispatcher reads every declared inputSchema property',
      (name, tool) => {
        const block = dispatchBlockFor(name);
        expect(block, `no dispatch case for ${name}`).not.toBeNull();

        const declared = Object.keys(tool.inputSchema.properties ?? {});
        const consumed = new Set(
          [...block.matchAll(/args\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => m[1])
        );
        const deferred = DEFERRED_PROPS[name] ?? new Set();

        for (const prop of declared) {
          if (deferred.has(prop)) continue;
          expect(
            consumed.has(prop),
            `Tool '${name}' declares '${prop}' but the dispatcher never reads args.${prop}. ` +
              'Wire it into the handler, or (if it cannot be honored) add it to DEFERRED_PROPS with a reason.'
          ).toBe(true);
        }
      }
    );

    test('the 6 tools named in #1058 forward each declared property (except documented deferrals)', () => {
      const issueTools = [
        'get_table_data',
        'export_table_csv',
        'get_performance_stats',
        'get_query_performance',
        'get_index_recommendations',
        'get_optimization_insights'
      ];
      for (const name of issueTools) {
        const tool = getTool(name);
        const block = dispatchBlockFor(name);
        const consumed = new Set(
          [...block.matchAll(/args\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => m[1])
        );
        const deferred = DEFERRED_PROPS[name] ?? new Set();
        for (const prop of Object.keys(tool.inputSchema.properties ?? {})) {
          if (deferred.has(prop)) continue;
          expect(consumed.has(prop), `${name}.${prop} not forwarded`).toBe(true);
        }
      }
    });
  });

  describe('get_table_data', () => {
    const tool = getTool('get_table_data');

    test('is registered', () => {
      expect(tool).not.toBeNull();
    });

    test('declares offset so schema-validating clients can page through tables (#1081)', () => {
      const { offset } = tool.inputSchema.properties;
      expect(offset).toBeDefined();
      expect(offset.type).toBe('integer');
      expect(offset.minimum).toBe(0);
      expect(typeof offset.description).toBe('string');
      expect(offset.description.length).toBeGreaterThan(0);
    });

    test('constrains limit to a positive integer', () => {
      const { limit } = tool.inputSchema.properties;
      expect(limit.type).toBe('integer');
      expect(limit.minimum).toBe(1);
    });

    test('declares both limit and offset paging parameters', () => {
      const keys = Object.keys(tool.inputSchema.properties);
      expect(keys).toEqual(expect.arrayContaining(['limit', 'offset']));
    });
  });

  describe('get_optimization_insights', () => {
    const tool = getTool('get_optimization_insights');
    const period = tool.inputSchema.properties.analysis_period;

    test('keeps the analysis_period enum so clients that already send it still validate (#1103)', () => {
      expect(period.type).toBe('string');
      expect(period.enum).toEqual(['24_HOURS', '7_DAYS', '30_DAYS']);
    });

    test('analysis_period description does not claim a default window is applied (#1103)', () => {
      expect(period.description).not.toMatch(/defaults? to/i);
    });

    test('analysis_period description states the parameter is reserved / not applied (#1103)', () => {
      expect(period.description).toMatch(/reserved/i);
      expect(period.description).toMatch(/not (yet )?applied/i);
    });
  });
});
