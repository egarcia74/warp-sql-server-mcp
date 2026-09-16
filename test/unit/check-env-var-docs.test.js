import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
