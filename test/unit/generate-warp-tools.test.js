import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  renderToolInventory,
  replaceToolInventory,
  runToolInventory
} from '../../scripts/docs/generate-warp-tools.mjs';

const TOOLS = [{ name: 'a_tool' }, { name: 'b_tool' }];
const HEADER = '### MCP Tools Available\n\n<!-- BEGIN GENERATED MCP TOOLS -->\n\n';
const FOOTER = '\n<!-- END GENERATED MCP TOOLS -->\n\n#### Usage notes\nManual prose.\n';
const INPUT = `Before\n\n${HEADER}stale\n${FOOTER}\nAfter\n`;
const OUTPUT =
  `Before\n\n${HEADER}` +
  '- [`a_tool`](docs/tools.html#a_tool)\n' +
  '- [`b_tool`](docs/tools.html#b_tool)\n' +
  `${FOOTER}\nAfter\n`;

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('registry-generated WARP tool inventory', () => {
  it('renders each registry tool in order as a link to its published anchor', () => {
    expect(renderToolInventory(TOOLS)).toBe(
      '- [`a_tool`](docs/tools.html#a_tool)\n- [`b_tool`](docs/tools.html#b_tool)\n'
    );
  });

  it('rejects an empty, duplicate, or unsafe registry name list', () => {
    expect(() => renderToolInventory([])).toThrow();
    expect(() => renderToolInventory([{ name: 'a_tool' }, { name: 'a_tool' }])).toThrow();
    expect(() => renderToolInventory([{ name: 'bad](evil' }])).toThrow();
  });

  it('changes only the marked inventory and keeps manual prose byte-for-byte', () => {
    expect(replaceToolInventory(INPUT, TOOLS)).toBe(OUTPUT);
    expect(replaceToolInventory(OUTPUT, TOOLS)).toBe(OUTPUT);
  });

  it('keeps Markdown formatter spacing around the generated list', () => {
    const tight = OUTPUT.replace(
      '<!-- BEGIN GENERATED MCP TOOLS -->\n\n',
      '<!-- BEGIN GENERATED MCP TOOLS -->\n'
    ).replace('\n\n<!-- END GENERATED MCP TOOLS -->', '\n<!-- END GENERATED MCP TOOLS -->');
    expect(replaceToolInventory(tight, TOOLS)).toBe(OUTPUT);
  });

  it('rejects a missing, repeated, reversed, or displaced marker', () => {
    expect(() =>
      replaceToolInventory(INPUT.replace('<!-- END GENERATED MCP TOOLS -->', ''), TOOLS)
    ).toThrow();
    expect(() => replaceToolInventory(`${INPUT}\n${HEADER}`, TOOLS)).toThrow();
    expect(() => replaceToolInventory(INPUT.replace(HEADER, ''), TOOLS)).toThrow();
    expect(() =>
      replaceToolInventory(
        INPUT.replace('<!-- BEGIN GENERATED MCP TOOLS -->\n\n', '').replace(
          '<!-- END GENERATED MCP TOOLS -->',
          '<!-- BEGIN GENERATED MCP TOOLS -->\n<!-- END GENERATED MCP TOOLS -->'
        ),
        TOOLS
      )
    ).toThrow();
    const fenced = INPUT.replace(
      HEADER,
      '### MCP Tools Available\n\n```md\n<!-- BEGIN GENERATED MCP TOOLS -->\n'
    ).replace('<!-- END GENERATED MCP TOOLS -->', '<!-- END GENERATED MCP TOOLS -->\n```');
    expect(() => replaceToolInventory(fenced, TOOLS)).toThrow();
  });

  it('rejects duplicate headings and CRLF rather than risking prose loss', () => {
    expect(() => replaceToolInventory(`${INPUT}\n### MCP Tools Available\n`, TOOLS)).toThrow();
    expect(() => replaceToolInventory(INPUT.replaceAll('\n', '\r\n'), TOOLS)).toThrow();
  });

  it('rejects an entire fake tool section hidden inside a fenced example', () => {
    expect(() => replaceToolInventory(`\`\`\`md\n${OUTPUT}\`\`\`\n`, TOOLS)).toThrow();
  });

  it('rejects an entire fake tool section hidden inside a raw HTML block', () => {
    expect(() => replaceToolInventory(`<pre>\n${OUTPUT}</pre>\n`, TOOLS)).toThrow();
  });

  it('writes once, is stable on rerun, and checks drift without writing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'warp-tools-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'WARP.md');
    writeFileSync(filePath, INPUT);

    expect(runToolInventory({ mode: 'write', filePath, tools: TOOLS }).changed).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe(OUTPUT);
    expect(runToolInventory({ mode: 'write', filePath, tools: TOOLS }).changed).toBe(false);
    expect(runToolInventory({ mode: 'check', filePath, tools: TOOLS }).ok).toBe(true);

    for (const damaged of [
      OUTPUT.replace('- [`a_tool`](docs/tools.html#a_tool)\n', ''),
      OUTPUT.replace('- [`a_tool`](docs/tools.html#a_tool)', '- [`ghost`](docs/tools.html#ghost)'),
      OUTPUT.replace(
        '- [`b_tool`](docs/tools.html#b_tool)',
        '- [`a_tool`](docs/tools.html#a_tool)'
      ),
      OUTPUT.replace(
        '- [`a_tool`](docs/tools.html#a_tool)\n- [`b_tool`](docs/tools.html#b_tool)',
        '- [`b_tool`](docs/tools.html#b_tool)\n- [`a_tool`](docs/tools.html#a_tool)'
      )
    ]) {
      writeFileSync(filePath, damaged);
      expect(runToolInventory({ mode: 'check', filePath, tools: TOOLS }).ok).toBe(false);
      expect(readFileSync(filePath, 'utf8')).toBe(damaged);
    }
  });
});
