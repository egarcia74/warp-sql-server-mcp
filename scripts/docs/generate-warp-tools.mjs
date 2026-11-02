#!/usr/bin/env node
/** Keep WARP.md's tool inventory in sync with the live MCP registry. */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getAllTools } from '../../lib/tools/tool-registry.js';
import { stripFencedBlocks, stripHtmlComments, stripRawTextHtml } from './markdown-blocks.mjs';

const HEADING = '### MCP Tools Available';
const START = '<!-- BEGIN GENERATED MCP TOOLS -->';
const END = '<!-- END GENERATED MCP TOOLS -->';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function renderToolInventory(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('The MCP registry must contain at least one tool.');
  }

  const names = tools.map(tool => tool?.name);
  if (names.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name))) {
    throw new Error('MCP tool names must be safe Markdown link fragments.');
  }
  if (new Set(names).size !== names.length) {
    throw new Error('The MCP registry contains duplicate tool names.');
  }

  return names.map(name => `- [\`${name}\`](docs/tools.html#${name})`).join('\n') + '\n';
}

export function replaceToolInventory(markdown, tools) {
  if (markdown.includes('\r')) {
    throw new Error('WARP.md must use LF line endings before generating the tool inventory.');
  }

  const lines = markdown.split('\n');
  const positions = line => lines.flatMap((value, index) => (value === line ? [index] : []));
  const headings = positions(HEADING);
  const starts = positions(START);
  const ends = positions(END);

  // Markers are comments, but their owning heading must be visible prose. A complete
  // fake section inside a code fence or raw HTML block must never satisfy the gate.
  const visible = stripHtmlComments(stripRawTextHtml(stripFencedBlocks(markdown)));
  const visibleHeadings = visible.split('\n').filter(line => line === HEADING);

  if (
    headings.length !== 1 ||
    visibleHeadings.length !== 1 ||
    starts.length !== 1 ||
    ends.length !== 1
  ) {
    throw new Error('WARP.md must have one MCP tools heading and one generated marker pair.');
  }
  const [heading] = headings;
  const [start] = starts;
  const [end] = ends;
  if (lines[heading + 1] !== '' || start !== heading + 2 || end <= start) {
    throw new Error('Generated MCP tool markers are missing, reversed, or displaced.');
  }
  if (lines.slice(start + 1, end).some(line => /^#{1,6}\s/.test(line))) {
    throw new Error('The generated MCP tool block must end before the next heading.');
  }
  if (lines[end + 1] !== '' || !/^#{1,6}\s/.test(lines[end + 2] ?? '')) {
    throw new Error('The generated MCP tool block must end before the next section.');
  }

  const inventoryLines = renderToolInventory(tools).trimEnd().split('\n');
  return [...lines.slice(0, start + 1), '', ...inventoryLines, '', ...lines.slice(end)].join('\n');
}

export function runToolInventory({ mode, filePath, tools = getAllTools() }) {
  if (mode !== 'write' && mode !== 'check') throw new Error(`Unknown mode: ${mode}`);
  const current = readFileSync(filePath, 'utf8');
  const expected = replaceToolInventory(current, tools);
  const changed = current !== expected;
  if (mode === 'write' && changed) writeFileSync(filePath, expected);
  return { ok: !changed, changed };
}

function main() {
  let mode = null;
  if (process.argv.length === 2) {
    mode = 'write';
  } else if (process.argv.length === 3 && process.argv[2] === '--check') {
    mode = 'check';
  }
  if (mode === null) {
    console.error('Usage: node scripts/docs/generate-warp-tools.mjs [--check]');
    process.exitCode = 2;
    return;
  }

  try {
    const result = runToolInventory({ mode, filePath: path.join(repoRoot, 'WARP.md') });
    if (mode === 'check' && !result.ok) {
      console.error('::error::WARP.md tool inventory differs from the MCP registry.');
      console.error('Regenerate with: npm run docs:generate-warp-tools');
      process.exitCode = 1;
    } else {
      console.log(
        result.changed
          ? 'Updated WARP.md MCP tool inventory.'
          : 'WARP.md MCP tool inventory is current.'
      );
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
