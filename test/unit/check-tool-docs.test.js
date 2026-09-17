import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COUNT_DOC,
  GENERATED_DATA,
  TOOL_REFERENCE,
  checkToolDocs,
  findCountMarkers,
  formatReport,
  mentionsTool,
  stripLinkDestinations,
  visibleText,
  wordTokens
} from '../../scripts/docs/check-tool-docs.mjs';
import { getAllTools } from '../../lib/tools/tool-registry.js';

// The step this replaces ran, passed, and checked nothing: it regexed `index.js` for tool
// names after the definitions had moved to lib/tools/tool-registry.js, matched the SERVER
// name twice, and found that string in README.md - so it reported "All tools are documented"
// unconditionally (#1265). The point of these tests is therefore not that the gate passes.
// It is that the gate can FAIL, in every direction, on fixtures rather than on the
// repository's own state.
const marker = count => `<!-- tool-count -->${count}<!-- /tool-count -->`;

const BASE = {
  tools: ['a_tool', 'b_tool'],
  reference: `The server exposes a_tool and b_tool. ${marker(2)}`,
  countDoc: `We ship ${marker(2)} tools.`,
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
});

// Third review round on #1268. Finding tool NAMES and finding count CLAIMS need different
// normalisations, and reusing one for the other was wrong in both directions.
describe('what counts as a tool being documented', () => {
  const gen = name => ({ toolsCount: 1, tools: [{ name }] });
  const forTool = (name, reference) =>
    checkToolDocs({
      tools: [name],
      reference: `${reference} ${marker(1)}`,
      countDoc: `We ship ${marker(1)} tools.`,
      generated: gen(name)
    });

  // WARP.md documents tool names in backticks throughout, so deleting code spans - correct for
  // count claims - reported the most visibly documented tools as missing. A required gate that
  // fails a correct document is the one that gets switched off.
  it('accepts a name documented only in a code span', () => {
    expect(forTool('new_tool', '### `new_tool`\n\nDoes a thing.').ok).toBe(true);
    expect(forTool('new_tool', 'Call `new_tool` to begin.').ok).toBe(true);
  });

  // The other direction: a name nobody sees in the rendered page is not documentation.
  it('does not accept a name that appears only in a link destination', () => {
    const result = forTool('new_tool', 'see the [tool guide](docs/new_tool.md)');

    expect(result.undocumented).toEqual(['new_tool']);
    expect(result.ok).toBe(false);
  });

  it('accepts a name used as link text, which a reader does see', () => {
    expect(forTool('new_tool', 'see [new_tool](docs/guide.md) for details').ok).toBe(true);
  });

  it('ignores reference-style link definitions', () => {
    expect(forTool('new_tool', 'see [the guide][g]\n\n[g]: docs/new_tool.md').ok).toBe(false);
  });

  it('keeps span contents but drops the ticks, so tokens split correctly', () => {
    expect(wordTokens(visibleText('`a_tool`')).has('a_tool')).toBe(true);
    expect(visibleText('[x](y/z_tool.md)')).not.toContain('z_tool');
  });
});

// The count check is an exact marker rather than a prose scan. Four review rounds produced
// findings against the prose version in both directions and for one underlying reason: reading
// English for a number is a heuristic, and a heuristic in a REQUIRED gate fails expensively. A
// pattern narrow enough to avoid false positives missed WARP.md's "16 different database
// operation tools"; widening it read "We added 3 new database tools" as a claim about the
// registry, which would fail CI on an ordinary sentence.
describe('the tool count is checked from an explicit marker', () => {
  it('passes when every marker matches the registry', () => {
    expect(check({}).ok).toBe(true);
    expect(check({}).claims).toHaveLength(2);
  });

  it('fails on a stale marker and names the document and line', () => {
    const result = check({ countDoc: `We ship ${marker(3)} tools.` });

    expect(result.ok).toBe(false);
    expect(result.staleClaims).toHaveLength(1);
    expect(result.staleClaims[0]).toMatchObject({ count: 3, doc: COUNT_DOC, line: 1 });
    expect(formatReport(result)).toContain('the registry declares 2');
  });

  it('checks the reference as well as the front page', () => {
    const result = check({ reference: `a_tool and b_tool ${marker(9)}` });

    expect(result.staleClaims.map(claim => claim.doc)).toEqual([TOOL_REFERENCE]);
    expect(result.ok).toBe(false);
  });

  // Otherwise deleting the marker would be a silent way to stop the count being checked - the
  // exact failure mode of the step this whole file replaces.
  it('fails when a document carries no marker at all', () => {
    const result = check({ countDoc: 'We ship some tools.' });

    expect(result.unmarked).toEqual([COUNT_DOC]);
    expect(result.ok).toBe(false);
    expect(formatReport(result)).toContain('No `tool-count` marker');
  });

  // The whole point of moving off prose: ordinary sentences are no longer claims.
  it('does not read prose as a count claim', () => {
    expect(findCountMarkers('We added 3 new database tools')).toEqual([]);
    expect(findCountMarkers('Version 2 supports the MCP tools')).toEqual([]);
    expect(findCountMarkers('16 tools')).toEqual([]);
    expect(findCountMarkers('run `npm reports 17 tools`')).toEqual([]);
  });

  it('reads the marker from raw Markdown, since it is itself an HTML comment', () => {
    expect(findCountMarkers(`intro\n\n${marker(7)}`)).toEqual([{ count: 7, line: 3 }]);
    expect(findCountMarkers('<!--tool-count-->7<!--/tool-count-->')).toEqual([
      { count: 7, line: 1 }
    ]);
  });
});

// A Markdown destination may contain balanced parentheses, so a first-`)` pattern left part of
// the URL behind and a tool named in that remainder counted as documented.
describe('link destinations are consumed whole', () => {
  it('handles balanced parentheses in a destination', () => {
    expect(stripLinkDestinations('see [guide](docs/foo(and)/new_tool.md)')).toBe('see [guide]');
    expect(visibleText('see [guide](docs/foo(and)/new_tool.md)')).not.toContain('new_tool');
  });

  it('keeps an unbalanced destination verbatim rather than eating the rest', () => {
    expect(stripLinkDestinations('see [guide](oops and more text')).toContain('oops and more text');
  });

  it('handles several links and text between them', () => {
    expect(stripLinkDestinations('[a](x) then [b](y(z))!')).toBe('[a] then [b]!');
  });
});

describe('the gate actually runs', () => {
  // Enforcement rides on `npm run docs:check`, which #1262 put in the required
  // `Code Quality & Linting` job. If it is not chained there, this gate is exactly the
  // decoration it was written to replace.
  it('is reachable from the aggregate the required CI job runs', () => {
    const scripts = JSON.parse(readRepo('package.json')).scripts;

    expect(scripts['docs:check:tools']).toBe('node scripts/docs/check-tool-docs.mjs');

    // `docs:check` runs every check and reports all of them rather than chaining with `&&`,
    // which stopped at the first failure. The runner's own coverage is pinned in
    // test/unit/run-doc-checks.test.js.
    expect(scripts['docs:check']).toBe('node scripts/docs/run-doc-checks.mjs');
    expect(readRepo('scripts/docs/run-doc-checks.mjs')).toContain('check-tool-docs.mjs');
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
});

describe('exported paths', () => {
  it('names the surfaces it checks', () => {
    expect(TOOL_REFERENCE).toBe('WARP.md');
    expect(COUNT_DOC).toBe('README.md');
    expect(GENERATED_DATA).toBe('docs-data/tools.json');
  });
});
