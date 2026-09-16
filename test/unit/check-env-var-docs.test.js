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
  alwaysPackedEntries,
  checkEnvVarDocs,
  formatReport
} from '../../scripts/docs/check-env-var-docs.mjs';
import { parsePathFilters, filterMatches, uncoveredBy } from './fixtures/workflow-path-filters.js';

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

/** Every variable the scan finds in one snippet, sorted so comparisons are stable. */
const reads = source => [...readEnvVarsFromSource(source)].sort();

/**
 * What counts as a read, as a table.
 *
 * One `it` per spelling had grown into a column of near-identical assertion bodies -
 * Sonar's copy-paste detector was right about that - and the shape hid the thing that
 * actually matters here, which is that every spelling of the same access must agree.
 * Side by side, a row that disagrees with its neighbours is visible. The reason each row
 * exists is in the comment above its group, where it used to be above its `it`.
 */
describe('readEnvVarsFromSource, on what counts as a read', () => {
  it.each([
    // --- the two spellings that appear in JavaScript generally ---
    ['a dotted read', 'const host = process.env.SQL_SERVER_HOST;', ['SQL_SERVER_HOST']],
    ['a single-quoted bracket read', "if (process.env['SQL_DEBUG'] === 'true') {}", ['SQL_DEBUG']],
    ['a double-quoted bracket read', 'const m = process.env["SQL_POOL_MAX"];', ['SQL_POOL_MAX']],
    ['a variable read only once, anywhere', 'x = process.env.ONLY_ONCE;', ['ONLY_ONCE']],

    // The two documented blind spots. `cli.js` does the computed read over the keys of
    // ~/.warp-sql-server-mcp.json; no static scan can name a variable that arrives that way.
    ['a computed read, the documented blind spot', 'if (!process.env[key]) {}', []],
    ['destructuring, the other blind spot', 'const { SOME_VAR } = process.env;', []],

    // Regression: the pattern demanded a bare `.` after `env`, so a defensive refactor to
    // optional chaining emptied the scan silently - a miss in the load-bearing direction,
    // where the gate reports "in sync" while a live setting goes undocumented.
    ['an optional-chained dotted read', 'const a = process.env?.OPT_DOTTED;', ['OPT_DOTTED']],
    ['an optional-chained bracket read', "const b = process.env?.['OPT_BR'];", ['OPT_BR']],
    ['an optional-chained double-quoted read', 'const c = process.env?.["OPT_DQ"];', ['OPT_DQ']],

    // Regression: the pattern was unanchored, so an unrelated object whose identifier ends
    // in `process` was read as the Node global and the gate demanded a doc entry for a
    // variable this server never reads - the false-failure direction, which invites a
    // bogus entry as the cheapest way out.
    ['an unrelated object ending in process', 'subprocess.env.CHILD_FLAG;', []],
    ['the same in bracket form', "subprocess.env['CHILD_BRACKET'];", []],
    ['a camelCase identifier ending in Process', 'myProcess.env.NOT_OURS;', []],
    ['process as a property of something else', 'foo.process.env.ALSO_NOT_OURS;', []],
    ['the real global at a line start', '\nprocess.env.AT_LINE_START;', ['AT_LINE_START']],
    ['the real global as an argument', 'f(process.env.AS_ARGUMENT);', ['AS_ARGUMENT']],

    // Regression: an assignment is this program's output, not a user-supplied setting, so
    // demanding an ENV-VARS.md entry for it would document a knob that does not exist.
    // The bracket form needs the exclusion exactly as much as the dotted one: an asymmetry
    // between two scanners of the same thing is how they drift apart.
    ['a plain dotted assignment', 'process.env.CHILD_FLAG = "1";', []],
    ['a spaced dotted assignment', 'process.env.SPACED   =   "1";', []],
    ['a plain bracket assignment', "process.env['CHILD_FLAG'] = '1';", []],
    ['a spaced bracket assignment', 'process.env["SPACED"]   =   "1";', []],
    ['an optional-chained assignment', "process.env?.WRITE_ONLY = '1';", []],

    // Regression: the write exclusion only looked forward for `=`, so removing a
    // child-only variable read as configuration and the gate demanded a bogus entry.
    ['a dotted delete', 'delete process.env.CHILD_FLAG;', []],
    ['a bracket delete', "delete process.env['CHILD_BRACKET'];", []],
    ['an optional-chained delete', 'delete process.env?.CHILD_OPTIONAL;', []],
    ['a word merely ending in delete', 'const undeleted = process.env.STILL_READ;', ['STILL_READ']],

    // Comparisons only look like assignments, and the compound forms read the current
    // value before writing it back, which makes them genuine reads.
    ['a strict comparison', 'if (process.env.A === "x") {}', ['A']],
    ['a loose comparison', 'if (process.env.B == "x") {}', ['B']],
    [
      'compound assignments, which read first',
      'process.env.C ||= "d"; process.env.E += "f";',
      ['C', 'E']
    ],
    ['a nullish compound assignment', 'process.env.G ??= "h";', ['G']],
    ['a read in an arrow function body', 'const f = () => process.env.D;', ['D']],
    ['a bracket-form comparison', "if (process.env['E'] === 'x') {}", ['E']],
    ['a bracket-form compound assignment', "process.env['C'] ||= 'd';", ['C']],
    ['a bracket-form arrow body', "const f = () => process.env['F'];", ['F']],
    ['an optional-chained read in a condition', 'if (process.env?.READ_VAR) {}', ['READ_VAR']],

    // Regression: matching inside comments made the gate demand an entry for a variable
    // nothing reads. The cheapest way to silence that is a bogus entry, so the check would
    // have corrupted the very document it protects.
    ['a mention in a line comment', '// gone: process.env.GHOST\nconst r = process.env.R;', ['R']],
    [
      'an apostrophe in a comment',
      "// don't read process.env.GHOST\nconst r = process.env.R;",
      ['R']
    ],
    ['a mention in a double-quoted string', 'const h = "process.env.GHOST";', []],
    ['a mention in a single-quoted string', "const s = 'process.env.GHOST';", []],
    ['a mention in template literal text', 'const t = `process.env.GHOST`;', []],

    // Regression: a template literal was masked like a plain string, so the executable
    // `${...}` inside it was blanked and a real read disappeared - which is exactly how a
    // URL or connection string gets built.
    [
      'a read inside a template substitution',
      'const u = `${process.env.NEW_SETTING}/p`;',
      ['NEW_SETTING']
    ],
    [
      'nested braces inside a substitution',
      'const v = `${ { a: process.env.NESTED }.a }`;',
      ['NESTED']
    ],
    [
      'several substitutions in one template',
      'const d = `${process.env.HOST_A}:${process.env.PORT_B}`;',
      ['HOST_A', 'PORT_B']
    ],

    // Regression: a quote inside a regular-expression literal opened what the masker read
    // as a string, and that false string ran to the next matching quote or to end of file.
    // Regex literals are still not tracked - that needs a parser - but the damage is bound
    // to one line, because a string literal cannot span an unescaped newline.
    [
      'a quote in a regex literal',
      'const Q = /[",\\r\\n]/;\nconst l = process.env.AFTER_REGEX;',
      ['AFTER_REGEX']
    ],
    ['an unterminated quote', "const b = 'oops;\nconst r = process.env.NEXT_LINE;", ['NEXT_LINE']],

    // Regression: the bracket name only had to START the subscript, so a computed read was
    // classified as a literal one and the gate demanded an entry for a variable that does
    // not exist. `cli.js`'s computed read is the documented blind spot; naming part of it
    // is worse than missing it.
    ['a concatenated bracket subscript', "process.env['PREFIX_' + key];", []],
    ['a template bracket subscript', 'process.env[`P_${k}`];', []],
    ['a literal subscript with spaces', "process.env[ 'SPACED' ];", ['SPACED']]
  ])('finds the right variables for %s', (_what, source, expected) => {
    expect(reads(source)).toEqual(expected);
  });

  it('still reads the bracket form, whose name legitimately lives inside a string', () => {
    const source = [
      '// not this one: process.env["COMMENTED_BRACKET"]',
      "const a = process.env['BRACKET_VAR'];",
      'const b = process.env["OTHER_BRACKET_VAR"];'
    ].join('\n');

    expect(reads(source)).toEqual(['BRACKET_VAR', 'OTHER_BRACKET_VAR']);
  });

  it('ignores a mention inside a block comment, including a JSDoc example', () => {
    const source = [
      '/**',
      ' * Reads process.env.DOC_ONLY_VAR in the example below.',
      ' * @example process.env.ANOTHER_DOC_VAR',
      ' */',
      'const real = process.env.REAL_VAR;'
    ].join('\n');

    expect(reads(source)).toEqual(['REAL_VAR']);
  });

  it('handles an escaped quote inside a string without losing the following code', () => {
    const source = ['const s = "a \\" process.env.INSIDE";', 'const r = process.env.AFTER;'].join(
      '\n'
    );
    expect(reads(source)).toEqual(['AFTER']);
  });

  it('still honours a backslash line continuation, which really does span a newline', () => {
    const source = [
      "const banner = 'process.env.INSIDE_STRING \\",
      "still inside the string';",
      'const real = process.env.OUTSIDE_VAR;'
    ].join('\n');

    expect(reads(source)).toEqual(['OUTSIDE_VAR']);
  });

  // Regression: `[...source]` indexed by code POINT while every offset was a code UNIT, so
  // each blanked span drifted left of its target by one per astral character. At twelve
  // emoji the drift was wide enough to blank the real read instead of the comment, and the
  // scan returned nothing at all while reporting "in sync".
  it('neither loses a real read nor leaks a commented one after astral characters', () => {
    const source = [
      `const banner = "${'🎉'.repeat(12)}";`,
      '// removed: process.env.GHOST',
      'const r = process.env.REAL;'
    ].join('\n');

    expect(reads(source)).toEqual(['REAL']);
  });

  it('reads every variable the shipped csv module would expose after its regex literal', () => {
    // The concrete shipped case, rather than a synthetic stand-in for it: `lib/utils/csv.js`
    // contains `/[",\r\n]/`, which used to blank 95% of the file.
    const csv = readFileSync(join(import.meta.dirname, '..', '..', 'lib/utils/csv.js'), 'utf8');
    const lines = csv.split('\n');
    const regexLine = lines.findIndex(line => line.includes('MUST_QUOTE'));

    expect(regexLine).toBeGreaterThan(-1);
    lines.splice(regexLine + 1, 0, 'const added = process.env.AFTER_MUST_QUOTE;');

    expect(reads(lines.join('\n'))).toContain('AFTER_MUST_QUOTE');
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

  // The fence variations themselves are covered once in `markdown-blocks.test.js`, where
  // the shared stripper lives. This pins that the gate actually applies it.
  it('ignores a heading inside a fence longer than three characters', () => {
    const tildes = ['### `REAL_VAR`', '', '~~~~', '### `HIDDEN_VAR`', '~~~~'].join('\n');
    const backticks = ['### `REAL_VAR`', '', '````', '### `HIDDEN_VAR`', '````'].join('\n');

    expect([...readDocumentedEnvVars(tildes)]).toEqual(['REAL_VAR']);
    expect([...readDocumentedEnvVars(backticks)]).toEqual(['REAL_VAR']);
  });

  // Regression: the pattern was anchored hard at the end of the line, so the closed ATX
  // form was rejected. It is valid Markdown, passes this repository's markdownlint config,
  // and renders identically - so the gate failed CI over a correct reference.
  it('accepts the closed ATX form, with trailing hashes', () => {
    expect([...readDocumentedEnvVars('### `CLOSED_VAR` ###')]).toEqual(['CLOSED_VAR']);
    expect([...readDocumentedEnvVars('## `TWO_VAR` ##')]).toEqual(['TWO_VAR']);
    expect([...readDocumentedEnvVars('### `UNEVEN_VAR` #####')]).toEqual(['UNEVEN_VAR']);
    expect([...readDocumentedEnvVars('### `PADDED_VAR` ###   ')]).toEqual(['PADDED_VAR']);
  });

  it('requires the space CommonMark requires before a closing hash run', () => {
    // Without it the hashes are literal text, so the heading does not cleanly define NAME.
    expect([...readDocumentedEnvVars('### `NOT_CLOSED`###')]).toEqual([]);
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

/**
 * Which files npm would publish, as a table.
 *
 * Every case here is "lay out a tree, hand `files` to the walker, check what came back",
 * so the setup was the same nine lines each time with three values moved around. The table
 * puts those three values side by side, which is where the interesting differences are.
 */
describe('shippedJsFiles', () => {
  const walk = (tree, entries) =>
    withTempPackage(root => {
      for (const file of tree) write(root, file, '');
      return shippedJsFiles(entries, root);
    });

  it.each([
    // [what it is, files on disk, package.json "files" entries, expected scan scope]

    // scripts/ and test/ are not published, so their env knobs are out of scope, and the
    // markdown and HTML entries carry no `process.env` reads.
    [
      'plain entries and directories, and nothing else',
      ['index.js', 'cli.js', 'lib/config/server-config.js', 'lib/notes.md', 'test/a.test.js'],
      ['index.js', 'cli.js', 'lib/', 'docs/**/*.md', '!docs/superpowers/**', 'README.md'],
      ['cli.js', 'index.js', 'lib/config/server-config.js']
    ],
    ['a listed path that does not exist', ['index.js'], ['index.js', 'not-here/'], ['index.js']],

    // Regression: only `.js` was accepted, so a published .mjs/.cjs module was skipped in
    // silence - npm ships it, the server reads its variables, and the gate said "in sync".
    [
      '.mjs and .cjs inside a published directory',
      ['lib/classic.js', 'lib/modern.mjs', 'lib/legacy.cjs', 'lib/notes.md', 'lib/s.css'],
      ['lib/'],
      ['lib/classic.js', 'lib/legacy.cjs', 'lib/modern.mjs']
    ],
    [
      'a top-level .mjs or .cjs listed directly',
      ['server.mjs', 'shim.cjs'],
      ['server.mjs', 'shim.cjs'],
      ['server.mjs', 'shim.cjs']
    ],

    // Regression: every entry containing `*` was discarded. That was safe only for as long
    // as every glob in `files` ended in `.md` or `.html`; a published `plugins/**/*.js`
    // returned no modules at all, and because the workflow-drift guard derives the paths
    // it demands trigger coverage for from this same function, such a directory would have
    // been unscanned *and* unwatched.
    [
      'a published glob, expanded rather than discarded',
      ['plugins/top.js', 'plugins/nested/deep.mjs', 'plugins/nested/n.md', 'elsewhere/i.js'],
      ['plugins/**/*.js', 'plugins/**/*.mjs'],
      ['plugins/nested/deep.mjs', 'plugins/top.js']
    ],
    [
      'a globstar matching zero directories, as npm allows',
      ['plugins/top.js', 'plugins/nested/deep.js'],
      ['plugins/**/*.js'],
      ['plugins/nested/deep.js', 'plugins/top.js']
    ],
    [
      'a single star, which stays inside one segment',
      ['plugins/top.js', 'plugins/nested/deep.js'],
      ['plugins/*.js'],
      ['plugins/top.js']
    ],
    [
      'a markdown glob, which can hold no process.env read',
      ['docs/guide.md', 'docs/nested/other.md'],
      ['docs/**/*.md'],
      []
    ],

    // An excluded file is never published, so demanding documentation for a variable only
    // it reads would describe a knob no user can set.
    [
      'a negated subtree',
      ['lib/public.js', 'lib/internal/secret.js'],
      ['lib/', '!lib/internal/**'],
      ['lib/public.js']
    ],
    [
      'a negated single file',
      ['lib/public.js', 'lib/internal/secret.js'],
      ['lib/', '!lib/public.js'],
      ['lib/internal/secret.js']
    ],
    // Regression: an entry was treated as a glob only when it contained `*`, although the
    // matcher has always implemented `?`, so a `files` entry using it was read as a literal
    // path, found nothing on disk, and silently contributed no sources.
    [
      'a question-mark glob, which is a glob too',
      ['plugins/file1.js', 'plugins/file2.js', 'plugins/fileAB.js'],
      ['plugins/file?.js'],
      ['plugins/file1.js', 'plugins/file2.js']
    ],
    [
      'node_modules, never walked while expanding a glob',
      ['plugins/real.js', 'plugins/node_modules/dep/index.js'],
      ['plugins/**/*.js'],
      ['plugins/real.js']
    ]
  ])('returns the right scan scope for %s', (_what, tree, entries, expected) => {
    expect(walk(tree, entries)).toEqual(expected);
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

  it('finds variables a module published only through a glob reads', () => {
    withTempPackage(root => {
      write(root, 'package.json', JSON.stringify({ files: ['plugins/**/*.js'] }));
      write(root, 'plugins/a.js', 'export const v = process.env.ONLY_IN_GLOB;');
      write(root, ENV_VARS_DOC, '### `SOMETHING_ELSE`\n');

      const result = checkEnvVarDocs(root);

      expect(result.sources).toEqual(['plugins/a.js']);
      expect(result.undocumented).toEqual(['ONLY_IN_GLOB']);
    });
  });
});

describe('alwaysPackedEntries', () => {
  // Regression: the scan derived solely from `files`, but npm packs `main` and every `bin`
  // target regardless - so an entry point listed only there shipped unscanned, and the
  // workflow-coverage assertion derived from the same list missed it too.
  it('collects main and bin targets, normalised off any leading ./', () => {
    expect(alwaysPackedEntries({ main: './index.js', bin: { cli: 'cli.js' } })).toEqual([
      'index.js',
      'cli.js'
    ]);
  });

  it('accepts the string form of bin, which names a single executable', () => {
    expect(alwaysPackedEntries({ main: 'server.js', bin: './run.js' })).toEqual([
      'server.js',
      'run.js'
    ]);
  });

  // Regression: appending the entry points to `files` left them subject to its negations,
  // so `!index.js` could remove the very module npm is guaranteed to pack. They are
  // resolved as a separate list instead.
  it('keeps main and bin immune to a files negation', () => {
    withTempPackage(root => {
      write(root, 'package.json', JSON.stringify({ main: 'index.js', files: ['!index.js'] }));
      write(root, 'index.js', 'export const v = process.env.STILL_SHIPPED;');
      write(root, ENV_VARS_DOC, '### `SOMETHING_ELSE`\n');

      const result = checkEnvVarDocs(root);

      expect(result.sources).toContain('index.js');
      expect(result.undocumented).toEqual(['STILL_SHIPPED']);
    });
  });

  it('returns nothing for a package declaring neither', () => {
    expect(alwaysPackedEntries({})).toEqual([]);
    expect(alwaysPackedEntries({ main: '', bin: {} })).toEqual([]);
  });

  it('scans a module published only as main, outside files', () => {
    withTempPackage(root => {
      write(root, 'package.json', JSON.stringify({ main: 'server.js', files: ['lib/'] }));
      write(root, 'server.js', 'export const v = process.env.ONLY_IN_MAIN;');
      write(root, 'lib/other.js', '');
      write(root, ENV_VARS_DOC, '### `SOMETHING_ELSE`\n');

      const result = checkEnvVarDocs(root);

      expect(result.sources).toContain('server.js');
      expect(result.undocumented).toEqual(['ONLY_IN_MAIN']);
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
  const workflow = () => readRepo('.github/workflows/docs.yml');

  // The two triggers that gate a merge. `schedule` and `workflow_dispatch` carry no path
  // filter and are not what a contributor's change has to pass through.
  const GATING_TRIGGERS = ['push', 'pull_request'];

  // This one guards the future rather than fixing the present: today's filters do cover
  // today's publication scope. The hazard is drift - publish a new top-level path and the
  // `package.json` change itself still triggers the workflow, but every later commit to
  // that path merges without the gate running. Deriving the assertion from the scanner's
  // own source list makes that impossible to land silently: widening `files` fails here
  // until the trigger is widened in the same change.
  //
  // Each trigger is checked on its own. A union of the two would accept a source path
  // listed under `push` alone, which is the worst case rather than an acceptable one:
  // pull requests changing that path would never run the gate, and a pull request is
  // exactly where a gate is supposed to block.
  it('triggers the documentation workflow for every file the env-var scan reads', () => {
    const { sources } = checkEnvVarDocs();
    expect(sources.length).toBeGreaterThan(0);

    for (const trigger of GATING_TRIGGERS) {
      const filters = parsePathFilters(workflow(), trigger);
      expect({ trigger, count: filters.length > 0 }).toEqual({ trigger, count: true });
      expect({ trigger, uncovered: uncoveredBy(filters, sources) }).toEqual({
        trigger,
        uncovered: []
      });
    }
  });

  it('reads each trigger separately rather than pooling their path filters', () => {
    // The parser is what makes the per-trigger assertion above meaningful, so its
    // separation is pinned directly against a workflow where the two lists differ.
    const yaml = [
      'on:',
      '  push:',
      '    branches: [ main ]',
      '    paths:',
      "      - 'index.js'",
      '      # a comment, which is not a filter',
      "      - 'lib/**'",
      '  pull_request:',
      '    paths:',
      "      - 'index.js'",
      '  schedule:',
      "    - cron: '0 4 * * 1'",
      '',
      'jobs:',
      '  build: {}'
    ].join('\n');

    expect(parsePathFilters(yaml, 'push')).toEqual(['index.js', 'lib/**']);
    expect(parsePathFilters(yaml, 'pull_request')).toEqual(['index.js']);
    expect(parsePathFilters(yaml, 'release')).toEqual([]);
  });

  it('would notice a published path one trigger covers and the other does not', () => {
    // The guard above is only meaningful if it can fail; this pins that it can, and that
    // it fails for the pull_request side alone - the case a flattened union used to miss.
    const yaml = [
      'on:',
      '  push:',
      '    paths:',
      "      - 'index.js'",
      "      - 'lib/**'",
      '  pull_request:',
      '    paths:',
      "      - 'index.js'",
      '',
      'jobs:',
      '  build: {}'
    ].join('\n');
    const sources = ['index.js', 'lib/a.js'];

    expect(uncoveredBy(parsePathFilters(yaml, 'push'), sources)).toEqual([]);
    expect(uncoveredBy(parsePathFilters(yaml, 'pull_request'), sources)).toEqual(['lib/a.js']);
  });

  // Regression: any positive match counted as coverage, but GitHub resolves a `paths` list
  // positionally with the last match winning. Claiming coverage the workflow does not have
  // is the wrong direction for a drift guard - it asserts a gate runs when it does not.
  it('applies negative path filters in order, as GitHub does', () => {
    const filters = ['lib/**', '!lib/internal/**'];
    expect(uncoveredBy(filters, ['lib/a.js', 'lib/internal/a.js'])).toEqual(['lib/internal/a.js']);

    // A later positive re-includes what an earlier negation removed.
    const reincluded = ['lib/**', '!lib/internal/**', 'lib/internal/keep.js'];
    expect(uncoveredBy(reincluded, ['lib/internal/keep.js'])).toEqual([]);
  });

  it('would notice a published path neither trigger covers', () => {
    const filters = ['index.js', 'lib/**'];
    expect(uncoveredBy(filters, ['index.js', 'lib/a.js', 'plugins/b.js'])).toEqual([
      'plugins/b.js'
    ]);
  });

  it('matches the glob shapes the workflow uses, and only those files', () => {
    // The guard is only as trustworthy as the matcher underneath it, so the semantics are
    // pinned here rather than left implicit in the assertions above.
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
