import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

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
 * Registration is SELF-VERIFYING (not a hand-maintained list on trust): the
 * `every SQL-building+executing source is registered` test below recursively
 * discovers production sources that BOTH interpolate an identifier into a SQL
 * template (`[${…}]` / `'${…}'`) AND execute SQL in-file (`.query(`/`.batch(`),
 * and fails if any such file is missing from `SQL_SOURCE_FILES`. So the concrete
 * guarantee is: a NEW source that both builds identifier SQL and executes it is
 * auto-detected and must be registered — after which it is scanned for
 * unescaped interpolation.
 *
 * Honest residual (still best-effort): a source that builds identifier SQL in
 * file A but executes it in file B is NOT auto-detected (neither half is a sink
 * on its own), and SQL assembled without a `[${…}]`/`'${…}'` template shape is
 * likewise outside this heuristic. Those remain covered only if wired into the
 * behavioral battery.
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
 *
 * Known best-effort limitation (documented, NOT enforced here): pagination
 * provenance is file-wide, not data-flow — a single `<name> = … parseRowCount(…)`
 * assignment anywhere in a file permits every bare `${limit}`/`${offset}`
 * interpolation in that file. Proving each interpolated value actually came from
 * that coercion would need scope/data-flow analysis. The behavioral battery's
 * numeric-rejection cases (non-integer `limit`/`offset` throw) are the
 * AUTHORITATIVE check for pagination; this lint only sanity-checks that some
 * coercion exists.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const SQL_SOURCE_FILES = [
  'index.js',
  'lib/tools/handlers/database-tools.js',
  'lib/utils/streaming-handler.js',
  'lib/analysis/query-optimizer.js',
  'lib/analysis/bottleneck-detector.js'
];

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

// Leading function-name patterns whose whole `name(...)` span is "safe" and can
// be blanked out before scanning an expression for a BARE caller arg:
//   INTERP_SAFE_CALL   — the four approved escapers (interpolation context).
//   CONSTRUCT_SAFE_CALL — escapers plus numeric coercion (assignment context,
//                          e.g. `safeLimit = Math.max(…, Number.parseInt(limit,…))`).
const INTERP_SAFE_CALL =
  /\b(escapeBracketIdentifier|escapeSqlStringLiteral|sanitizeDbName|parseRowCount)\s*\(/;
const CONSTRUCT_SAFE_CALL =
  /\b(escapeBracketIdentifier|escapeSqlStringLiteral|sanitizeDbName|parseRowCount|Number\.parseInt|Number|parseInt|Math\.[A-Za-z]+)\s*\(/;

/** Blank out every `name(...)` span (balanced parens) whose name matches `nameRe`. */
function stripCallSpans(expr, nameRe) {
  let s = expr;
  for (let guard = 0; guard < 100; guard++) {
    const m = nameRe.exec(s);
    if (!m) break;
    let depth = 0;
    let end = s.length;
    for (let j = m.index + m[0].length - 1; j < s.length; j++) {
      if (s[j] === '(') {
        depth++;
      } else if (s[j] === ')') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    s = `${s.slice(0, m.index)} ${s.slice(end + 1)}`;
  }
  return s;
}

const stripStrings = s => s.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');

/**
 * After blanking approved `name(...)` spans and string literals, does a bare
 * caller-controlled identifier (`database`/`schema`/`tableName`) or `where`
 * still appear? This catches helper-plus-raw shapes such as
 * `escapeBracketIdentifier(database) + database` and a ternary branch whose
 * value is a raw caller arg — cases an "escaper appears somewhere" check misses.
 */
function hasBareCallerArg(expr, nameRe) {
  const remainder = stripStrings(stripCallSpans(expr, nameRe));
  if (CALLER_IDENTIFIER_ARGS.test(remainder)) return 'caller identifier arg';
  if (CALLER_WHERE_ARG.test(remainder)) return 'raw where arg';
  return null;
}

/** Classify one interpolation expression; returns a reason string if unsafe. */
function violationReason(expr, fileText) {
  const trimmed = expr.trim();
  const bare = hasBareCallerArg(trimmed, INTERP_SAFE_CALL);
  if (bare) return `${bare} not escaped: \${${trimmed}}`;
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
    if (escaperCall.test(rhs)) escapedCount++;
    else if (!trivialConst.test(rhs))
      problems.push(`${name} assignment drops its escaper: \`${rhs}\``);
    // A ternary/compound RHS may pass the "escaper appears" check yet still leave
    // a raw caller arg in a branch or fallback (e.g. `cond ? escaper(x) : x`).
    const bare = hasBareCallerArg(rhs, CONSTRUCT_SAFE_CALL);
    if (bare) problems.push(`${name} assignment leaves a bare ${bare}: \`${rhs}\``);
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
  // Assigned to a local before returning (object literal in `=` position) so
  // PMD's JS parser does not misread `return { … }` as an unnecessary block.
  const finding = {
    relPath: relPath,
    scannedCount: scanned.length,
    interpolations: interpolations,
    violations: violations,
    scanned: scanned
  };
  return finding;
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

// Execution call: the file sends SQL to the driver in-file.
const EXECUTES_SQL = /\.(query|batch)\s*\(/;

/** Recursively collect `*.js` under a directory, as repo-relative POSIX paths. */
function collectJsFiles(absDir) {
  const found = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectJsFiles(abs));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      found.push(relative(repoRoot, abs).split(sep).join('/'));
    }
  }
  return found;
}

/**
 * Enumerate production sources and return those that are SQL-building SINKS:
 * they BOTH interpolate an identifier into a SQL template AND execute SQL
 * in-file. `SQL_SOURCE_FILES` must contain exactly these.
 */
function discoverSqlSinks() {
  const candidates = ['index.js', ...collectJsFiles(join(repoRoot, 'lib'))];
  const sinks = [];
  for (const relPath of candidates) {
    const fileText = readFileSync(join(repoRoot, relPath), 'utf8');
    if (!EXECUTES_SQL.test(fileText)) continue;
    const buildsIdentifierSql = scanTemplateLiterals(fileText).some(lit =>
      IDENTIFIER_INTERP.test(lit.raw)
    );
    if (buildsIdentifierSql) sinks.push(relPath);
  }
  return sinks.sort();
}

describe('SQL construction static lint (#1093)', () => {
  const findings = SQL_SOURCE_FILES.map(analyzeFile);

  test('every SQL-building+executing source is registered in SQL_SOURCE_FILES', () => {
    const registered = new Set(SQL_SOURCE_FILES);
    const unregistered = discoverSqlSinks().filter(f => !registered.has(f));
    expect(
      unregistered,
      unregistered.length
        ? `Unregistered SQL-building+executing source(s) — add to SQL_SOURCE_FILES so they are scanned:\n  ${unregistered.join(
            '\n  '
          )}`
        : undefined
    ).toEqual([]);
  });

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

  // Rule-tightening regressions: the earlier lint returned null the moment an
  // approved escaper appeared, so a helper-plus-raw concat or a ternary with a
  // raw fallback slipped through. These lock in the fix.
  describe('interpolation rule rejects helper-plus-raw shapes', () => {
    test.each([
      'escapeBracketIdentifier(database) + database',
      'escapeSqlStringLiteral(schema) + schema',
      'escapeBracketIdentifier(schema) + tableName',
      "escapeBracketIdentifier(database) + '.' + where"
    ])('flags %j', expr => {
      expect(violationReason(expr, '')).toBeTruthy();
    });

    test.each([
      'escapeBracketIdentifier(database)',
      'escapeSqlStringLiteral(schema)',
      'sanitizeDbName(database)',
      'dbPredicate',
      'schemaPredicate',
      'source',
      'safeSchema',
      'safeTableName'
    ])('still allows legit interpolation %j', expr => {
      expect(violationReason(expr, '')).toBeNull();
    });
  });

  describe('escaper-local rule rejects a raw ternary branch/fallback', () => {
    test.each([
      'const safeDb = cond ? sanitizeDbName(database) : database;',
      'const safeSchema = flag ? escapeBracketIdentifier(schema) : schema;'
    ])('flags %j', src => {
      const name = /const (\w+)/.exec(src)[1];
      expect(escaperLocalViolations(src, name).length).toBeGreaterThan(0);
    });

    test.each([
      'const safeDb = escapeBracketIdentifier(database);',
      'const safeSchema = sanitizeDbName(schema);',
      "const safeLimit = limit ? parseRowCount(limit, { name: 'limit', min: 1, fallback: null }) : null;",
      'const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 10));'
    ])('still allows legit construction %j', src => {
      const name = /const (\w+)/.exec(src)[1];
      expect(escaperLocalViolations(src, name)).toEqual([]);
    });
  });
});
