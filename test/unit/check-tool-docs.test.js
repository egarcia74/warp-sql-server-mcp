import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';

import {
  COUNT_DOC,
  GENERATED_DATA,
  TOOL_REFERENCE,
  checkToolDocs,
  findCountClaims,
  formatReport,
  mentionsTool,
  prose,
  wordTokens
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

// All four found in review on #1268, all reproduced before fixing. Three were false
// NEGATIVES - the gate reporting success on documentation that had drifted, which is the
// same class of fault as the vacuous step this file replaces. The fourth was a false
// POSITIVE, which is worse in a required check: a gate that fails a correct document is the
// one people switch off rather than fix.
describe('drift the first implementation could not see', () => {
  // `String.includes` is not enough because tool names nest, and `\b` does not help: `_` is a
  // word character, so there is no boundary between `get_table` and `_data`.
  it('does not accept a longer tool name as documentation of a shorter one', () => {
    const result = checkToolDocs({
      tools: ['get_table'],
      reference: 'see get_table_data for details',
      countDoc: 'We ship 1 tools.',
      generated: { toolsCount: 1, tools: [{ name: 'get_table' }] }
    });

    expect(result.undocumented).toEqual(['get_table']);
    expect(result.ok).toBe(false);
  });

  // Implemented as a token set rather than a per-name regular expression: Opengrep flags a
  // dynamically built RegExp as a DoS surface, and the check never needed one. Names come from
  // the registry, not a user, so it was not exploitable - but a set lookup is simpler and
  // O(document) rather than O(document x tools).
  it('tokenises on runs of non-word characters', () => {
    expect(wordTokens('a `b_c` **d**, e').has('b_c')).toBe(true);
    expect(wordTokens('get_table_data_extended').has('get_table_data')).toBe(false);
  });

  it('still matches a name that is genuinely present, in any surrounding punctuation', () => {
    expect(mentionsTool('call `get_table_data` first', 'get_table_data')).toBe(true);
    expect(mentionsTool('- **get_table_data** - rows', 'get_table_data')).toBe(true);
    expect(mentionsTool('see get_table_data_extended', 'get_table_data')).toBe(false);
    expect(mentionsTool('xget_table_data', 'get_table_data')).toBe(false);
  });

  // Set membership cannot see a repeat: every name present, none stale, and `toolsCount`
  // agrees with the array it was generated from - so the reference page renders a tool twice
  // and every check passes.
  it('rejects a tool listed twice in the generated data', () => {
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

  it('counts a claim however it is capitalised', () => {
    expect(findCountClaims('17 database tools').map(c => c.count)).toEqual([17]);
    expect(findCountClaims('17 TOOLS').map(c => c.count)).toEqual([17]);
    expect(findCountClaims('17 MCP Tools').map(c => c.count)).toEqual([17]);
    expect(findCountClaims('17 Database Tools').map(c => c.count)).toEqual([17]);
  });

  // The false positive. A required gate that fails a correct document gets disabled.
  it('does not read an inline code example as a claim about this server', () => {
    const countDoc = 'We ship 2 tools. Run `npm reports 17 tools` to check.';

    expect(findCountClaims(countDoc).map(c => c.count)).toEqual([2]);
    expect(check({ countDoc }).ok).toBe(true);
  });

  it('still fails on a stale claim sitting beside an inline example', () => {
    const countDoc = 'We ship 9 tools. Run `npm reports 17 tools` to check.';

    expect(check({ countDoc }).staleClaims.map(c => c.count)).toEqual([9]);
  });
});

// SonarCloud javascript:S8786 on the first implementation, and it was right. `\d[\d,]*`
// overlapped the `\s+` after it, so a long digit run that is not a claim made the engine give
// back one character and retry per position: 16,000 digits took 439ms, four times the cost of
// 8,000. The regex now uses the JavaScript spelling of an atomic group, which looks strange
// enough that someone will eventually want to "simplify" it - this is why they should not.
// Second review round on #1268. Two more false negatives and one fault of my own: the four
// strippers were composed here by hand and two were transposed.
describe('drift the second implementation could not see', () => {
  it('rejects a generated count that is absent, null or not a number', () => {
    const tools = [{ name: 'a_tool' }, { name: 'b_tool' }];

    expect(check({ generated: { tools } }).ok).toBe(false);
    expect(check({ generated: { toolsCount: null, tools } }).ok).toBe(false);
    expect(check({ generated: { toolsCount: '2', tools } }).ok).toBe(false);
    expect(check({ generated: { toolsCount: 2, tools } }).ok).toBe(true);
  });

  // WARP.md:36 carries its own count. Scanning only the README left the repository's
  // designated reference free to contradict the registry.
  it('checks count claims in the reference, not only the front page', () => {
    const result = check({ reference: 'We have 9 tools: a_tool and b_tool' });

    expect(result.ok).toBe(false);
    expect(result.staleClaims.map(claim => claim.doc)).toEqual([TOOL_REFERENCE]);
  });

  // "16 different database operation tools" is how WARP.md phrases it. An earlier pattern
  // allowed exactly one word between the number and "tools" and so read past it entirely.
  it('matches a claim with words between the number and the noun', () => {
    expect(findCountClaims('16 different database operation tools').map(c => c.count)).toEqual([
      16
    ]);
    expect(findCountClaims('16 tests and 3 tools').map(c => c.count)).toEqual([3]);
    expect(findCountClaims('upgraded 16 times before adding more tools').map(c => c.count)).toEqual(
      []
    );
  });

  // My own: `stripHtmlComments` ran before `stripRawTextHtml`, so a raw-text block holding a
  // literal unterminated `<!--` truncated the document and every later claim vanished - the
  // gate reporting success on text it had stopped reading. The composition now lives in
  // `markdown-blocks.mjs` so there is one order rather than one per caller.
  it('does not let an unterminated comment inside a raw-text block truncate the document', () => {
    const doc = 'We ship 2 tools.\n<pre>\n<!-- example\n</pre>\nLater we claim 99 tools.';

    expect(findCountClaims(doc).map(claim => claim.count)).toEqual([2, 99]);
  });
});

describe('the count matcher stays linear', () => {
  const timeOf = input => {
    const started = performance.now();
    findCountClaims(input);
    return performance.now() - started;
  };

  it('does not degrade on a long run of digits that is not a claim', () => {
    // Generous by an order of magnitude against the 439ms the backtracking version took, so
    // this fails on a real regression rather than on a busy machine.
    expect(timeOf(`${'1'.repeat(16000)} x`)).toBeLessThan(50);
  });

  it('scales roughly linearly rather than quadratically', () => {
    const small = timeOf(`${'1'.repeat(4000)} x`);
    const large = timeOf(`${'1'.repeat(16000)} x`);

    // Quadratic would be ~16x for 4x the input. Allow a wide band; the failing case was 16x.
    expect(large).toBeLessThan(Math.max(small * 8, 25));
  });

  it('will not start a claim part-way into a token', () => {
    expect(findCountClaims('x16 tools').map(claim => claim.count)).toEqual([]);
    expect(findCountClaims('(16 tools)').map(claim => claim.count)).toEqual([16]);
    expect(findCountClaims('ships 16 tools').map(claim => claim.count)).toEqual([16]);
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
