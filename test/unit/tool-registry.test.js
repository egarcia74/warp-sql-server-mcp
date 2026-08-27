import { describe, test, expect } from 'vitest';
import { getAllTools, getTool } from '../../lib/tools/tool-registry.js';

/**
 * Unit Tests for the MCP tool registry
 *
 * The registry is the contract that schema-validating MCP clients use to decide
 * which arguments they are allowed to send. These tests guard that contract:
 * - every tool exposes a well-formed inputSchema
 * - handler parameters that are implemented are actually declared (#1081)
 */

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

  describe('get_table_data', () => {
    const tool = getTool('get_table_data');

    test('is registered', () => {
      expect(tool).not.toBeNull();
    });

    test('declares offset so schema-validating clients can page through tables (#1081)', () => {
      const { offset } = tool.inputSchema.properties;
      expect(offset).toBeDefined();
      expect(offset.type).toBe('number');
      expect(typeof offset.description).toBe('string');
      expect(offset.description.length).toBeGreaterThan(0);
    });

    test('declares offset alongside limit', () => {
      const keys = Object.keys(tool.inputSchema.properties);
      expect(keys).toContain('limit');
      expect(keys.indexOf('offset')).toBe(keys.indexOf('limit') + 1);
    });
  });
});
