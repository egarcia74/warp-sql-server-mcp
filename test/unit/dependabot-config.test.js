import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

function extractGroupPatterns(config, groupName) {
  const lines = config.split(/\r?\n/);
  const patterns = [];
  let groupIndent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (trimmed === `${groupName}:`) {
      groupIndent = indent;
      continue;
    }

    if (groupIndent === null) {
      continue;
    }

    if (trimmed && indent <= groupIndent) {
      break;
    }

    const listItem = trimmed.match(/^-\s+["']?([^"']+?)["']?$/);
    if (listItem?.[1].startsWith('github/codeql-action')) {
      patterns.push(listItem[1]);
    }
  }

  return patterns;
}

function matchesDependabotPattern(pattern, dependency) {
  const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');

  return new RegExp(`^${expression}$`).test(dependency);
}

async function readCodeqlActions(repositoryRoot) {
  const workflowsDirectory = path.join(repositoryRoot, '.github', 'workflows');
  const workflowFiles = (await fs.readdir(workflowsDirectory)).filter(
    file => file.endsWith('.yml') || file.endsWith('.yaml')
  );
  const actions = [];

  for (const workflowFile of workflowFiles) {
    const workflow = await fs.readFile(path.join(workflowsDirectory, workflowFile), 'utf8');
    for (const match of workflow.matchAll(/uses:\s*github\/codeql-action\/([^@\s]+)@([^\s#]+)/g)) {
      actions.push({ dependency: `github/codeql-action/${match[1]}`, ref: match[2] });
    }
  }

  return actions;
}

describe('Dependabot GitHub Actions grouping', () => {
  test('groups every CodeQL workflow action into the security update', async () => {
    const repositoryRoot = process.cwd();
    const codeqlActions = await readCodeqlActions(repositoryRoot);
    const codeqlDependencies = new Set(codeqlActions.map(action => action.dependency));

    const dependabotConfig = await fs.readFile(
      path.join(repositoryRoot, '.github', 'dependabot.yml'),
      'utf8'
    );
    const securityPatterns = extractGroupPatterns(dependabotConfig, 'security-actions');
    const ungroupedDependencies = [...codeqlDependencies].filter(
      dependency => !securityPatterns.some(pattern => matchesDependabotPattern(pattern, dependency))
    );

    expect(codeqlDependencies.size).toBeGreaterThan(0);
    expect(ungroupedDependencies).toEqual([]);
  });

  test('pins every CodeQL workflow action to the same ref', async () => {
    const codeqlActions = await readCodeqlActions(process.cwd());
    const codeqlRefs = new Set(codeqlActions.map(action => action.ref));

    expect(codeqlActions.length).toBeGreaterThan(0);
    expect(codeqlRefs.size).toBe(1);
  });
});
