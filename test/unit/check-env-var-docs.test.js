import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AMBIENT_VARS,
  ENV_VARS_DOC,
  maskNonCode,
  readEnvVarsFromSource,
  readDocumentedEnvVars,
  compareEnvVarDocs,
  shippedJsFiles,
  checkEnvVarDocs,
  formatReport
} from '../../scripts/docs/check-env-var-docs.mjs';

/** A throwaway package tree, for the half that reads package.json and walks files. */
function withTempPackage(build) {
  const root = mkdtempSync(join(tmpdir(), 'env-var-docs-'));
  try {
    return build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const write = (root, relative, content) => {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
};

describe('readEnvVarsFromSource', () => {
  it('finds dotted and bracketed reads', () => {
    const found = readEnvVarsFromSource(
      [
        "const host = process.env.SQL_SERVER_HOST || 'localhost';",
        "if (process.env['SQL_SERVER_DEBUG'] === 'true') {}",
        'const max = process.env["SQL_SERVER_POOL_MAX"];'
      ].join('\n')
    );

    expect([...found].sort()).toEqual([
      'SQL_SERVER_DEBUG',
      'SQL_SERVER_HOST',
      'SQL_SERVER_POOL_MAX'
    ]);
  });

  it('finds a variable read only once, anywhere in the file', () => {
    expect([...readEnvVarsFromSource('x = process.env.ONLY_ONCE;')]).toEqual(['ONLY_ONCE']);
  });

  it('does not match a computed read, which is the documented blind spot', () => {
    // cli.js does exactly this over the keys of ~/.warp-sql-server-mcp.json.
    expect([...readEnvVarsFromSource('if (!process.env[key]) process.env[key] = value;')]).toEqual(
      []
    );
  });

  it('does not match destructuring, the other documented blind spot', () => {
    expect([...readEnvVarsFromSource('const { SOME_VAR } = process.env;')]).toEqual([]);
  });

  // Regression: matching inside comments made the gate demand an ENV-VARS.md entry for a
  // variable nothing reads. The cheapest way to silence that is a bogus entry, so the
  // check would have corrupted the very document it protects.
  it('ignores a mention inside a line comment', () => {
    const source = [
      '// SQL_SERVER_LEGACY was removed; we no longer read process.env.SQL_SERVER_LEGACY',
      'const host = process.env.SQL_SERVER_HOST;'
    ].join('\n');

    expect([...readEnvVarsFromSource(source)]).toEqual(['SQL_SERVER_HOST']);
  });

  it('ignores a mention inside a block comment, including a JSDoc example', () => {
    const source = [
      '/**',
      ' * Reads process.env.DOC_ONLY_VAR in the example below.',
      ' * @example process.env.ANOTHER_DOC_VAR',
      ' */',
      'const real = process.env.REAL_VAR;'
    ].join('\n');

    expect([...readEnvVarsFromSource(source)]).toEqual(['REAL_VAR']);
  });

  it('ignores a mention inside a string or template literal', () => {
    const source = [
      'const help = "set process.env.HELP_TEXT_VAR to configure";',
      "const single = 'process.env.SINGLE_QUOTED_VAR';",
      'const tpl = `process.env.TEMPLATE_VAR`;',
      'const real = process.env.REAL_VAR;'
    ].join('\n');

    expect([...readEnvVarsFromSource(source)]).toEqual(['REAL_VAR']);
  });

  it('still reads the bracket form, whose name legitimately lives inside a string', () => {
    const source = [
      '// not this one: process.env["COMMENTED_BRACKET"]',
      "const a = process.env['BRACKET_VAR'];",
      'const b = process.env["OTHER_BRACKET_VAR"];'
    ].join('\n');

    expect([...readEnvVarsFromSource(source)].sort()).toEqual(['BRACKET_VAR', 'OTHER_BRACKET_VAR']);
  });

  it('is not fooled by an apostrophe inside a comment', () => {
    const source = [
      "// don't read process.env.COMMENTED_VAR here",
      'const real = process.env.REAL_VAR;'
    ].join('\n');

    expect([...readEnvVarsFromSource(source)]).toEqual(['REAL_VAR']);
  });

  it('handles an escaped quote inside a string without losing the following code', () => {
    const source = [
      'const s = "a \\" process.env.INSIDE";',
      'const real = process.env.AFTER;'
    ].join('\n');

    expect([...readEnvVarsFromSource(source)]).toEqual(['AFTER']);
  });
});

describe('readEnvVarsFromSource, on the shapes that used to fool it', () => {
  // Regression: `[...source]` indexed by code POINT while every offset was a code UNIT,
  // so each blanked span drifted left of its target by one per astral character. At
  // twelve emoji the drift was wide enough to blank the real read instead of the comment,
  // and the scan returned nothing at all while reporting "in sync".
  it('neither loses a real read nor leaks a commented one after astral characters', () => {
    const source = [
      `const banner = "${'🎉'.repeat(12)}";`,
      '// removed: process.env.GHOST',
      'const r = process.env.REAL;'
    ].join('\n');

    expect([...readEnvVarsFromSource(source)]).toEqual(['REAL']);
  });

  // Regression: a template literal was masked like a plain string, so the executable
  // `${...}` inside it was blanked and a real read disappeared.
  it('reads a variable used inside a template substitution', () => {
    const source = 'const url = `${process.env.NEW_SETTING}/path`;';
    expect([...readEnvVarsFromSource(source)]).toEqual(['NEW_SETTING']);
  });

  it('still masks the literal text of a template literal', () => {
    const source = 'const help = `set process.env.NOT_A_READ to configure`;';
    expect([...readEnvVarsFromSource(source)]).toEqual([]);
  });

  it('handles nested braces inside a substitution', () => {
    const source = 'const v = `${ { a: process.env.NESTED }.a }`;';
    expect([...readEnvVarsFromSource(source)]).toEqual(['NESTED']);
  });

  it('handles several substitutions in one template', () => {
    const source = 'const dsn = `${process.env.HOST_A}:${process.env.PORT_B}/x`;';
    expect([...readEnvVarsFromSource(source)].sort()).toEqual(['HOST_A', 'PORT_B']);
  });

  // Regression: an assignment is this program's output, not a user-supplied setting, so
  // demanding an ENV-VARS.md entry for it would document a knob that does not exist.
  it('ignores a plain assignment to process.env', () => {
    expect([...readEnvVarsFromSource('process.env.CHILD_FLAG = "1";')]).toEqual([]);
    expect([...readEnvVarsFromSource('process.env.SPACED   =   "1";')]).toEqual([]);
  });

  it('still counts comparisons, which only look like assignments', () => {
    expect([...readEnvVarsFromSource('if (process.env.A === "x") {}')]).toEqual(['A']);
    expect([...readEnvVarsFromSource('if (process.env.B == "x") {}')]).toEqual(['B']);
  });

  it('still counts compound assignments, which read before they write', () => {
    const source = 'process.env.C ||= "d"; process.env.E += "f"; process.env.G ??= "h";';
    expect([...readEnvVarsFromSource(source)].sort()).toEqual(['C', 'E', 'G']);
  });

  it('still counts a read in an arrow function body', () => {
    expect([...readEnvVarsFromSource('const f = () => process.env.D;')]).toEqual(['D']);
  });

  // Regression: the assignment exclusion was wired into the dotted-form loop only, so
  // `process.env['X'] = '1'` still counted as a read - the exact class of bug the dotted
  // fix closed, left open on the other spelling. Latent when found (no shipped file writes
  // a bracket-form literal), but an asymmetry between two scanners of the same thing is
  // how they drift apart.
  it('ignores a plain assignment in the bracket form too', () => {
    expect([...readEnvVarsFromSource("process.env['CHILD_FLAG'] = '1';")]).toEqual([]);
    expect([...readEnvVarsFromSource('process.env["SPACED"]   =   "1";')]).toEqual([]);
  });

  it('still counts bracket-form reads, comparisons and compound assignments', () => {
    expect([...readEnvVarsFromSource("const x = process.env['REAL_READ'];")]).toEqual([
      'REAL_READ'
    ]);
    expect([...readEnvVarsFromSource("if (process.env['E'] === 'x') {}")]).toEqual(['E']);
    expect([...readEnvVarsFromSource("process.env['C'] ||= 'd';")]).toEqual(['C']);
    expect([...readEnvVarsFromSource("const f = () => process.env['F'];")]).toEqual(['F']);
  });
});

describe('maskNonCode', () => {
  it('preserves length and newlines so offsets and line numbers still line up', () => {
    const source = ['// comment', 'const a = "text";', '/* block */'].join('\n');
    const masked = maskNonCode(source);

    expect(masked).toHaveLength(source.length);
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
  });

  it('keeps string delimiters so a bracket access stays recognisable', () => {
    expect(maskNonCode("process.env['NAME']")).toBe("process.env['    ']");
  });

  it('leaves ordinary code untouched', () => {
    const code = 'const x = process.env.FOO || 1;';
    expect(maskNonCode(code)).toBe(code);
  });

  it('preserves length in UTF-16 code units, astral characters included', () => {
    const source = 'const a = "🎉🎉🎉"; const b = `x${1}`;';
    expect(maskNonCode(source)).toHaveLength(source.length);
  });
});

describe('readDocumentedEnvVars', () => {
  it('takes variables from headings only', () => {
    const markdown = [
      '# Environment Variables Reference',
      '',
      '### `SQL_SERVER_HOST`',
      '',
      '- **Description**: set `CORP` here, and see `SQL_SERVER_PORT` below',
      '',
      '### `SQL_SERVER_PORT`',
      '',
      'body'
    ].join('\n');

    // `CORP` is a value and `SQL_SERVER_PORT` is cross-referenced in prose; neither
    // spelling should count as a definition, only the heading should.
    expect([...readDocumentedEnvVars(markdown)].sort()).toEqual([
      'SQL_SERVER_HOST',
      'SQL_SERVER_PORT'
    ]);
  });

  it('ignores a lower-case or non-variable heading', () => {
    const markdown = ['### `npm run logs`', '', '## Overview', ''].join('\n');
    expect([...readDocumentedEnvVars(markdown)]).toEqual([]);
  });

  // Regression: a heading-shaped line inside a fence renders as nothing, so counting it
  // let a shipped read satisfy the gate against documentation no reader can see - the
  // precise failure this check exists to prevent.
  it('ignores a heading-shaped line inside a fenced block', () => {
    const markdown = ['### `REAL_VAR`', '', '```markdown', '### `FENCED_VAR`', '```', ''].join(
      '\n'
    );

    expect([...readDocumentedEnvVars(markdown)]).toEqual(['REAL_VAR']);
  });

  it('ignores a heading inside an HTML comment, terminated or not', () => {
    const commented = ['### `REAL_VAR`', '', '<!--', '### `COMMENTED_VAR`', '-->'].join('\n');
    const unterminated = ['### `REAL_VAR`', '', '<!--', '### `DANGLING_VAR`'].join('\n');

    expect([...readDocumentedEnvVars(commented)]).toEqual(['REAL_VAR']);
    expect([...readDocumentedEnvVars(unterminated)]).toEqual(['REAL_VAR']);
  });

  it('keeps inline code, since every heading in the reference is backticked', () => {
    expect([...readDocumentedEnvVars('### `STILL_COUNTED`')]).toEqual(['STILL_COUNTED']);
  });
});

describe('compareEnvVarDocs', () => {
  const ambient = new Map([['HOME', 'set by the OS']]);

  it('passes when the two sides match', () => {
    const result = compareEnvVarDocs({
      read: ['SQL_SERVER_HOST', 'HOME'],
      documented: ['SQL_SERVER_HOST'],
      ambient
    });

    expect(result.ok).toBe(true);
    expect(result.configurable).toEqual(['SQL_SERVER_HOST']);
    expect(result.ignored).toEqual(['HOME']);
    expect(formatReport(result)).toContain('✅');
  });

  it('fails on a variable the code reads but the doc never defines', () => {
    const result = compareEnvVarDocs({
      read: ['SQL_SERVER_HOST', 'LOG_FILE'],
      documented: ['SQL_SERVER_HOST'],
      ambient
    });

    expect(result.ok).toBe(false);
    expect(result.undocumented).toEqual(['LOG_FILE']);
    expect(result.unread).toEqual([]);
    expect(formatReport(result)).toContain('Read but undocumented');
    expect(formatReport(result)).toContain('LOG_FILE');
  });

  it('fails on a variable the doc defines that no shipped code reads', () => {
    const result = compareEnvVarDocs({
      read: ['SQL_SERVER_HOST'],
      documented: ['SQL_SERVER_HOST', 'SQL_SERVER_REMOVED'],
      ambient
    });

    expect(result.ok).toBe(false);
    expect(result.unread).toEqual(['SQL_SERVER_REMOVED']);
    expect(result.undocumented).toEqual([]);
    expect(formatReport(result)).toContain('Documented but not read');
  });

  it('fails in both directions at once', () => {
    const result = compareEnvVarDocs({
      read: ['A_NEW_VAR'],
      documented: ['AN_OLD_VAR'],
      ambient
    });

    expect(result.undocumented).toEqual(['A_NEW_VAR']);
    expect(result.unread).toEqual(['AN_OLD_VAR']);
  });

  it('refuses to let a variable be both ambient and documented', () => {
    // Otherwise the ignore list could quietly contradict the document, and whichever
    // one a reader consulted first would be wrong.
    const result = compareEnvVarDocs({
      read: ['HOME'],
      documented: ['HOME'],
      ambient
    });

    expect(result.ok).toBe(false);
    expect(result.unread).toEqual(['HOME']);
  });
});

describe('shippedJsFiles', () => {
  it('takes the .js entries and directories from package.json files, and nothing else', () => {
    withTempPackage(root => {
      write(root, 'index.js', '');
      write(root, 'cli.js', '');
      write(root, 'lib/config/server-config.js', '');
      write(root, 'lib/utils/logger.js', '');
      write(root, 'lib/notes.md', '');
      write(root, 'scripts/ci/tooling.js', '');
      write(root, 'test/unit/some.test.js', '');

      const files = shippedJsFiles(
        ['index.js', 'cli.js', 'lib/', 'docs/**/*.md', '!docs/superpowers/**', 'README.md'],
        root
      );

      // scripts/ and test/ are not published, so their env knobs are out of scope.
      expect(files).toEqual([
        'cli.js',
        'index.js',
        'lib/config/server-config.js',
        'lib/utils/logger.js'
      ]);
    });
  });

  it('skips a listed path that does not exist rather than throwing', () => {
    withTempPackage(root => {
      write(root, 'index.js', '');
      expect(shippedJsFiles(['index.js', 'not-here/'], root)).toEqual(['index.js']);
    });
  });

  // Regression: only `.js` was accepted, so a published .mjs/.cjs module was skipped in
  // silence - npm ships it, the server reads its variables, and the gate said "in sync".
  it('walks .mjs and .cjs modules inside a published directory, not just .js', () => {
    withTempPackage(root => {
      write(root, 'lib/classic.js', '');
      write(root, 'lib/modern.mjs', '');
      write(root, 'lib/legacy.cjs', '');
      write(root, 'lib/notes.md', '');
      write(root, 'lib/styles.css', '');

      expect(shippedJsFiles(['lib/'], root)).toEqual([
        'lib/classic.js',
        'lib/legacy.cjs',
        'lib/modern.mjs'
      ]);
    });
  });

  it('accepts a top-level .mjs or .cjs entry listed directly in files', () => {
    withTempPackage(root => {
      write(root, 'server.mjs', '');
      write(root, 'shim.cjs', '');
      expect(shippedJsFiles(['server.mjs', 'shim.cjs'], root)).toEqual(['server.mjs', 'shim.cjs']);
    });
  });

  it('finds variables a published .mjs module reads', () => {
    withTempPackage(root => {
      write(root, 'package.json', JSON.stringify({ files: ['lib/'] }));
      write(root, 'lib/modern.mjs', 'export const v = process.env.ONLY_IN_MJS;');
      write(root, ENV_VARS_DOC, '### `SOMETHING_ELSE`\n');

      const result = checkEnvVarDocs(root);

      expect(result.sources).toEqual(['lib/modern.mjs']);
      expect(result.undocumented).toEqual(['ONLY_IN_MJS']);
    });
  });
});

describe('checkEnvVarDocs against a synthetic package', () => {
  it('reports the drift it finds end to end', () => {
    withTempPackage(root => {
      write(root, 'package.json', JSON.stringify({ files: ['index.js', 'lib/'] }));
      write(root, 'index.js', 'const a = process.env.DOCUMENTED_VAR;');
      write(root, 'lib/thing.js', 'const b = process.env.MISSING_VAR;');
      write(
        root,
        ENV_VARS_DOC,
        ['### `DOCUMENTED_VAR`', '', 'body', '', '### `STALE_VAR`', '', 'body'].join('\n')
      );

      const result = checkEnvVarDocs(root);

      expect(result.sources).toEqual(['index.js', 'lib/thing.js']);
      expect(result.undocumented).toEqual(['MISSING_VAR']);
      expect(result.unread).toEqual(['STALE_VAR']);
      expect(result.ok).toBe(false);
    });
  });
});

describe('the gate actually runs', () => {
  const repoRoot = join(import.meta.dirname, '..', '..');
  const readRepo = relative => readFileSync(join(repoRoot, relative), 'utf8');

  /** The quoted entries of every `paths:` list in the workflow. */
  const workflowPathFilters = () => {
    const yaml = readRepo('.github/workflows/docs.yml');
    const onBlock = yaml.slice(0, yaml.indexOf('\njobs:'));
    return [...onBlock.matchAll(/^\s+-\s+'([^']+)'\s*$/gm)].map(match => match[1]);
  };

  /**
   * A path-filter pattern as the pieces it is made of: literal text, `*` (which never
   * crosses a `/`), and `**` (which does).
   */
  const tokenise = pattern => {
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
  };

  /**
   * GitHub's path-filter globbing, spelled out rather than translated into a regular
   * expression: a `RegExp` built from a non-literal pattern is a static-analysis finding
   * (Semgrep's non-literal-regexp DoS rule), and matching the tokens directly says what a
   * glob means here more plainly than an escaped translation of it would.
   *
   * Backtracking is fine at this size - the patterns are a handful of characters and the
   * candidates are repository paths.
   */
  const matchTokens = (tokens, file) => {
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
  };

  const filterMatches = (pattern, file) => matchTokens(tokenise(pattern), file);

  // This one guards the future rather than fixing the present: today's filter does cover
  // today's publication scope. The hazard is drift - publish a new top-level path and the
  // `package.json` change itself still triggers the workflow, but every later commit to
  // that path merges without the gate running. Deriving the assertion from the scanner's
  // own source list makes that impossible to land silently: widening `files` fails here
  // until the trigger is widened in the same change.
  it('triggers the documentation workflow for every file the env-var scan reads', () => {
    const filters = workflowPathFilters();
    const { sources } = checkEnvVarDocs();

    const uncovered = sources.filter(file => !filters.some(p => filterMatches(p, file)));

    expect(uncovered).toEqual([]);
  });

  it('would notice a published path the trigger does not cover', () => {
    // The guard above is only meaningful if it can fail; this pins that it can.
    const filters = ['index.js', 'lib/**'];
    const uncovered = ['index.js', 'lib/a.js', 'plugins/b.js'].filter(
      file => !filters.some(p => filterMatches(p, file))
    );

    expect(uncovered).toEqual(['plugins/b.js']);
  });

  it('matches the glob shapes the workflow uses, and only those files', () => {
    // The guard is only as trustworthy as the matcher underneath it, so the semantics are
    // pinned here rather than left implicit in the two assertions above.
    expect(filterMatches('index.js', 'index.js')).toBe(true);
    expect(filterMatches('index.js', 'lib/index.js')).toBe(false);

    expect(filterMatches('lib/**', 'lib/utils/logger.js')).toBe(true);
    expect(filterMatches('lib/**', 'libexec/a.js')).toBe(false);

    expect(filterMatches('**.md', 'docs/user/QUICKSTART.md')).toBe(true);
    expect(filterMatches('**.md', 'docs/user/QUICKSTART.mdx')).toBe(false);

    // `*` stops at a segment boundary; `**` crosses it.
    expect(filterMatches('docs/*.md', 'docs/README.md')).toBe(true);
    expect(filterMatches('docs/*.md', 'docs/user/README.md')).toBe(false);
    expect(filterMatches('docs/**/*.md', 'docs/user/README.md')).toBe(true);
  });

  it('runs the documentation checks as part of the full local gate', () => {
    // Otherwise `npm run ci` passes locally while the CI workflow fails on the same tree.
    expect(JSON.parse(readRepo('package.json')).scripts.ci).toContain('npm run docs:check');
  });
});

describe('the repository as it stands', () => {
  it('documents every environment variable the shipped code reads', () => {
    const result = checkEnvVarDocs();

    expect(result.undocumented).toEqual([]);
    expect(result.unread).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('scans the shipped entry points, not the test and CI tooling', () => {
    const { sources } = checkEnvVarDocs();

    expect(sources).toContain('index.js');
    expect(sources).toContain('cli.js');
    expect(sources).toContain('lib/config/server-config.js');
    expect(sources.some(file => file.startsWith('test/'))).toBe(false);
    expect(sources.some(file => file.startsWith('scripts/'))).toBe(false);
    expect(sources.some(file => file.includes('node_modules'))).toBe(false);
    expect(sources.some(file => file.includes('.claude/'))).toBe(false);
  });

  it('gives a reason for every ambient variable it refuses to require documentation for', () => {
    expect(AMBIENT_VARS.size).toBeGreaterThan(0);
    for (const [name, reason] of AMBIENT_VARS) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(reason).toMatch(/\S/);
    }
  });
});
