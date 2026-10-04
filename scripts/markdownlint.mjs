#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import ignore from 'ignore';
import MarkdownIt from 'markdown-it';
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
const inputs = paths.length
  ? paths
  : globSync('**/*.md', { dot: true, onlyFiles: true, expandDirectories: false });
const files = [...new Set(inputs)].filter(file => {
  const relative = path.relative(process.cwd(), file).split(path.sep).join('/');
  return relative && !relative.startsWith('../') && !ignores.ignores(relative);
});

const lintOptions = {
  config,
  files,
  markdownItFactory: () => new MarkdownIt({ html: true })
};

if (fix) {
  if (fs.existsSync('/etc/markdownlintrc') || fs.existsSync('/etc/markdownlint/config')) {
    throw new Error('Cannot isolate markdownlint from a system-wide configuration');
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith('markdownlint_'))
  );
  environment.HOME = '';
  environment.USERPROFILE = '';
  const isolatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wssm-markdownlint-'));
  let result;
  try {
    for (let directory = isolatedDirectory; ; directory = path.dirname(directory)) {
      if (fs.existsSync(path.join(directory, '.markdownlintrc'))) {
        throw new Error('Cannot isolate markdownlint from a parent-directory configuration');
      }
      if (directory === path.dirname(directory)) break;
    }
    result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/markdownlint-cli/markdownlint.js', import.meta.url)),
        '--dot',
        '--fix',
        '--config',
        path.resolve('.markdownlint.json'),
        '--',
        ...files.map(file => path.resolve(file))
      ],
      { cwd: isolatedDirectory, env: environment, stdio: 'inherit' }
    );
  } finally {
    fs.rmdirSync(isolatedDirectory);
  }
  if (result.error) throw result.error;
  if (result.status === null || result.status > 1) process.exitCode = result.status || 2;
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
