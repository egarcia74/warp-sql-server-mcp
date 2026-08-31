#!/usr/bin/env node
/**
 * Fails when a Markdown code fence swallows the document after it.
 *
 * Why this exists: three separate regions of this repo's documentation were
 * invisible for months because a fence was opened and never closed at the same
 * backtick length. WARP.md hid 864 lines, docs/SMOKE-TEST-GUIDE.md hid 220, and
 * a second WARP.md instance hid a smaller region. Every one had a *balanced*
 * fence count, so markdownlint, prettier and the link checker all passed. All
 * three were found by eye.
 *
 * Detection is by block size, not by content. Measured across this repository,
 * the largest legitimate fenced block is 69 lines (test/README.md); the two
 * known defects were 220 and 864. MAX_BLOCK_LINES sits between those with room
 * on both sides, which keeps false positives at zero without needing the
 * exemptions a heading-based rule would require - a `## heading` inside a
 * ```markdown sample or a quoted shell string is perfectly legal, and a rule
 * that flags those gets muted within a week.
 *
 * Fences are parsed per CommonMark: a fence closes only on a run of the same
 * character at least as long as the opener, with no info string.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MAX_BLOCK_LINES = 120;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Returns { unclosed: [...], oversized: [...] } for one file's contents. */
export function scanMarkdown(text) {
  const lines = text.split('\n');
  const unclosed = [];
  const oversized = [];
  let open = null; // { line, char, len }

  lines.forEach((line, i) => {
    const m = FENCE.exec(line);
    if (!m) return;
    const marker = m[1];
    const char = marker[0];
    const info = m[2].trim();

    if (open === null) {
      // An opening fence may carry an info string; a backtick one may not contain a backtick.
      if (char === '`' && info.includes('`')) return;
      open = { line: i + 1, char, len: marker.length };
      return;
    }

    // Only a run of the same character, at least as long, with no info string, closes it.
    if (char === open.char && marker.length >= open.len && info === '') {
      const span = i + 1 - open.line;
      if (span > MAX_BLOCK_LINES) {
        oversized.push({ start: open.line, end: i + 1, span });
      }
      open = null;
    }
  });

  if (open !== null) unclosed.push({ start: open.line, end: lines.length });
  return { unclosed, oversized };
}

function trackedMarkdown() {
  return execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : trackedMarkdown();
  let failures = 0;

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      // A file this check cannot read is a file it cannot vouch for, so fail
      // rather than skipping quietly - a gate that reports clean on what it
      // never inspected is the failure mode this script exists to prevent.
      console.error(`${file}: could not read - ${error.message}`);
      failures++;
      continue;
    }
    const { unclosed, oversized } = scanMarkdown(text);

    for (const u of unclosed) {
      console.error(
        `${file}:${u.start} unclosed code fence - swallows to end of file (line ${u.end})`
      );
      failures++;
    }
    for (const o of oversized) {
      console.error(
        `${file}:${o.start} code fence spans ${o.span} lines (limit ${MAX_BLOCK_LINES}), closing at line ${o.end} - ` +
          'a block this large usually means a fence was opened and not closed at the same length'
      );
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} problem(s) found across ${files.length} file(s).`);
    process.exit(1);
  }
  console.log(`Fenced-block check: ${files.length} file(s) clean.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
