/**
 * Reading and matching a workflow's `on.<trigger>.paths` filters.
 *
 * Extracted from `check-env-var-docs.test.js` so that suite stays under the repository's
 * per-file size limit, and because two assertions there now need the same matcher.
 */

/**
 * The quoted entries of one trigger's `paths:` list.
 *
 * Parsed per trigger rather than as one flat union of every `paths:` in the file. `push`
 * and `pull_request` are independent filters, and flattening them hides the asymmetry that
 * matters most: a source path added to `push` only still satisfies a union-based assertion
 * while pull requests touching that path never launch the gate - which is precisely the
 * context the drift guard exists for, since the gate's job is to block a merge.
 *
 * @param {string} yaml the workflow file's contents
 * @param {string} trigger `push` or `pull_request`
 * @returns {string[]} the path-filter patterns, in file order
 */
export function parsePathFilters(yaml, trigger) {
  const onBlock = yaml.slice(0, yaml.indexOf('\njobs:'));
  const lines = onBlock.split('\n');

  const start = lines.indexOf(`  ${trigger}:`);
  if (start === -1) return [];

  const found = [];
  let inPaths = false;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}\S/.test(line)) break; // the next trigger, so this one is done

    if (/^ {4}paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      inPaths = false; // a sibling key such as `branches:`
      continue;
    }
    if (!inPaths) continue;

    const item = /^ {6}-\s+'([^']+)'\s*$/.exec(line);
    if (item) found.push(item[1]); // comment lines simply do not match
  }

  return found;
}

/**
 * A path-filter pattern as the pieces it is made of: literal text, `*` (which never
 * crosses a `/`), and `**` (which does).
 */
export function tokenise(pattern) {
  const tokens = [];
  let literal = '';

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '*') {
      literal += pattern[i];
      continue;
    }
    if (literal !== '') {
      tokens.push({ literal });
      literal = '';
    }
    if (pattern[i + 1] === '*') {
      tokens.push({ wildcard: 'globstar' });
      i++;
    } else {
      tokens.push({ wildcard: 'star' });
    }
  }
  if (literal !== '') tokens.push({ literal });

  return tokens;
}

/**
 * GitHub's path-filter globbing, spelled out rather than translated into a regular
 * expression: a `RegExp` built from a non-literal pattern is a static-analysis finding
 * (Semgrep's non-literal-regexp DoS rule), and matching the tokens directly says what a
 * glob means here more plainly than an escaped translation of it would.
 *
 * Backtracking is fine at this size - the patterns are a handful of characters and the
 * candidates are repository paths.
 */
export function matchTokens(tokens, file) {
  if (tokens.length === 0) return file === '';

  const [head, ...rest] = tokens;
  if (head.literal !== undefined) {
    return file.startsWith(head.literal) && matchTokens(rest, file.slice(head.literal.length));
  }

  for (let taken = 0; taken <= file.length; taken++) {
    // `*` stops at a segment boundary; `**` keeps going through it.
    if (head.wildcard === 'star' && file.slice(0, taken).includes('/')) break;
    if (matchTokens(rest, file.slice(taken))) return true;
  }
  return false;
}

/** True when a GitHub path filter covers a repo-relative file path. */
export const filterMatches = (pattern, file) => matchTokens(tokenise(pattern), file);

/**
 * True when a GitHub `paths` list covers a file.
 *
 * Evaluated in order with the last match winning, because a `paths` list may carry `!`
 * negations and GitHub resolves them positionally: `['lib/**', '!lib/internal/**']` does not
 * trigger for `lib/internal/a.js`. Treating any positive match as coverage would report the
 * workflow as watching a path it actually excludes - which is the wrong direction for a
 * drift guard, since it would quietly assert coverage that does not exist.
 */
export const isCovered = (filters, file) => {
  let covered = false;
  for (const pattern of filters) {
    const negated = pattern.startsWith('!');
    if (filterMatches(negated ? pattern.slice(1) : pattern, file)) covered = !negated;
  }
  return covered;
};

/** The files a set of filters does NOT cover, which is what an assertion wants to be empty. */
export const uncoveredBy = (filters, files) => files.filter(file => !isCovered(filters, file));
