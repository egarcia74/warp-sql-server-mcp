import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Validate report data without trusting source paths supplied by LCOV. */
export function validateLcov(reportText, trackedFiles) {
  if (typeof reportText !== 'string' || !reportText.trim()) {
    throw new Error('Missing or empty LCOV report');
  }

  const sourcePaths = [];
  let currentSource;
  let hasLines = false;
  let hasBranches = false;
  for (const line of reportText.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      if (currentSource) throw new Error('LCOV record missing end_of_record');
      const path = line.slice(3);
      if (
        !path ||
        /[\\:]/.test(path) ||
        [...path].some(
          character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ) ||
        path.startsWith('/') ||
        path.split('/').some(part => !part || part === '.' || part === '..') ||
        !trackedFiles.has(path)
      ) {
        throw new Error(`Unsafe or untracked LCOV source path: ${path}`);
      }
      currentSource = path;
      hasLines = false;
      sourcePaths.push(path);
    } else if (line.startsWith('DA:')) {
      if (!currentSource || !/^DA:[1-9]\d*,\d+(?:,[a-fA-F0-9]+)?$/.test(line)) {
        throw new Error('Invalid LCOV line coverage');
      }
      hasLines = true;
    } else if (line.startsWith('BRDA:')) {
      if (!currentSource || !/^BRDA:[1-9]\d*,\d+,\d+,(?:\d+|-)$/.test(line)) {
        throw new Error('Invalid LCOV branch coverage');
      }
      hasBranches = true;
    } else if (line === 'end_of_record') {
      if (!currentSource || !hasLines) throw new Error('LCOV source record missing line coverage');
      currentSource = undefined;
    } else if (line.startsWith('TN:')) {
      if (currentSource) throw new Error('LCOV test name must precede a source record');
    } else if (line.startsWith('FN:')) {
      if (!currentSource || !/^FN:[1-9]\d*(?:,[1-9]\d*)?,.+$/.test(line)) {
        throw new Error('Invalid LCOV function definition');
      }
    } else if (line.startsWith('FNDA:')) {
      if (!currentSource || !/^FNDA:\d+,.+$/.test(line)) {
        throw new Error('Invalid LCOV function coverage');
      }
    } else if (/^(?:FNF|FNH|LF|LH|BRF|BRH):\d+$/.test(line)) {
      if (!currentSource) throw new Error('LCOV source metadata outside a source record');
    } else if (line !== '') {
      throw new Error(`Unknown or malformed LCOV line: ${line}`);
    }
  }

  if (currentSource) throw new Error('LCOV record missing end_of_record');
  if (!sourcePaths.includes('index.js')) throw new Error('LCOV missing index.js source');
  if (!sourcePaths.some(path => path.startsWith('lib/'))) {
    throw new Error('LCOV missing lib/ sources');
  }
  if (!hasBranches) throw new Error('LCOV missing branch coverage');

  return {
    sourcePaths: [...new Set(sourcePaths)],
    sha256: createHash('sha256').update(reportText).digest('hex')
  };
}

function validateSourceFiles(sourcePaths, root) {
  const canonicalRoot = realpathSync(root);
  for (const path of sourcePaths) {
    let component = root;
    for (const part of path.split('/')) {
      component = resolve(component, part);
      if (lstatSync(component).isSymbolicLink()) {
        throw new Error(`Symlinked LCOV source path: ${path}`);
      }
    }
    const canonical = realpathSync(component);
    if (!canonical.startsWith(canonicalRoot + sep) || !lstatSync(component).isFile()) {
      throw new Error(`LCOV source path is not a regular file within checkout: ${path}`);
    }
  }
}

function main(argv) {
  try {
    if (argv.length !== 2 || argv[0] !== 'validate' || !argv[1]) {
      throw new Error('usage: node scripts/ci/sonar-lcov.mjs validate coverage/lcov.info');
    }
    const root = process.cwd();
    const trackedFiles = new Set(
      execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
    );
    const result = validateLcov(readFileSync(resolve(root, argv[1]), 'utf8'), trackedFiles);
    validateSourceFiles(result.sourcePaths, root);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`sonar-lcov: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
