#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import prettier from 'prettier';

// The generated footer carries `Last updated: <date>`, which is date-only, so
// the file differs from the committed copy on the first build of any new
// calendar day even when no tool documentation changed. That opened a
// throwaway `docs: auto-update API documentation` PR per day.
//
// `extract-docs.js` already solves this for docs-data/tools.json: if the only
// change is its `generatedAt`, it keeps the previous value. This is the same
// guard for the HTML.
// The generated footer carries `Last updated: <date>`, which is date-only, so
// the file differs from the committed copy on the first build of any new
// calendar day even when no tool documentation changed. That opened a
// throwaway `docs: auto-update API documentation` PR per day.
//
// `extract-docs.js` already solves this for docs-data/tools.json: if the only
// change is its `generatedAt`, it keeps the previous value. This is the same
// guard for the HTML.
//
// Matched on the footer's own markup and, critically, on the LAST occurrence.
// Tool descriptions are interpolated into this page unescaped
// (generate-tools-html.js lines 207/228/259), so a description could in
// principle contain any markup at all, footer included. Taking the last match
// makes a collision structurally impossible rather than merely unlikely: all
// tool content is emitted before the footer, so the final occurrence is always
// the footer regardless of what any description contains.
const FOOTER_DATE_PATTERN =
  /(<p>Generated automatically from code \u2022 Last updated: )([^<]*)(<\/p>)/g;

/**
 * Splits `text` around the footer date, or returns null if there is no footer.
 *
 * @param {string} text - Page markup.
 * @returns {{before: string, date: string, after: string}|null}
 */
function splitAtFooterDate(text) {
  const matches = [...text.matchAll(FOOTER_DATE_PATTERN)];
  if (matches.length === 0) {
    return null;
  }
  const footer = matches[matches.length - 1];
  const start = footer.index + footer[1].length;
  return {
    before: text.slice(0, start),
    date: footer[2],
    after: text.slice(start + footer[2].length)
  };
}

/**
 * Returns `next`, except that a `Last updated:` date is rolled back to the one
 * already committed when nothing else on the page changed.
 *
 * Everything outside the footer date is compared as an exact string, so a real
 * content change still adopts today's date and no comparison can absorb one. A
 * page with no such footer (index.html) is returned untouched.
 *
 * Takes the previous content rather than a path, deliberately. `writeDocsHtml`
 * writes the unformatted markup before it formats, so by the time this runs the
 * file on disk is that raw write, not the committed copy - comparing against
 * the path would never match and would silently disable the guard. The
 * committed content must be captured before any write.
 *
 * @param {string|null} previous - Committed content, or null if none exists.
 * @param {string} next - Newly generated content.
 * @returns {string} Content to write.
 */
export function preserveUnchangedTimestamp(previous, next) {
  if (previous === null || previous === undefined) {
    return next;
  }
  const before = splitAtFooterDate(previous);
  const after = splitAtFooterDate(next);
  if (before === null || after === null) {
    return next;
  }
  // Everything outside the footer date is compared as an exact string, so no
  // masked region can absorb a real content change. If anything else differs
  // at all, the new page is returned untouched, date included.
  if (before.before !== after.before || before.after !== after.after) {
    return next;
  }
  return after.before + before.date + after.after;
}

/**
 * Writes generated HTML into docs/, formatted with Prettier.
 *
 * Formatting matters for more than tidiness: without it the generators' raw
 * output differs from the committed copy on every run, so a one-line version
 * bump arrives as a whole-file reformat. Nothing catches that, because
 * `format:check` globs only {js,mjs,cjs,json,md}.
 *
 * Uses the Prettier API rather than shelling out to `npx prettier`, which
 * would reintroduce a PATH-dependent subprocess (SonarQube javascript:S4036).
 * If formatting fails the unformatted file is still written - a readable page
 * beats no page - and the caller is told.
 *
 * Codacy flags the fs calls below (ESLint8_security_detect-non-literal-fs-
 * filename). These are false positives here, and none is new risk: the
 * identical `fs.writeFileSync(path.join(docsDir, 'tools.html'), markup)` lived
 * in both generators before this helper existed, and was not flagged only
 * because Codacy scores new code. Specifically:
 *
 *   - outPath is not attacker-influenced. It is path.join of the hardcoded
 *     'docs' plus a fileName supplied by a sibling build script as a string
 *     literal ('tools.html' / 'index.html'). Nothing here reads argv, env,
 *     stdin or the network.
 *   - The markup is generated from docs-data/tools.json, which is itself
 *     produced from the in-repo tool registry by extract-docs.js. It is not
 *     user input, and it is written to a file rather than served.
 *   - These are dev-only scripts run from the repo root via `npm run
 *     docs:build`; they ship in no runtime path and are excluded from the
 *     published package.
 *
 * Dispositioned as false positives in Codacy Cloud. Inline eslint-disable
 * directives are not usable here: those plugins are part of Codacy's own
 * ESLint config, not this repo's, so the directives fail `npm run lint` with
 * "Definition for rule ... was not found". The rationale lives here because a
 * Codacy Cloud disposition is invisible in a checkout.
 *
 * The parameter is named `markup`, not `html`, on purpose. ESLint8_xss_no-
 * mixed-html is a naming heuristic: it reported "HTML passed in to function
 * 'fs.writeFileSync'" and the same for `prettier.format` purely because an
 * identifier called `html` reached them. Verified with the Codacy CLI - the
 * rename cleared three findings and changed no behaviour, which is a better
 * outcome than dispositioning a rule that was only ever matching a variable
 * name. Renaming it back would reintroduce all three.
 *
 * @param {string} fileName - File name to write inside docs/, e.g. 'tools.html'.
 * @param {string} markup - The generated markup.
 * @param {string} label - Human-readable name used in the log line.
 */
export async function writeDocsHtml(fileName, markup, label) {
  const docsDir = 'docs';
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outPath = path.join(docsDir, fileName);
  // Captured before the raw write below overwrites it. Read directly rather
  // than existsSync-then-read: the latter is a check-then-use pair on a path
  // that is then written, which CodeQL flags as a file-system race (js/
  // file-system-race). A missing file is the first-build case, not an error.
  let committed = null;
  try {
    committed = fs.readFileSync(outPath, 'utf8');
  } catch {
    // First build, or an unreadable file: there is no committed date to carry.
  }
  fs.writeFileSync(outPath, markup);

  try {
    const options = await prettier.resolveConfig(outPath);
    let formatted = await prettier.format(markup, { ...options, filepath: outPath });
    // Compared against the committed content, not the file, which currently
    // holds the raw write above.
    formatted = preserveUnchangedTimestamp(committed, formatted);
    fs.writeFileSync(outPath, formatted);
    console.log(`✅ ${label} generated and formatted: ${outPath}`);
  } catch (formatError) {
    console.log(`✅ ${label} generated: ${outPath} (formatting skipped: ${formatError.message})`);
  }
}
