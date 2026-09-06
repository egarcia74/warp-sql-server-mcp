#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import prettier from 'prettier';

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
 * Codacy flags the two writeFileSync calls below (ESLint8_security_detect-
 * non-literal-fs-filename) and the html-named arguments (ESLint8_xss_no-mixed-
 * html). Both are false positives here, and neither is new risk: the identical
 * `fs.writeFileSync(path.join(docsDir, 'tools.html'), html)` lived in both
 * generators before this helper existed, and was not flagged only because
 * Codacy scores new code. Specifically:
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
 * @param {string} fileName - File name to write inside docs/, e.g. 'tools.html'.
 * @param {string} html - The generated markup.
 * @param {string} label - Human-readable name used in the log line.
 */
export async function writeDocsHtml(fileName, html, label) {
  const docsDir = 'docs';
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outPath = path.join(docsDir, fileName);
  fs.writeFileSync(outPath, html);

  try {
    const options = await prettier.resolveConfig(outPath);
    const formatted = await prettier.format(html, { ...options, filepath: outPath });
    fs.writeFileSync(outPath, formatted);
    console.log(`✅ ${label} generated and formatted: ${outPath}`);
  } catch (formatError) {
    console.log(`✅ ${label} generated: ${outPath} (formatting skipped: ${formatError.message})`);
  }
}
