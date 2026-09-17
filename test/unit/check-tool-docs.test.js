import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  GENERATED_DATA,
  checkToolDocs,
  formatReport
} from '../../scripts/docs/check-tool-docs.mjs';
import { getAllTools } from '../../lib/tools/tool-registry.js';

// The step this replaces ran, passed, and checked nothing: it regexed `index.js` for tool names
// after the definitions had moved to lib/tools/tool-registry.js, matched the SERVER name twice,
// and found that string in README.md - so it reported "All tools are documented" unconditionally
// (#1265). The point of these tests is therefore not that the gate passes. It is that the gate
// can FAIL, in every direction, on fixtures rather than on the repository's own state.
const BASE = {
  tools: ['a_tool', 'b_tool'],
  generated: { toolsCount: 2, tools: [{ name: 'a_tool' }, { name: 'b_tool' }] }
};

const check = overrides => checkToolDocs({ ...BASE, ...overrides });

describe('checkToolDocs', () => {
  it('passes when the generated data matches the registry', () => {
    const result = check({});

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('✅');
  });

  it('fails when a registered tool is missing from the generated data', () => {
    const result = check({ generated: { toolsCount: 1, tools: [{ name: 'a_tool' }] } });

    expect(result.missingFromData).toEqual(['b_tool']);
    expect(result.ok).toBe(false);
    expect(formatReport(result)).toContain(`Missing from \`${GENERATED_DATA}\``);
  });

  it('fails when the generated data lists a tool the registry no longer has', () => {
    const result = check({
      generated: {
        toolsCount: 3,
        tools: [{ name: 'a_tool' }, { name: 'b_tool' }, { name: 'ghost' }]
      }
    });

    expect(result.staleInData).toEqual(['ghost']);
    expect(result.ok).toBe(false);
  });

  // Set membership cannot see a repeat: every name present, none stale, and `toolsCount`
  // agreeing with the array it was generated from, while the published page renders a tool twice.
  it('fails when a tool is listed twice', () => {
    const result = check({
      generated: {
        toolsCount: 3,
        tools: [{ name: 'a_tool' }, { name: 'b_tool' }, { name: 'b_tool' }]
      }
    });

    expect(result.duplicatesInData).toEqual(['b_tool']);
    expect(result.ok).toBe(false);
    expect(formatReport(result)).toContain('Listed more than once');
  });

  // Treating an absent or wrongly-typed field as "nothing to check" is how a check ends up
  // reporting success over data it never looked at - the failure this whole file replaces.
  it('rejects a count field that is absent, null or not a number', () => {
    const tools = [{ name: 'a_tool' }, { name: 'b_tool' }];

    expect(check({ generated: { tools } }).ok).toBe(false);
    expect(check({ generated: { toolsCount: null, tools } }).ok).toBe(false);
    expect(check({ generated: { toolsCount: '2', tools } }).ok).toBe(false);
    expect(check({ generated: { toolsCount: 2, tools } }).ok).toBe(true);
  });

  it('reports a count field that disagrees with its own array', () => {
    const result = check({
      generated: { toolsCount: 99, tools: [{ name: 'a_tool' }, { name: 'b_tool' }] }
    });

    expect(result.countFieldWrong).toBe(true);
    expect(formatReport(result)).toContain('count field is wrong');
  });

  it('tolerates generated data that is missing or shaped wrongly', () => {
    expect(check({ generated: {} }).missingFromData).toEqual(['a_tool', 'b_tool']);
    expect(check({ generated: null }).ok).toBe(false);
  });
});

describe('the gate actually runs', () => {
  const repoRoot = join(import.meta.dirname, '..', '..');
  const readRepo = relative => readFileSync(join(repoRoot, relative), 'utf8');

  // Enforcement rides on `npm run docs:check`, which #1262 put in the required
  // `Code Quality & Linting` job. If it is not reachable from there, this gate is exactly the
  // decoration it was written to replace.
  it('is reachable from the aggregate the required CI job runs', () => {
    const scripts = JSON.parse(readRepo('package.json')).scripts;

    expect(scripts['docs:check:tools']).toBe('node scripts/docs/check-tool-docs.mjs');
    expect(scripts['docs:check']).toBe('node scripts/docs/run-doc-checks.mjs');
    expect(readRepo('scripts/docs/run-doc-checks.mjs')).toContain('check-tool-docs.mjs');
  });

  // The vacuous predecessor must be gone, not merely superseded - two checks of the same thing,
  // one of which always passes, is how the first one came to be trusted.
  it('has removed the index.js regex step it replaces', () => {
    const workflow = readRepo('.github/workflows/docs.yml');

    expect(workflow).not.toContain('Validate MCP tool documentation');
    expect(workflow).not.toContain('tool-docs-report.txt');
  });
});

describe('the repository as it stands', () => {
  it('has generated data matching the registry', () => {
    const result = checkToolDocs();

    expect(result.missingFromData).toEqual([]);
    expect(result.staleInData).toEqual([]);
    expect(result.duplicatesInData).toEqual([]);
    expect(result.countFieldWrong).toBe(false);
    expect(result.ok).toBe(true);
  });

  // The predecessor's whole failure was asking a FILE what the code declares. Pin that the tool
  // list comes from the registry, and that it is not empty - an empty list would make every
  // assertion above vacuously true.
  it('reads the registry rather than parsing a source file', () => {
    const result = checkToolDocs();

    expect(result.tools).toEqual(getAllTools().map(tool => tool.name));
    expect(result.tools.length).toBeGreaterThan(0);
  });
});
