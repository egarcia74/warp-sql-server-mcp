import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * SQL-construction static lint (#1093) — SECONDARY, best-effort tripwire
 * ======================================================================
 *
 * The AUTHORITATIVE guard for the 1.7.16 → 1.7.18 injection class is the
 * behavioral battery in sql-injection-battery.test.js, which drives the real
 * handlers with injection payloads and asserts the emitted SQL is neutralized.
 * This static lint is a cheap backstop for the one thing the battery cannot
 * cover: a brand-new SQL-building site nobody wired into the battery. It scans
 * the SQL-building sources and fails if a SQL template literal interpolates a
 * bare caller-controlled argument without an approved escaper.
 *
 * It is best-effort by nature (a source scan, not execution). Its scope is
 * therefore honest and narrow:
 *   - It inspects EVERY template literal that looks like SQL (contains a SQL
 *     keyword, or a `[${…}]` / `'${…}'` identifier interpolation), regardless
 *     of the variable it is assigned to — so a SQL string built in any local
 *     name is in scope. Two non-executed, SQL-shaped strings are excluded by
 *     their SPECIFIC context (not by name coincidence): the `validateWhereClause`
 *     `probe` (validation only) and optimizer `suggestion:` advisory DDL.
 *   - An interpolation fails if it references a caller-arg identifier
 *     (`database`/`schema`/`tableName`/`where`) outside an approved escaper, or
 *     is a bare `limit`/`offset` in a file that does not coerce it via
 *     `parseRowCount`. Composite/derived locals are trusted because their OWN
 *     construction templates are scanned by this same pass; the non-template
 *     escaper locals (`safeDb`/`safeSchema`/`safeTableName`/`safeLimit`) are
 *     additionally checked to ensure their construction keeps its escaper.
 *
 * Regression history baked in as assertions:
 *   - The tokenizer understands JS regex literals; a prior version desynced on
 *     `/'[^']*'/` (query-optimizer.js) and silently skipped the missing-index
 *     query at ~line 778. A dedicated test asserts that query IS scanned.
 *   - The floor is PER-FILE, so a per-file blind spot fails loudly.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const SQL_SOURCE_FILES = [
  'index.js',
  'lib/tools/handlers/database-tools.js',
  'lib/utils/streaming-handler.js',
  'lib/analysis/query-optimizer.js',
  'lib/analysis/bottleneck-detector.js'
];

// Approved escaping/coercion helpers from lib/utils/sql-identifier.js.
const ESCAPER =
  /^(escapeBracketIdentifier|escapeSqlStringLiteral|sanitizeDbName|parseRowCount)\s*\(/;

// Caller-controlled identifier args that MUST be escaped before reaching SQL.
// `table_name` (snake_case) is intentionally absent: the dispatcher maps it to
// `tableName` before any handler runs, and `table_name` only ever appears as a
// trusted catalog column reference (`r.table_name`). `where` is included, but
// its derived, runtime-gated locals `whereClause`/`whereSql` are not (word
// boundaries: `\bwhere\b` does not match `whereClause`).
const CALLER_IDENTIFIER_ARGS = /\b(database|schema|tableName)\b/;
const CALLER_WHERE_ARG = /\bwhere\b/;

// Non-template escaper locals whose construction this lint verifies (their
// escaper cannot be silently dropped). Template-built locals (source,
// dbPredicate, …) need no entry here: their construction templates are scanned
// directly by the main pass.
const VERIFIED_ESCAPER_LOCALS = ['safeDb', 'safeSchema', 'safeTableName', 'safeLimit'];

// A SQL-shaped template literal: contains a SQL statement keyword, OR embeds an
// interpolation directly in a bracket/quote identifier context.
const SQL_KEYWORD =
  /\b(SELECT|FROM|WHERE|USE|OFFSET|FETCH|TOP|JOIN|INSERT|UPDATE|DELETE|ORDER\s+BY|GROUP\s+BY|DB_ID|OBJECT_SCHEMA_NAME)\b/i;
const IDENTIFIER_INTERP = /\[\s*\$\{|N?'\s*\$\{/;

const KEYWORDS_EXPECTING_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'delete',
  'void',
  'new',
  'do',
  'else',
  'yield',
  'case',
  'throw',
  'await'
]);

const isWordChar = c => c != null && /[A-Za-z0-9_$]/.test(c);

/**
 * Tokenize `source` and return every template literal (raw text + a slice of
 * the preceding source + line). Comment-, string- AND regex-aware so that
 * backticks/quotes inside comments, strings or regex literals never desync the
 * scan. Handles `${…}` interpolations (including nested strings/regex/templates)
 * by brace-tracking.
 */
function scanTemplateLiterals(source) {
  const literals = [];
  const n = source.length;
  let i = 0;
  let lastSig = null; // last non-whitespace significant char
  let lastWord = ''; // most recently completed identifier
  let curWord = '';

  const lineAt = idx => source.slice(0, idx).split('\n').length;

  const finishWord = () => {
    if (curWord) {
      lastWord = curWord;
      curWord = '';
    }
  };
  const setSig = c => {
    finishWord();
    lastSig = c;
  };
  const advanceCode = c => {
    if (/\s/.test(c)) {
      finishWord();
      return;
    }
    if (isWordChar(c)) curWord += c;
    else finishWord();
    lastSig = c;
  };
  const regexAllowed = () => {
    if (lastSig === null) return true;
    if ('=(,;{[<>!&|+-*%^~?:'.includes(lastSig)) return true;
    if (lastSig === '}') return true;
    return isWordChar(lastSig) && KEYWORDS_EXPECTING_REGEX.has(lastWord);
  };

  const skipString = quote => {
    i++;
    while (i < n) {
      if (source[i] === '\\') {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        i++;
        return;
      }
      i++;
    }
  };
  const skipRegex = () => {
    i++;
    let inClass = false;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i++;
        while (i < n && /[a-z]/i.test(source[i])) i++;
        return;
      }
      i++;
    }
  };
  const skipComment = () => {
    if (source[i + 1] === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      return true;
    }
    if (source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      return true;
    }
    return false;
  };

  const isCommentStart = c => c === '/' && (source[i + 1] === '/' || source[i + 1] === '*');
  const isQuote = c => c === "'" || c === '"';
  const isRegexStart = c => c === '/' && regexAllowed();

  // Consume a comment / string / template / regex token starting at `i`, if any.
  const consumeSpecial = () => {
    const c = source[i];
    if (isCommentStart(c)) return skipComment();
    if (isQuote(c)) {
      skipString(c);
      setSig(c);
      return true;
    }
    if (c === '`') {
      readTemplate();
      return true;
    }
    if (isRegexStart(c)) {
      skipRegex();
      setSig('/');
      return true;
    }
    return false;
  };

  // Consume characters until the `}` that closes the current `${` (depth 0).
  const skipInterpolation = () => {
    let depth = 1;
    while (i < n && depth > 0) {
      if (consumeSpecial()) continue;
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      advanceCode(c);
      i++;
    }
  };

  function readTemplate() {
    const start = i;
    const preceding = source.slice(Math.max(0, start - 80), start);
    i++; // opening backtick
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        break;
      }
      if (c === '$' && source[i + 1] === '{') {
        i += 2;
        skipInterpolation();
        continue;
      }
      i++;
    }
    literals.push({ raw: source.slice(start, i), preceding, line: lineAt(start) });
    setSig('`');
  }

  while (i < n) {
    if (consumeSpecial()) continue;
    advanceCode(source[i]);
    i++;
  }

  return literals;
}

/** Top-level `${…}` expressions inside a template literal's raw text. */
function extractInterpolations(raw) {
  const exprs = [];
  const n = raw.length;
  let i = 0;
  while (i < n) {
    if (raw[i] === '\\') {
      i += 2;
      continue;
    }
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      const start = j;
      while (j < n && depth > 0) {
        if (raw[j] === '{') depth++;
        else if (raw[j] === '}') depth--;
        if (depth === 0) break;
        j++;
      }
      exprs.push(raw.slice(start, j));
      i = j + 1;
      continue;
    }
    i++;
  }
  return exprs;
}

const isSqlish = raw => SQL_KEYWORD.test(raw) || IDENTIFIER_INTERP.test(raw);

// Excluded by SPECIFIC context (never sent to the driver):
//   probe:      `const probe = ` in validateWhereClause — lexically validated only.
//   suggestion: `suggestion: ` advisory DDL text returned to the user.
const isExcludedContext = preceding =>
  /\bprobe\s*=\s*$/.test(preceding) || /\bsuggestion\s*:\s*$/.test(preceding);

/** Does the file coerce `name` (limit/offset) through parseRowCount? */
function coercesPagination(fileText, name) {
  return new RegExp(`\\b${name}\\s*=\\s*[^;\\n]*parseRowCount\\(`).test(fileText);
}

/** Classify one interpolation expression; returns a reason string if unsafe. */
function violationReason(expr, fileText) {
  const trimmed = expr.trim();
  if (ESCAPER.test(trimmed)) return null;
  if (CALLER_IDENTIFIER_ARGS.test(trimmed))
    return `caller identifier arg not escaped: \${${trimmed}}`;
  if (CALLER_WHERE_ARG.test(trimmed)) return `raw where arg not gated: \${${trimmed}}`;
  if (trimmed === 'limit' || trimmed === 'offset') {
    return coercesPagination(fileText, trimmed)
      ? null
      : `pagination arg not coerced via parseRowCount: \${${trimmed}}`;
  }
  return null;
}

/** Verify a non-template escaper local keeps its escaper across all assignments. */
function escaperLocalViolations(fileText, name) {
  const problems = [];
  const re = new RegExp(`\\b${name}\\s*=\\s*([^;]+);`, 'g');
  const assignments = [...fileText.matchAll(re)].map(m => m[1].trim());
  if (assignments.length === 0) return problems; // name not used in this file
  let escapedCount = 0;
  const escaperCall =
    /(escapeBracketIdentifier|escapeSqlStringLiteral|sanitizeDbName|parseRowCount|Math\.|Number\.parseInt)\s*\(/;
  const trivialConst = /^(null|''|""|'[^']*'|"[^"]*")$/;
  for (const rhs of assignments) {
    if (escaperCall.test(rhs)) {
      escapedCount++;
    } else if (!trivialConst.test(rhs)) {
      problems.push(`${name} assignment drops its escaper: \`${rhs}\``);
    }
  }
  if (escapedCount === 0) problems.push(`${name} is never constructed via an approved escaper`);
  return problems;
}

function analyzeFile(relPath) {
  const fileText = readFileSync(join(repoRoot, relPath), 'utf8');
  const scanned = scanTemplateLiterals(fileText).filter(
    lit => isSqlish(lit.raw) && !isExcludedContext(lit.preceding)
  );
  const violations = [];
  let interpolations = 0;
  for (const lit of scanned) {
    for (const expr of extractInterpolations(lit.raw)) {
      interpolations++;
      const reason = violationReason(expr, fileText);
      if (reason) violations.push(`${relPath}:${lit.line} — ${reason}`);
    }
  }
  for (const name of VERIFIED_ESCAPER_LOCALS) {
    for (const problem of escaperLocalViolations(fileText, name)) {
      violations.push(`${relPath} — ${problem}`);
    }
  }
  return { relPath, scannedCount: scanned.length, interpolations, violations, scanned };
}

// Per-file floor of SQL-ish templates that MUST be found. A per-file blind spot
// (e.g. the historical regex-desync that dropped query-optimizer's line-778
// query) trips these before the lint can degrade into a green no-op.
const MIN_SCANNED = {
  'index.js': 1,
  'lib/tools/handlers/database-tools.js': 8,
  'lib/utils/streaming-handler.js': 3,
  'lib/analysis/query-optimizer.js': 4,
  'lib/analysis/bottleneck-detector.js': 1
};

describe('SQL construction static lint (#1093)', () => {
  const findings = SQL_SOURCE_FILES.map(analyzeFile);

  test.each(findings)('$relPath has no unescaped caller-arg interpolation', ({ violations }) => {
    expect(
      violations,
      violations.length
        ? `Caller-controlled value may reach SQL without an approved escaper:\n  ${violations.join(
            '\n  '
          )}`
        : undefined
    ).toEqual([]);
  });

  test.each(findings)(
    '$relPath yields at least its expected SQL templates',
    ({ relPath, scannedCount }) => {
      expect(scannedCount).toBeGreaterThanOrEqual(MIN_SCANNED[relPath]);
    }
  );

  test('the query-optimizer missing-index query (historical regex blind spot) IS scanned', () => {
    const optimizer = findings.find(f => f.relPath === 'lib/analysis/query-optimizer.js');
    const found = optimizer.scanned.some(lit => /dm_db_missing_index_group_stats/.test(lit.raw));
    expect(
      found,
      'The missing-index DMV query must be in the scanned set; a tokenizer regex-desync previously skipped it.'
    ).toBe(true);
  });
});
