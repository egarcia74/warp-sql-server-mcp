#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import MarkdownIt from 'markdown-it';
import { applyFixes } from 'markdownlint';
import { lint } from 'markdownlint/sync';
import { globSync } from 'tinyglobby';

const config = JSON.parse(fs.readFileSync('.markdownlint.json', 'utf8'));
const ignores = ignore();
if (fs.existsSync('.markdownlintignore')) {
  ignores.add(fs.readFileSync('.markdownlintignore', 'utf8'));
}

const arguments_ = process.argv.slice(2);
const fix = arguments_[0] === '--fix';
const paths = fix ? arguments_.slice(1) : arguments_;
const inputs = paths.length ? paths : ['**/*.md'];
const files = [
  ...new Set(
    inputs.flatMap(input => {
      if (fs.existsSync(input) && fs.statSync(input).isFile()) return [input];
      return globSync(input, { dot: true, onlyFiles: true, expandDirectories: false });
    })
  )
].filter(file => {
  const relative = path.relative(process.cwd(), file).split(path.sep).join('/');
  return relative && !relative.startsWith('../') && !ignores.ignores(relative);
});

const lintOptions = {
  config,
  files,
  markdownItFactory: () => new MarkdownIt({ html: true })
};

if (fix) {
  for (const file of files) {
    const fixes = lint({ ...lintOptions, files: [file] })[file].filter(issue => issue.fixInfo);
    if (fixes.length === 0) continue;
    const original = fs.readFileSync(file, 'utf8');
    const updated = applyFixes(original, fixes);
    if (updated !== original) fs.writeFileSync(file, updated);
  }
}

const results = lint(lintOptions);
let issueCount = 0;
for (const [file, issues] of Object.entries(results)) {
  for (const issue of issues) {
    process.stdout.write(
      `${file}:${issue.lineNumber} ${issue.ruleNames.join('/')} ${issue.ruleDescription}\n`
    );
    issueCount += 1;
  }
}
if (issueCount) process.exitCode = 1;
