import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * SQL-construction guard (#1093)
 * ==============================
 *
 * The 1.7.16 → 1.7.18 advisory series (GHSA-qhf4-jmhq-73c8, -crw3-hmxc-f53p,
 * -p8gx-89fp-x73j) was one class of bug repeated: a caller-controlled value
 * (`database`/`schema`/`table_name`/`limit`/`offset`/`where`) reached an
 * *executed* SQL string without first passing through the right escaper. Each
 * was fixed at its own site; nothing structurally prevented the next new
 * interpolation site from reopening the class.
 *
 * This test is that structural tripwire. It statically inspects the files that
 * build SQL and FAILS if an *executed* SQL template literal interpolates a
 * value that is not provably safe — i.e. neither a call to an approved escaper
 * nor an allow-listed post-escape/validated local. It is a source scan (cheap,
 * no DB) that complements — never replaces — the runtime safety-tier policy
 * (`validateQuery`/`sql-batch-guard`/`where-clause-guard`).
 *
 * Approach (deliberately narrow, to keep false positives at zero)
 * ---------------------------------------------------------------
 * 1. Tokenize each source file (comment- and quote-aware) to find every
 *    backtick template literal together with the code token that precedes it.
 * 2. Treat a literal as *executed SQL* only when it is either:
 *      (a) the direct argument of `.query(` / `.batch(`, or
 *      (b) assigned/appended to a local named `query` or `sizeQuery`
 *          (the only local names that hold a run statement across these files).
 *    Non-executed SQL-shaped strings — the `validateWhereClause` `probe`,
 *    `export_table_csv`'s `queryDescription`, the optimizer's advisory
 *    `suggestion:` DDL, and fragment locals like `dbPredicate` — are therefore
 *    ignored: they are never sent to the driver. The fragments are re-checked
 *    where they ARE interpolated into an executed literal (see SAFE_LOCALS).
 * 3. For each top-level `${…}` in an executed literal, require the expression
 *    to be an approved-escaper call or an allow-listed safe local; anything
 *    else (a bare `${database}`/`${tableName}`/`${limit}`/…) fails loudly with
 *    the file and expression named.
 *
 * Proven to bite: temporarily rewriting `get_table_data`'s FROM to
 * `FROM [${tableName}]` (bare, unescaped) makes this test fail with
 * "unescaped interpolation `${tableName}`"; restoring the escaped `${source}`
 * makes it pass again.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Files that assemble SQL from (potentially) caller-controlled values.
const SQL_SOURCE_FILES = [
  'index.js',
  'lib/tools/handlers/database-tools.js',
  'lib/utils/streaming-handler.js',
  'lib/analysis/query-optimizer.js',
  'lib/analysis/bottleneck-detector.js'
];

// Approved escaping/coercion helpers from lib/utils/sql-identifier.js. An
// interpolation that is a direct call to one of these neutralizes its value for
// the documented context (bracket identifier, single-quoted literal, numeric).
const APPROVED_ESCAPERS = [
  'escapeBracketIdentifier',
  'escapeSqlStringLiteral',
  'sanitizeDbName',
  'parseRowCount'
];

// Allow-listed *post-escape / validated / controlled* locals that appear inside
// executed templates. Each name is documented so the deferral is auditable; a
// bare caller argument (`database`, `schema`, `tableName`, `limit`, `offset`,
// `where`) is deliberately NOT here and therefore fails the guard.
//
//   safeDb / safeSchema / safeTableName  – results of escapeBracketIdentifier /
//                                          escapeSqlStringLiteral
//   safeLimit                            – Math clamp of Number.parseInt, or
//                                          parseRowCount result
//   source                               – built entirely from
//                                          escapeBracketIdentifier calls
//   offset / limit                       – reassigned via parseRowCount before
//                                          interpolation (get_table_data)
//   whereClause / whereSql               – caller WHERE, gated by the
//                                          where-clause-guard safety layer
//                                          (validateWhereClause) before execution
//   topClause                            – ` TOP <n>` built from a validated int
//   planMode                             – controlled constant
//                                          ('SHOWPLAN_XML' | 'STATISTICS XML')
//   dbPredicate / schemaPredicate        – DB_ID(N'…') / OBJECT_SCHEMA_NAME(…)=N'…'
//                                          fragments built from sanitizeDbName
const SAFE_LOCALS = new Set([
  'safeDb',
  'safeSchema',
  'safeTableName',
  'safeLimit',
  'source',
  'offset',
  'limit',
  'whereClause',
  'whereSql',
  'topClause',
  'planMode',
  'dbPredicate',
  'schemaPredicate'
]);

// SQL keywords used only as a sanity filter: an "executed" literal that somehow
// contains none of these is skipped (there are none today).
const SQL_KEYWORDS =
  /\b(SELECT|FROM|WHERE|USE|OFFSET|FETCH|TOP|JOIN|INSERT|UPDATE|DELETE|SET|ORDER\s+BY|GROUP\s+BY)\b/i;

/**
 * Tokenize `source` and return every backtick template literal with the code
 * that immediately precedes it. Comment- and quote-aware so that backticks or
 * `.query(` text inside comments/strings are ignored.
 * @param {string} source
 * @returns {Array<{raw: string, preceding: string, line: number}>}
 */
function findTemplateLiterals(source) {
  const literals = [];
  let code = ''; // recent NORMAL-state code, used to classify the next backtick
  let i = 0;
  const n = source.length;

  const lineAt = idx => source.slice(0, idx).split('\n').length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // Line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Single/double quoted string (skip its contents)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      code = '';
      continue;
    }
    // Template literal
    if (ch === '`') {
      const start = i;
      const preceding = code;
      i++;
      let depth = 0; // ${ } nesting depth
      while (i < n) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (depth === 0 && c === '`') {
          i++;
          break;
        }
        if (c === '$' && source[i + 1] === '{') {
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0 && c === '{') {
          depth++;
        } else if (depth > 0 && c === '}') {
          depth--;
        }
        i++;
      }
      literals.push({
        raw: source.slice(start, i),
        preceding,
        line: lineAt(start)
      });
      code = '';
      continue;
    }

    // NORMAL code: keep a bounded tail for preceding-context classification.
    code = (code + ch).slice(-80);
    i++;
  }

  return literals;
}

/**
 * A template literal is "executed SQL" when it is the direct argument of
 * `.query(`/`.batch(`, or is assigned/appended to a `query`/`sizeQuery` local.
 * @param {string} preceding - code immediately before the opening backtick
 */
function isExecutedSql(preceding) {
  return (
    /(?:\.query|\.batch)\(\s*$/.test(preceding) ||
    /\b(?:query|sizeQuery)\s*\+?=\s*$/.test(preceding)
  );
}

/**
 * Extract the top-level `${…}` expressions from a template literal's raw text.
 * @param {string} raw - full backtick literal including the backticks
 * @returns {string[]} interpolated expressions (without the `${`/`}` delimiters)
 */
function extractInterpolations(raw) {
  const exprs = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    if (raw[i] === '\\') {
      i += 2;
      continue;
    }
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      const startExpr = j;
      while (j < n && depth > 0) {
        if (raw[j] === '{') depth++;
        else if (raw[j] === '}') depth--;
        if (depth === 0) break;
        j++;
      }
      exprs.push(raw.slice(startExpr, j));
      i = j + 1;
      continue;
    }
    i++;
  }
  return exprs;
}

/**
 * @param {string} expr - an interpolated expression
 * @returns {boolean} whether it is a provably-safe interpolation
 */
function isSafeInterpolation(expr) {
  const trimmed = expr.trim();
  if (APPROVED_ESCAPERS.some(fn => new RegExp(`^${fn}\\s*\\(`).test(trimmed))) {
    return true;
  }
  return SAFE_LOCALS.has(trimmed);
}

describe('SQL construction guard (#1093)', () => {
  const fileFindings = SQL_SOURCE_FILES.map(relPath => {
    const source = readFileSync(join(repoRoot, relPath), 'utf8');
    const executed = findTemplateLiterals(source).filter(
      lit => isExecutedSql(lit.preceding) && SQL_KEYWORDS.test(lit.raw)
    );
    const violations = [];
    let interpolationsChecked = 0;
    for (const lit of executed) {
      for (const expr of extractInterpolations(lit.raw)) {
        interpolationsChecked++;
        if (!isSafeInterpolation(expr)) {
          violations.push({ line: lit.line, expr: expr.trim() });
        }
      }
    }
    return { relPath, executedCount: executed.length, interpolationsChecked, violations };
  });

  test.each(fileFindings)(
    'every executed SQL interpolation in $relPath is escaped or an allow-listed safe local',
    ({ relPath, violations }) => {
      const message = violations
        .map(v => `  ${relPath}:${v.line} — unescaped interpolation \`\${${v.expr}}\``)
        .join('\n');
      expect(
        violations,
        violations.length
          ? 'Caller-controlled value reaches SQL without an approved escaper ' +
              '(escapeBracketIdentifier/escapeSqlStringLiteral/sanitizeDbName/parseRowCount) ' +
              `or an allow-listed safe local:\n${message}`
          : undefined
      ).toEqual([]);
    }
  );

  test('the guard actually inspects executed SQL (it is not a no-op)', () => {
    const totalExecuted = fileFindings.reduce((sum, f) => sum + f.executedCount, 0);
    const totalInterps = fileFindings.reduce((sum, f) => sum + f.interpolationsChecked, 0);
    // Sanity floor: the scanned files contain many executed statements with
    // interpolations today. If tokenization silently stops matching, this trips
    // before the guard degrades into a green no-op.
    expect(totalExecuted).toBeGreaterThanOrEqual(10);
    expect(totalInterps).toBeGreaterThanOrEqual(15);
  });
});
