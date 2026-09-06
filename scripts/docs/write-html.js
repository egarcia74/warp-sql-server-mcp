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
