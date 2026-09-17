import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COUNT_DOC,
  GENERATED_DATA,
  TOOL_REFERENCE,
  checkToolDocs,
  findCountClaims,
  formatReport,
  prose
} from '../../scripts/docs/check-tool-docs.mjs';
import { getAllTools } from '../../lib/tools/tool-registry.js';

// The step this replaces ran, passed, and checked nothing: it regexed `index.js` for tool
// names after the definitions had moved to lib/tools/tool-registry.js, matched the SERVER
// name twice, and found that string in README.md - so it reported "All tools are documented"
// unconditionally (#1265). The point of these tests is therefore not that the gate passes.
// It is that the gate can FAIL, in every direction, on fixtures rather than on the
// repository's own state.
const BASE = {
  tools: ['a_tool', 'b_tool'],
  reference: 'The server exposes a_tool and b_tool.',
  countDoc: 'We ship 2 tools.',
  generated: { toolsCount: 2, tools: [{ name: 'a_tool' }, { name: 'b_tool' }] }
};

const check = overrides => checkToolDocs({ ...BASE, ...overrides });

const repoRoot = join(import.meta.dirname, '..', '..');
const readRepo = relative => readFileSync(join(repoRoot, relative), 'utf8');

describe('checkToolDocs', () => {
  it('passes when every surface agrees', () => {
    const result = check({});

    expect(result.ok).toBe(true);
    expect(formatReport(result)).toContain('✅');
  });

  it('fails when a tool is missing from the hand-written reference', () => {
    const result = check({ reference: 'The server exposes a_tool.' });

    expect(result.ok).toBe(false);
    expect(result.undocumented).toEqual(['b_tool']);
    expect(formatReport(result)).toContain(`Not documented in \`${TOOL_REFERENCE}\``);
  });

  // The front page claims a number rather than a list, so the number is what can rot - and it
  // rots in the most visible place there is.
  it('fails when a count claim no longer matches the registry', () => {
    const result = check({ countDoc: 'We ship 3 tools.' });

    expect(result.ok).toBe(false);
    expect(result.staleClaims).toHaveLength(1);
    expect(result.staleClaims[0]).toMatchObject({ count: 3, line: 1 });
    expect(formatReport(result)).toContain('but the registry declares 2');
  });

  it('checks every count claim, not just the first', () => {
    const result = check({ countDoc: 'We ship 2 tools.\n\nA reference to all 7 MCP tools.' });

    expect(result.staleClaims.map(claim => claim.count)).toEqual([7]);
  });

  it('fails in both directions on the committed generated data', () => {
    const missing = check({ generated: { toolsCount: 1, tools: [{ name: 'a_tool' }] } });
    expect(missing.missingFromData).toEqual(['b_tool']);
    expect(missing.ok).toBe(false);

    const stale = check({
      generated: {
        toolsCount: 3,
        tools: [{ name: 'a_tool' }, { name: 'b_tool' }, { name: 'ghost' }]
      }
    });
    expect(stale.staleInData).toEqual(['ghost']);
    expect(stale.ok).toBe(false);
  });

  // `toolsCount` is written by the generator alongside the array, so the two can only diverge
  // if the file was hand-edited - which is worth saying out loud rather than silently ignoring.
  it('fails when the generated data disagrees with itself', () => {
    const result = check({
      generated: { toolsCount: 99, tools: [{ name: 'a_tool' }, { name: 'b_tool' }] }
    });

    expect(result.countFieldWrong).toBe(true);
    expect(formatReport(result)).toContain('disagrees with itself');
  });

  it('tolerates generated data that is missing or shaped wrongly', () => {
    expect(check({ generated: {} }).missingFromData).toEqual(['a_tool', 'b_tool']);
    expect(check({ generated: null }).ok).toBe(false);
  });
});

describe('count claims are read from prose only', () => {
  it('ignores a count inside a fenced block', () => {
    const result = check({ countDoc: 'We ship 2 tools.\n\n```\nthere are 99 tools here\n```\n' });

    expect(result.ok).toBe(true);
  });

  it('ignores a count inside an HTML comment', () => {
    const result = check({ countDoc: 'We ship 2 tools.\n\n<!-- was 99 tools -->\n' });

    expect(result.ok).toBe(true);
  });

  // The regex has to be narrow enough not to claim unrelated numbers. "1,686 Tests" sits two
  // lines from a tool count in the real README.
  it('does not mistake a neighbouring number for a tool count', () => {
    expect(findCountClaims('1,686 Tests and 12 databases').map(c => c.count)).toEqual([]);
    expect(findCountClaims('16 tools').map(c => c.count)).toEqual([16]);
    expect(findCountClaims('16 Database Tools').map(c => c.count)).toEqual([16]);
    expect(findCountClaims('16 MCP tools').map(c => c.count)).toEqual([16]);
    expect(findCountClaims('1,686 tools').map(c => c.count)).toEqual([1686]);
  });

  it('reports the line so a failure can be acted on without hunting', () => {
    expect(findCountClaims('intro\n\nthen 4 tools here')[0].line).toBe(3);
  });

  it('strips fences before anything else looks at the text', () => {
    expect(prose('a\n```\nhidden\n```\nb')).not.toContain('hidden');
  });
});

describe('the gate actually runs', () => {
  // Enforcement rides on `npm run docs:check`, which #1262 put in the required
  // `Code Quality & Linting` job. If it is not chained there, this gate is exactly the
  // decoration it was written to replace.
  it('is chained into the aggregate the required CI job runs', () => {
    const scripts = JSON.parse(readRepo('package.json')).scripts;

    expect(scripts['docs:check:tools']).toBe('node scripts/docs/check-tool-docs.mjs');
    expect(scripts['docs:check']).toContain('docs:check:tools');
  });

  // The vacuous predecessor must be gone, not merely superseded - two checks of the same
  // thing, one of which always passes, is how the first one got trusted.
  it('has removed the index.js regex step it replaces', () => {
    const workflow = readRepo('.github/workflows/docs.yml');

    expect(workflow).not.toContain('Validate MCP tool documentation');
    expect(workflow).not.toContain('tool-docs-report.txt');
  });
});

describe('the repository as it stands', () => {
  it('documents every registered tool and states the right count', () => {
    const result = checkToolDocs();

    expect(result.undocumented).toEqual([]);
    expect(result.staleClaims).toEqual([]);
    expect(result.missingFromData).toEqual([]);
    expect(result.staleInData).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reads the registry rather than parsing a source file', () => {
    // The predecessor's whole failure was asking a file what the code declares. Pin that the
    // tool list comes from the registry, and that it is not empty - an empty list would make
    // every check above vacuously true.
    const result = checkToolDocs();

    expect(result.tools).toEqual(getAllTools().map(tool => tool.name));
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it('finds the count claims that are actually in the README', () => {
    const claims = findCountClaims(readRepo(COUNT_DOC));

    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(claim.count).toBe(getAllTools().length);
  });
});

describe('exported paths', () => {
  it('names the surfaces it checks', () => {
    expect(TOOL_REFERENCE).toBe('WARP.md');
    expect(COUNT_DOC).toBe('README.md');
    expect(GENERATED_DATA).toBe('docs-data/tools.json');
  });
});
