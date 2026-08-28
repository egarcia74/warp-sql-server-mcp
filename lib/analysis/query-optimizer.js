/**
 * Query Optimization and Analysis Engine
 * Provides intelligent query analysis, bottleneck detection, and optimization recommendations
 */
import { sanitizeDbName, escapeBracketIdentifier } from '../utils/sql-identifier.js';
import { acquirePool } from '../utils/connection.js';

/**
 * Map a missing-index avg_user_impact (0-100) to a priority bucket.
 * @param {number} impact - average user impact percentage
 * @returns {'high'|'medium'|'low'}
 */
function indexPriority(impact) {
  if (impact >= 75) return 'high';
  if (impact >= 40) return 'medium';
  return 'low';
}

// Static analysis is skipped for oversized input to bound regex work (ReDoS).
const MAX_ANALYZABLE_QUERY_LENGTH = 10000;

// One part of a (possibly multi-part) T-SQL object name: a bracket-delimited
// identifier (with `]]` escapes), a double-quoted identifier, or a regular
// identifier (letters/_/@/# first, then letters/digits/_/$/@/#).
const IDENTIFIER_PART_SOURCE = String.raw`\[(?:[^\]]|\]\])+\]|"[^"]+"|[A-Za-z_@#][\w$@#]*`;
// Anchored object name: a leading part followed by up to three dot-separated
// parts, any of which may be omitted (`db..table` = default schema). Dots must
// be adjacent so a keyword after a stray trailing dot is never taken as a part.
const TARGET_TABLE_PATTERN = new RegExp(
  String.raw`^((?:${IDENTIFIER_PART_SOURCE})(?:\.(?:${IDENTIFIER_PART_SOURCE})?){0,3})`
);
const LEADING_IDENTIFIER = new RegExp(String.raw`^(?:${IDENTIFIER_PART_SOURCE})`);
const QUALIFIED_NAME_TOKENS = new RegExp(String.raw`${IDENTIFIER_PART_SOURCE}|\.`, 'g');
// A bare, optionally qualified column reference — the only ORDER BY / WHERE
// token shape that can serve as an index key column.
const PLAIN_COLUMN_PATTERN = new RegExp(
  String.raw`^(?:${IDENTIFIER_PART_SOURCE})(?:\.(?:${IDENTIFIER_PART_SOURCE})){0,3}$`
);
const IDENTIFIER_CHAR = /[\w$@#]/;
// Mask fill characters: comments become whitespace (skippable), literals and
// quoted/bracketed identifiers become a placeholder that is neither whitespace
// nor an identifier character, so the identifier can still be located and read
// from the original text at the same offset.
const COMMENT_FILL = ' ';
const TOKEN_FILL = '~';
const FROM_KEYWORD = /^from\b/i;
const WITH_KEYWORD = /^with\b/i;
// A second table source in a FROM clause: any join/apply, or PIVOT/UNPIVOT.
const MULTI_SOURCE_KEYWORD = /^(?:join|apply|pivot|unpivot)\b/i;
// Clauses that end the FROM clause's table-source list.
const FROM_CLAUSE_TERMINATOR = /^(?:where|group|having|order|option|for|union|except|intersect)\b/i;
// The statement that ends a leading CTE list.
const CTE_BODY_STATEMENT = /^(?:select|insert|update|delete|merge)\b/i;
// Rowset functions that appear where a table would but are not indexable.
const ROWSET_FUNCTIONS = new Set([
  'openrowset',
  'openquery',
  'opendatasource',
  'openxml',
  'openjson',
  'string_split'
]);

/**
 * @param {*} query - candidate query text
 * @returns {boolean} whether the value is a string within the analyzable size
 */
function isAnalyzableQuery(query) {
  return typeof query === 'string' && query.length <= MAX_ANALYZABLE_QUERY_LENGTH;
}

/**
 * Index of the `closer` that ends the delimited token opened at `openIndex`,
 * treating a doubled closer (`''`, `""`, `]]`) as an escape; -1 if unterminated.
 * @param {string} sql - full query text
 * @param {number} openIndex - index of the opening delimiter
 * @param {string} closer - closing delimiter character
 * @returns {number} index of the closing delimiter, or -1
 */
function indexOfDelimitedEnd(sql, openIndex, closer) {
  for (let i = openIndex + 1; i < sql.length; i++) {
    if (sql[i] !== closer) {
      continue;
    }
    if (sql[i + 1] === closer) {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * Index of the last character of the line comment opened at `openIndex` (the
 * newline itself is kept so line structure survives masking).
 * @param {string} sql - full query text
 * @param {number} openIndex - index of the opening `--`
 * @returns {number} index of the comment's last character
 */
function indexOfLineCommentEnd(sql, openIndex) {
  const newline = sql.indexOf('\n', openIndex);
  return newline === -1 ? sql.length - 1 : newline - 1;
}

/**
 * Index of the final `/` closing the block comment opened at `openIndex`,
 * honouring T-SQL's nested block comments; -1 if unterminated.
 * @param {string} sql - full query text
 * @param {number} openIndex - index of the opening slash-star
 * @returns {number} index of the closing slash, or -1
 */
function indexOfBlockCommentEnd(sql, openIndex) {
  let depth = 0;
  let i = openIndex;
  while (i < sql.length - 1) {
    const pair = sql.substring(i, i + 2);
    if (pair === '/*') {
      depth++;
      i += 2;
    } else if (pair === '*/') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
      i += 2;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Describes the lexical span starting at `i` as `[end, fill]`: `end` is the
 * index of the span's last character (-1 when unterminated) and `fill` is the
 * character to mask it with, or null for an ordinary character kept as is.
 * @param {string} sql - full query text
 * @param {number} i - index of the span start
 * @returns {[number, string|null]} span end and mask fill
 */
function lexicalSpanAt(sql, i) {
  const ch = sql[i];
  const pair = sql.substring(i, i + 2);
  if (ch === "'" || ch === '"') {
    return [indexOfDelimitedEnd(sql, i, ch), TOKEN_FILL];
  }
  if (ch === '[') {
    return [indexOfDelimitedEnd(sql, i, ']'), TOKEN_FILL];
  }
  if (pair === '--') {
    return [indexOfLineCommentEnd(sql, i), COMMENT_FILL];
  }
  if (pair === '/*') {
    return [indexOfBlockCommentEnd(sql, i), COMMENT_FILL];
  }
  return [i, null];
}

/**
 * Offset-preserving lexical mask of `sql`: comments are replaced by spaces and
 * string literals / quoted / bracketed identifiers by a placeholder, each of
 * the same length, so a keyword search on the mask can only hit real SQL
 * keywords while every index maps 1:1 onto the original text. Returns null when a literal,
 * identifier or block comment is unterminated (malformed input) so the caller
 * fails to "unknown" instead of guessing (#1102).
 * @param {string} sql - full query text
 * @returns {string|null} same-length mask, or null
 */
function maskSqlLiteralsAndComments(sql) {
  let mask = '';
  let i = 0;
  while (i < sql.length) {
    const [end, fill] = lexicalSpanAt(sql, i);
    if (end === -1) {
      return null;
    }
    mask += fill === null ? sql[i] : fill.repeat(end - i + 1);
    i = end + 1;
  }
  return mask;
}

/**
 * @param {string} mask - lexical mask
 * @param {number} i - index to test
 * @returns {boolean} whether an identifier/keyword may start at `i`
 */
function isWordStartAt(mask, i) {
  return i === 0 || !IDENTIFIER_CHAR.test(mask[i - 1]);
}

/**
 * @param {string} mask - lexical mask
 * @param {number} i - index to test
 * @param {RegExp} keyword - anchored `^keyword\b` pattern
 * @returns {boolean} whether the keyword starts at `i` as a whole word
 */
function keywordAt(mask, i, keyword) {
  return isWordStartAt(mask, i) && keyword.test(mask.slice(i, i + 12));
}

/**
 * First index >= `start` at parenthesis depth 0 (relative to `start`) for
 * which `predicate(mask, i)` holds; -1 if none.
 * @param {string} mask - lexical mask
 * @param {number} start - index to scan from
 * @param {(mask: string, i: number) => boolean} predicate - match test
 * @returns {number} matching index, or -1
 */
function findTopLevel(mask, start, predicate) {
  let depth = 0;
  for (let i = start; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (depth === 0 && predicate(mask, i)) {
      return i;
    }
  }
  return -1;
}

/**
 * @param {string} mask - lexical mask
 * @param {number} start - index to scan from
 * @returns {number} first index >= start that is not whitespace (mask.length if none)
 */
function skipBlank(mask, start) {
  let i = start;
  while (i < mask.length && /\s/.test(mask[i])) {
    i++;
  }
  return i;
}

/**
 * Remove the delimiters from one identifier part, un-escaping `]]`.
 * @param {string} part - raw identifier token as written in the query
 * @returns {string} the bare identifier
 */
function unquoteIdentifierPart(part) {
  if (part.startsWith('[')) {
    return part.slice(1, -1).replaceAll(']]', ']');
  }
  if (part.startsWith('"')) {
    return part.slice(1, -1);
  }
  return part;
}

/**
 * Split a raw multi-part name into its parts, using '' for an omitted part
 * (`db..t` -> ['db', '', 't']); null if the name ends with a dot.
 * @param {string} rawName - object name as written in the query
 * @returns {string[]|null} parts, or null
 */
function splitQualifiedName(rawName) {
  const parts = [];
  let expectingPart = true;
  for (const token of rawName.match(QUALIFIED_NAME_TOKENS) ?? []) {
    if (token === '.') {
      if (expectingPart) {
        parts.push('');
      }
      expectingPart = true;
    } else {
      parts.push(token);
      expectingPart = false;
    }
  }
  return expectingPart ? null : parts;
}

/**
 * Re-emit a multi-part object name with every part bracket-quoted via the
 * approved escaper, e.g. ['dbo', 'Users'] -> `[dbo].[Users]`; an omitted part
 * stays empty (`[db]..[t]`).
 * @param {string[]} parts - name parts from splitQualifiedName
 * @returns {string} bracket-quoted, escaped object name
 */
function formatQualifiedTable(parts) {
  return parts
    .map(p => (p === '' ? '' : `[${escapeBracketIdentifier(unquoteIdentifierPart(p))}]`))
    .join('.');
}

/**
 * Parse the table source starting at `pos` (a mask index): the qualified name
 * as written in the original text. Returns `[parts, end]` (end = mask index
 * just past the name) or null when what follows FROM is not a plain object
 * name (derived table, VALUES, ...).
 * @param {string} query - original query text
 * @param {string} mask - lexical mask of `query`
 * @param {number} pos - index just past the FROM keyword
 * @returns {[string[], number]|null} name parts and end index, or null
 */
function parseTableSource(query, mask, pos) {
  const start = skipBlank(mask, pos);
  const match = TARGET_TABLE_PATTERN.exec(query.slice(start));
  if (!match) {
    return null;
  }
  const parts = splitQualifiedName(match[1]);
  return parts ? [parts, start + match[0].length] : null;
}

/**
 * @param {string} mask - lexical mask
 * @param {string[]} parts - table source name parts
 * @param {number} end - mask index just past the name
 * @returns {boolean} whether the source is a function call or rowset function
 */
function isRowsetSource(mask, parts, end) {
  if (mask[skipBlank(mask, end)] === '(') {
    return true;
  }
  return ROWSET_FUNCTIONS.has(unquoteIdentifierPart(parts.at(-1)).toLowerCase());
}

/**
 * @param {string} mask - lexical mask
 * @param {number} i - index to test
 * @returns {boolean} whether a comma, terminator, join keyword or clause end is at `i`
 */
function isFromClauseBoundary(mask, i) {
  return (
    mask[i] === ',' ||
    mask[i] === ';' ||
    keywordAt(mask, i, MULTI_SOURCE_KEYWORD) ||
    keywordAt(mask, i, FROM_CLAUSE_TERMINATOR)
  );
}

/**
 * Whether the FROM clause whose first source ends at `end` lists more than
 * one table source (JOIN/APPLY/PIVOT or a comma list) — column-to-table
 * attribution is then not possible without a catalog, so callers must not
 * guess.
 * @param {string} mask - lexical mask
 * @param {number} end - mask index just past the first table source
 * @returns {boolean} whether a second table source follows
 */
function hasMultipleTableSources(mask, end) {
  const idx = findTopLevel(mask, end, isFromClauseBoundary);
  return idx !== -1 && mask[idx] !== ';' && !keywordAt(mask, idx, FROM_CLAUSE_TERMINATOR);
}

/**
 * Resolve the first top-level FROM's table source to its name parts, or null
 * when there is no FROM, it is not a plain table, it is a function/rowset
 * source, or the clause has more than one table source.
 * @param {string} query - original query text
 * @param {string} mask - lexical mask of `query`
 * @returns {string[]|null} name parts, or null
 */
function resolveFromSource(query, mask) {
  const fromIndex = findTopLevel(mask, 0, (m, i) => keywordAt(m, i, FROM_KEYWORD));
  if (fromIndex === -1) {
    return null;
  }
  const source = parseTableSource(query, mask, fromIndex + 4);
  if (!source) {
    return null;
  }
  const [parts, end] = source;
  return isRowsetSource(mask, parts, end) || hasMultipleTableSources(mask, end) ? null : parts;
}

/**
 * @param {string} mask - lexical mask
 * @param {number} i - index to test
 * @returns {boolean} whether a CTE-list comma or the CTE body statement is at `i`
 */
function isCteListBoundary(mask, i) {
  return mask[i] === ',' || keywordAt(mask, i, CTE_BODY_STATEMENT);
}

/**
 * Lower-cased names defined by a leading `WITH name [(cols)] AS (...), ...`
 * list; empty when the statement does not start with WITH.
 * @param {string} query - original query text
 * @param {string} mask - lexical mask of `query`
 * @returns {Set<string>} CTE names
 */
function collectCteNames(query, mask) {
  const names = new Set();
  let pos = skipBlank(mask, 0);
  if (mask[pos] === ';') {
    pos = skipBlank(mask, pos + 1);
  }
  if (!keywordAt(mask, pos, WITH_KEYWORD)) {
    return names;
  }
  pos += 4;
  while (pos < mask.length) {
    const start = skipBlank(mask, pos);
    const match = LEADING_IDENTIFIER.exec(query.slice(start));
    if (!match) {
      break;
    }
    names.add(unquoteIdentifierPart(match[0]).toLowerCase());
    const next = findTopLevel(mask, start + match[0].length, isCteListBoundary);
    if (next === -1 || mask[next] !== ',') {
      break;
    }
    pos = next + 1;
  }
  return names;
}

/**
 * @param {string} query - original query text
 * @param {string} mask - lexical mask of `query`
 * @param {string[]} parts - resolved table source name parts
 * @returns {boolean} whether a single-part source names a CTE of the statement
 */
function isCteReference(query, mask, parts) {
  return (
    parts.length === 1 &&
    collectCteNames(query, mask).has(unquoteIdentifierPart(parts[0]).toLowerCase())
  );
}

/**
 * Trim a column token and drop any trailing statement terminator so a query
 * ending in `;` cannot leak it into an index suggestion (#1102).
 * @param {string} token - raw column token from a split clause
 * @returns {string} cleaned token
 */
function stripColumnToken(token) {
  return token.trim().replace(/[\s;]+$/, '');
}

/**
 * Lower-cased, unquoted qualifier of a qualified column (`[t].[name]` -> 't').
 * @param {string[]} parts - column name parts
 * @returns {string} normalised qualifier
 */
function columnQualifier(parts) {
  return parts
    .slice(0, -1)
    .map(p => unquoteIdentifierPart(p).toLowerCase())
    .join('.');
}

/**
 * Reduce ORDER BY / WHERE tokens to index key columns: ordinals and
 * expressions are dropped (they cannot be index keys), the table qualifier is
 * stripped from each plain column, and `mixed` reports qualifiers that name
 * more than one source, which cannot be attributed to a single table (#1102).
 * @param {string[]} tokens - cleaned clause tokens
 * @returns {{ columns: string[], written: string[], mixed: boolean }} key columns
 */
function toIndexKeyColumns(tokens) {
  const qualifiers = new Set();
  const columns = [];
  const written = [];
  for (const token of tokens) {
    if (!PLAIN_COLUMN_PATTERN.test(token)) {
      continue;
    }
    const parts = splitQualifiedName(token);
    written.push(token);
    columns.push(parts.at(-1));
    if (parts.length > 1) {
      qualifiers.add(columnQualifier(parts));
    }
  }
  const keys = { columns, written, mixed: qualifiers.size > 1 };
  return keys;
}

export class QueryOptimizer {
  constructor(connectionManager, config = {}) {
    this.connectionManager = connectionManager;
    this.config = {
      // Complexity score weights
      complexityWeights: {
        joins: 2.0,
        subqueries: 1.5,
        aggregates: 1.2,
        unions: 1.8,
        ctes: 1.3,
        windowFunctions: 2.5,
        ...config.complexityWeights
      },
      // Performance thresholds
      thresholds: {
        slowQueryMs: config.slowQueryMs || 5000,
        highIoReads: config.highIoReads || 10000,
        highCpuMs: config.highCpuMs || 3000,
        lowImpactThreshold: config.lowImpactThreshold || 20,
        mediumImpactThreshold: config.mediumImpactThreshold || 50,
        highImpactThreshold: config.highImpactThreshold || 80,
        ...config.thresholds
      },
      // Feature flags
      features: {
        enableAdvancedAnalysis: config.enableAdvancedAnalysis ?? true,
        enableIndexRecommendations: config.enableIndexRecommendations ?? true,
        enableQueryRewriting: config.enableQueryRewriting ?? true,
        ...config.features
      }
    };
  }

  /**
   * Analyzes a SQL query and provides comprehensive optimization insights
   * @param {string} query - SQL query to analyze
   * @param {object} executionStats - Execution statistics from SQL Server
   * @param {object} planData - Execution plan data
   * @returns {object} Complete query analysis
   */
  analyzeQuery(query, executionStats = {}, planData = {}) {
    // Input validation to prevent null pointer exceptions
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    try {
      const analysis = {
        query: query.trim(),
        query_type: this.determineQueryType(query),
        complexity_score: this.calculateComplexityScore(query),
        estimated_cost: planData.TotalSubtreeCost || 0,
        table_access_methods: this.extractTableAccessMethods(planData),
        join_algorithms: this.extractJoinAlgorithms(planData),
        operators: this.extractOperators(planData),
        bottlenecks: this.identifyBottlenecks(query, executionStats, planData),
        performance_warnings: this.generatePerformanceWarnings(query, executionStats),
        optimization_suggestions: this.generateOptimizationSuggestions(
          query,
          executionStats,
          planData
        ),
        is_modification_query: this.isModificationQuery(query)
      };

      return analysis;
    } catch (error) {
      // Log the error and return a safe fallback analysis
      console.error('Error during query analysis:', error.message);
      return {
        query: query.trim(),
        query_type: 'UNKNOWN',
        complexity_score: 0,
        estimated_cost: 0,
        table_access_methods: [],
        join_algorithms: [],
        operators: [],
        bottlenecks: [],
        performance_warnings: ['Query analysis failed due to parsing error'],
        optimization_suggestions: [],
        is_modification_query: false,
        error: 'Query analysis failed'
      };
    }
  }

  /**
   * Determines the type of SQL query
   * @param {string} query - SQL query
   * @returns {string} Query type classification
   */
  determineQueryType(query) {
    // Null safety check to prevent runtime errors
    if (!query || typeof query !== 'string') {
      return 'UNKNOWN';
    }

    const trimmed = query.trim().toUpperCase();

    if (trimmed.startsWith('SELECT')) {
      if (this.containsJoins(query) && this.containsAggregation(query)) {
        return 'SELECT_WITH_JOIN_AND_AGGREGATION';
      } else if (this.containsJoins(query)) {
        return 'SELECT_WITH_JOIN';
      } else if (this.containsAggregation(query)) {
        return 'SELECT_WITH_AGGREGATION';
      } else if (this.containsSubqueries(query)) {
        return 'SELECT_WITH_SUBQUERY';
      }
      return 'SELECT_SIMPLE';
    } else if (trimmed.startsWith('INSERT')) {
      return 'INSERT';
    } else if (trimmed.startsWith('UPDATE')) {
      return 'UPDATE';
    } else if (trimmed.startsWith('DELETE')) {
      return 'DELETE';
    } else if (trimmed.startsWith('WITH')) {
      return 'CTE_QUERY';
    } else if (trimmed.startsWith('MERGE')) {
      return 'MERGE';
    }

    return 'UNKNOWN';
  }

  /**
   * Calculates query complexity score based on various factors
   * @param {string} query - SQL query
   * @returns {number} Complexity score (0-100)
   */
  calculateComplexityScore(query) {
    // Null safety check to prevent runtime errors
    if (!query || typeof query !== 'string') {
      return 0;
    }

    let score = 1; // Base score
    const upperQuery = query.toUpperCase();

    // Count joins
    const joinCount = (
      upperQuery.match(/\b(INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|JOIN)\b/g) || []
    ).length;
    score += joinCount * this.config.complexityWeights.joins;

    // Count subqueries
    const subqueryCount = this.countSubqueries(query);
    score += subqueryCount * this.config.complexityWeights.subqueries;

    // Count aggregates
    const aggregateCount = (upperQuery.match(/\b(COUNT|SUM|AVG|MIN|MAX|GROUP BY|HAVING)\b/g) || [])
      .length;
    score += aggregateCount * this.config.complexityWeights.aggregates;

    // Count unions
    const unionCount = (upperQuery.match(/\bUNION\b/g) || []).length;
    score += unionCount * this.config.complexityWeights.unions;

    // Count CTEs
    const cteCount = (upperQuery.match(/\bWITH\b/g) || []).length;
    score += cteCount * this.config.complexityWeights.ctes;

    // Count window functions
    const windowFunctionCount = (upperQuery.match(/\bOVER\s*\(/g) || []).length;
    score += windowFunctionCount * this.config.complexityWeights.windowFunctions;

    // Normalize to 0-100 scale (capped at 100)
    return Math.min(Math.round(score), 100);
  }

  /**
   * Identifies potential bottlenecks in query execution
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} List of identified bottlenecks
   */
  identifyBottlenecks(query, stats, planData) {
    const bottlenecks = [];

    // High I/O bottleneck
    if (stats.avg_logical_reads > this.config.thresholds.highIoReads) {
      bottlenecks.push({
        type: 'HIGH_IO',
        severity: 'HIGH',
        description: `High logical reads detected (${stats.avg_logical_reads})`,
        recommendation: 'Consider adding indexes or optimizing WHERE clauses'
      });
    }

    // CPU intensive operations
    if (stats.avg_cpu_time > this.config.thresholds.highCpuMs) {
      bottlenecks.push({
        type: 'CPU_INTENSIVE',
        severity: 'MEDIUM',
        description: `High CPU usage detected (${stats.avg_cpu_time}ms)`,
        recommendation: 'Review query logic and consider indexing strategies'
      });
    }

    // Large table scans
    if (this.hasTableScans(query, planData)) {
      bottlenecks.push({
        type: 'LARGE_TABLE_SCAN',
        severity: 'MEDIUM',
        description: 'Full table scan detected',
        recommendation: 'Consider adding index on frequently queried columns'
      });
    }

    // Inefficient joins
    if (this.hasInfficientJoins(query, planData)) {
      bottlenecks.push({
        type: 'INEFFICIENT_JOIN',
        severity: 'HIGH',
        description: 'Inefficient join algorithm detected',
        recommendation: 'Review join conditions and ensure proper indexing'
      });
    }

    return bottlenecks;
  }

  /**
   * Generates performance warnings based on query analysis
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @returns {array} List of performance warnings
   */
  generatePerformanceWarnings(query, _stats) {
    if (!query || typeof query !== 'string') {
      return [];
    }

    const warnings = [];
    const upperQuery = query.toUpperCase();

    // SELECT * warnings
    if (upperQuery.includes('SELECT *')) {
      warnings.push('SELECT * can impact performance - specify only needed columns');
    }

    // Missing WHERE clause
    if (
      upperQuery.includes('SELECT') &&
      !upperQuery.includes('WHERE') &&
      !upperQuery.includes('JOIN')
    ) {
      warnings.push('Query without WHERE clause may return large result sets');
    }

    // LEFT JOIN with large tables
    if (upperQuery.includes('LEFT JOIN') && this.containsLargeTables(query)) {
      warnings.push('LEFT JOIN with large table may cause performance issues');
    }

    // GROUP BY without covering index
    if (upperQuery.includes('GROUP BY')) {
      warnings.push('GROUP BY operation requires sorting - consider covering index');
    }

    // ORDER BY without index
    if (upperQuery.includes('ORDER BY') && !this.hasOrderByIndex(query)) {
      warnings.push('ORDER BY without supporting index may cause slow sorting');
    }

    // High execution count with slow performance
    if (_stats && _stats.execution_count > 100 && _stats.avg_duration > 1000) {
      warnings.push('Frequently executed slow query - high optimization priority');
    }

    return warnings;
  }

  /**
   * Generates specific optimization suggestions
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} List of optimization suggestions
   */
  generateOptimizationSuggestions(query, stats, _planData) {
    const suggestions = [];

    // Index recommendations
    if (this.config.features.enableIndexRecommendations) {
      const indexSuggestions = this.generateIndexRecommendations(query, stats, _planData);
      suggestions.push(...indexSuggestions);
    }

    // Query rewriting suggestions
    if (this.config.features.enableQueryRewriting) {
      const rewritingSuggestions = this.generateQueryRewritingSuggestions(query, stats);
      suggestions.push(...rewritingSuggestions);
    }

    // Performance tuning suggestions
    const tuningSuggestions = this.generateTuningSuggestions(query, stats, _planData);
    suggestions.push(...tuningSuggestions);

    return suggestions.sort(
      (a, b) => this.prioritySortOrder(a.priority) - this.prioritySortOrder(b.priority)
    );
  }

  /**
   * Generates index optimization recommendations
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} Index recommendations
   */
  generateIndexRecommendations(query, stats, _planData) {
    const suggestions = [];
    const targetTable = this.extractTargetTable(query);

    // Analyze WHERE clauses for index opportunities
    const whereColumns = this.extractWhereColumns(query);
    const whereIndex = this.buildCreateIndexSuggestion(
      `IX_${whereColumns.join('_')}`,
      targetTable,
      whereColumns
    );
    if (whereIndex) {
      const impact = this.calculateIndexImpact(stats, 'WHERE');
      suggestions.push({
        type: 'INDEX_RECOMMENDATION',
        priority: impact > 70 ? 'HIGH' : 'MEDIUM',
        ...whereIndex,
        estimated_improvement: `${Math.round(impact)}% performance gain`,
        reason: 'Optimize WHERE clause filtering'
      });
    }

    // Analyze JOIN conditions
    const joinColumns = this.extractJoinColumns(query);
    if (joinColumns.length > 0) {
      const impact = this.calculateIndexImpact(stats, 'JOIN');
      suggestions.push({
        type: 'INDEX_RECOMMENDATION',
        priority: impact > 60 ? 'HIGH' : 'MEDIUM',
        suggestion: `Consider covering index for JOIN operations on columns: ${joinColumns.join(', ')}`,
        estimated_improvement: `${Math.round(impact)}% performance gain`,
        reason: 'Optimize JOIN performance'
      });
    }

    // Analyze ORDER BY clauses
    const orderByIndex = this.buildCreateIndexSuggestion(
      'IX_OrderBy',
      targetTable,
      this.extractOrderByColumns(query)
    );
    if (orderByIndex) {
      suggestions.push({
        type: 'INDEX_RECOMMENDATION',
        priority: 'MEDIUM',
        ...orderByIndex,
        estimated_improvement: '40% performance gain',
        reason: 'Eliminate sorting overhead for ORDER BY'
      });
    }

    return suggestions;
  }

  /**
   * Builds the CREATE INDEX fields shared by the WHERE and ORDER BY
   * recommendations. Ordinals and expressions are dropped from the key list;
   * if nothing indexable remains, no suggestion is made (null). When the
   * target table is known and every column belongs to it, the statement is
   * valid T-SQL naming that table with bare column names; otherwise the
   * suggestion is explicitly labelled conceptual, keeping the columns as
   * written, instead of carrying a fake or wrong identifier (#1102).
   * @param {string} indexName - index name to emit
   * @param {string|null} targetTable - bracket-quoted table from extractTargetTable
   * @param {string[]} tokens - cleaned clause tokens (columns as written)
   * @returns {{suggestion: string, table?: string, conceptual?: true}|null} fields to merge
   */
  buildCreateIndexSuggestion(indexName, targetTable, tokens) {
    const keys = toIndexKeyColumns(tokens);
    if (keys.columns.length === 0) {
      return null;
    }
    if (targetTable && !keys.mixed) {
      const executable = {
        suggestion: `CREATE INDEX ${indexName} ON ${targetTable} (${keys.columns.join(', ')})`,
        table: targetTable
      };
      return executable;
    }
    const conceptual = {
      suggestion:
        'Conceptual (the target table could not be determined unambiguously from the query): ' +
        `CREATE INDEX ${indexName} ON <table> (${keys.written.join(', ')})`,
      conceptual: true
    };
    return conceptual;
  }

  /**
   * Resolves the single target table of a query as a bracket-quoted,
   * schema-qualified identifier (e.g. `[Imports].[PR_Debtors_P1DEBACCT]`)
   * suitable for CREATE INDEX. The FROM keyword is located on a lexical mask
   * (comments, string literals and quoted/bracketed identifiers blanked out)
   * at parenthesis depth 0, so text inside comments, literals, aliases or
   * subqueries can never be mistaken for the table. Returns null — so callers
   * label suggestions conceptual rather than guess — when the query is
   * malformed, has no FROM, the first FROM is not a plain table (derived table,
   * table-valued or rowset function, CTE name), or the FROM clause has more
   * than one table source (JOIN/APPLY/comma list) (#1102).
   * @param {string} query - SQL query
   * @returns {string|null} bracket-quoted table name, or null
   */
  extractTargetTable(query) {
    if (!isAnalyzableQuery(query)) {
      return null;
    }
    const mask = maskSqlLiteralsAndComments(query);
    if (mask === null) {
      return null;
    }
    const parts = resolveFromSource(query, mask);
    if (!parts || isCteReference(query, mask, parts)) {
      return null;
    }
    return formatQualifiedTable(parts);
  }

  /**
   * Generates query rewriting suggestions
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @returns {array} Query rewriting suggestions
   */
  generateQueryRewritingSuggestions(query, _stats) {
    const suggestions = [];
    const upperQuery = query.toUpperCase();

    // EXISTS vs LEFT JOIN optimization
    if (upperQuery.includes('LEFT JOIN') && this.canUseExists(query)) {
      suggestions.push({
        type: 'QUERY_REWRITE',
        priority: 'MEDIUM',
        suggestion: 'Consider EXISTS instead of LEFT JOIN if you only need users with orders',
        estimated_improvement: '25% performance gain',
        reason: 'EXISTS can be more efficient than LEFT JOIN for existence checks'
      });
    }

    // IN vs EXISTS optimization
    if (upperQuery.includes(' IN (SELECT')) {
      suggestions.push({
        type: 'QUERY_REWRITE',
        priority: 'MEDIUM',
        suggestion: 'Consider replacing IN (SELECT...) with EXISTS for better performance',
        estimated_improvement: '30% performance gain',
        reason: 'EXISTS often performs better than IN with subqueries'
      });
    }

    // DISTINCT optimization
    if (upperQuery.includes('SELECT DISTINCT') && upperQuery.includes('JOIN')) {
      suggestions.push({
        type: 'QUERY_REWRITE',
        priority: 'LOW',
        suggestion: 'Review if DISTINCT is necessary with proper JOIN conditions',
        estimated_improvement: '15% performance gain',
        reason: 'Unnecessary DISTINCT adds overhead'
      });
    }

    return suggestions;
  }

  /**
   * Generates general performance tuning suggestions
   * @param {string} query - SQL query
   * @param {object} stats - Execution statistics
   * @param {object} planData - Execution plan data
   * @returns {array} Tuning suggestions
   */
  generateTuningSuggestions(query, stats, _planData) {
    const suggestions = [];

    // High execution count optimization
    if (stats.execution_count > 500 && stats.avg_duration > 100) {
      suggestions.push({
        type: 'PERFORMANCE_TUNING',
        priority: 'CRITICAL',
        suggestion: 'This frequently executed query needs immediate optimization',
        estimated_improvement: '50% average system performance gain',
        reason: `Query executed ${stats.execution_count} times with ${stats.avg_duration}ms average`
      });
    }

    // Memory optimization
    if (stats.avg_logical_reads > 50000) {
      suggestions.push({
        type: 'MEMORY_OPTIMIZATION',
        priority: 'HIGH',
        suggestion: 'Consider query optimization to reduce memory pressure',
        estimated_improvement: '35% memory usage reduction',
        reason: `High logical reads detected (${stats.avg_logical_reads})`
      });
    }

    // Parameterization suggestion
    if (this.hasLiterals(query)) {
      suggestions.push({
        type: 'PARAMETERIZATION',
        priority: 'MEDIUM',
        suggestion: 'Consider parameterizing literal values for better plan reuse',
        estimated_improvement: '20% compilation overhead reduction',
        reason: 'Hard-coded values prevent plan reuse'
      });
    }

    return suggestions;
  }

  /**
   * Calculates estimated impact of an index recommendation
   * @param {object} stats - Execution statistics
   * @param {string} type - Type of index (WHERE, JOIN, ORDER)
   * @returns {number} Impact percentage (0-100)
   */
  calculateIndexImpact(stats, type) {
    let baseImpact = 30; // Base improvement for any index

    // Factor in current performance metrics
    if (stats.avg_duration > this.config.thresholds.slowQueryMs) {
      baseImpact += 30;
    }

    if (stats.avg_logical_reads > this.config.thresholds.highIoReads) {
      baseImpact += 25;
    }

    if (stats.execution_count > 100) {
      baseImpact += 15; // High-frequency queries benefit more
    }

    // Type-specific adjustments
    switch (type) {
      case 'WHERE':
        baseImpact += 20; // WHERE clause indexes are very effective
        break;
      case 'JOIN':
        baseImpact += 15; // JOIN indexes are moderately effective
        break;
      case 'ORDER':
        baseImpact += 10; // ORDER BY indexes help but less critical
        break;
    }

    return Math.min(baseImpact, 95); // Cap at 95%
  }

  // ==================== HELPER METHODS ====================

  /**
   * Checks if query contains joins
   */
  containsJoins(query) {
    return /\b(INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|JOIN)\b/i.test(query);
  }

  /**
   * Checks if query contains aggregation
   */
  containsAggregation(query, _planData) {
    return /\b(COUNT|SUM|AVG|MIN|MAX|GROUP BY|HAVING)\b/i.test(query);
  }

  /**
   * Checks if query contains subqueries
   */
  containsSubqueries(query, _planData) {
    return /\(\s*SELECT\b/i.test(query);
  }

  /**
   * Counts number of subqueries
   */
  countSubqueries(query) {
    const matches = query.match(/\(\s*SELECT\b/gi);
    return matches ? matches.length : 0;
  }

  /**
   * Checks if query is a modification query
   */
  isModificationQuery(query) {
    return /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(query);
  }

  /**
   * Checks for table scans in execution plan
   */
  hasTableScans(query, _planData) {
    // This would analyze actual execution plan data
    // For now, we'll use heuristics
    if (!query || typeof query !== 'string') {
      return false;
    }
    return !query.toUpperCase().includes('WHERE') && query.toUpperCase().includes('SELECT');
  }

  /**
   * Checks for inefficient joins
   */
  hasInfficientJoins(_query, _planData) {
    // This would analyze execution plan for nested loop joins on large tables
    // For now, return false as placeholder
    return false;
  }

  /**
   * Checks if query contains large tables
   */
  containsLargeTables(_query) {
    // This would require table statistics
    // For now, assume any table could be large
    return true;
  }

  /**
   * Checks if ORDER BY has supporting index
   */
  hasOrderByIndex(_query) {
    // This would require index information
    // For now, assume no supporting index
    return false;
  }

  /**
   * Extracts columns from WHERE clauses
   */
  extractWhereColumns(query) {
    // Input validation and size limit to prevent ReDoS attacks
    if (!query || typeof query !== 'string') {
      return [];
    }

    // Limit query size to prevent ReDoS attacks
    if (query.length > 10000) {
      // Only log warning in production, suppress during testing
      if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        console.warn('Query too large for WHERE clause analysis, skipping');
      }
      return [];
    }

    const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+HAVING|$)/i);
    if (!whereMatch) return [];

    // Simple extraction - would need more sophisticated parsing for production
    const whereClause = whereMatch[1];
    const columns = [];

    // Extract column names using a safer approach without sanitization
    // Match column names that appear before comparison operators
    const patterns = [
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*>=/g, // >= operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*<=/g, // <= operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*!=/g, // != operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*<>/g, // <> operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g, // = operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*>/g, // > operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*</g, // < operator
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*!/g // ! operator (for NOT patterns)
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(whereClause)) !== null) {
        const columnName = stripColumnToken(match[1]);
        if (columnName && !columns.includes(columnName)) {
          columns.push(columnName);
        }
      }
    });

    return columns;
  }

  /**
   * Extracts columns from JOIN conditions
   */
  extractJoinColumns(query) {
    // Input validation and size limit to prevent ReDoS attacks
    if (!query || typeof query !== 'string') {
      return [];
    }

    // Limit query size to prevent ReDoS attacks
    if (query.length > 10000) {
      // Only log warning in production, suppress during testing
      if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        console.warn('Query too large for JOIN analysis, skipping');
      }
      return [];
    }

    const joinMatches = query.match(
      /JOIN\s+\w+\s+\w+\s+ON\s+(.+?)(?:\s+WHERE|\s+GROUP|\s+ORDER|$)/gi
    );
    const columns = [];

    if (joinMatches) {
      joinMatches.forEach(joinMatch => {
        const onClause = joinMatch.replace(/.*ON\s+/i, '');
        const columnMatches = onClause.match(
          /\b([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\b/g
        );
        if (columnMatches) {
          columns.push(...columnMatches);
        }
      });
    }

    return [...new Set(columns)]; // Remove duplicates
  }

  /**
   * Extracts columns from ORDER BY clause
   */
  extractOrderByColumns(query) {
    // Stop at the clauses that may legally follow ORDER BY (pagination, FOR
    // XML/JSON, query hints) or at the statement terminator (#1102).
    const orderByMatch = query.match(
      /ORDER\s+BY\s+(.+?)(?:\s+LIMIT\b|\s+OFFSET\b|\s+FETCH\b|\s+FOR\b|\s+OPTION\b|\s*;|\s*$)/i
    );
    if (!orderByMatch) return [];

    const columns = orderByMatch[1]
      .split(',')
      .map(stripColumnToken)
      .map(col => col.replace(/\s+(ASC|DESC)$/i, ''))
      .filter(col => col.length > 0);

    return columns;
  }

  /**
   * Checks if LEFT JOIN can be replaced with EXISTS
   */
  canUseExists(query) {
    // Simple heuristic: if LEFT JOIN is used just for existence check
    if (!query || typeof query !== 'string') {
      return false;
    }
    return (
      query.toUpperCase().includes('LEFT JOIN') &&
      !query.toUpperCase().includes('SELECT') &&
      /\.\*/.test(query.toUpperCase())
    );
  }

  /**
   * Checks if query has hard-coded literals
   */
  hasLiterals(query) {
    // Check for string literals and numeric literals
    return /'[^']*'/.test(query) || /\b\d+\b/.test(query);
  }

  /**
   * Extracts table access methods from execution plan
   */
  extractTableAccessMethods(_planData) {
    // This would parse actual execution plan XML/JSON
    // For now, return mock data structure
    return [];
  }

  /**
   * Extracts join algorithms from execution plan
   */
  extractJoinAlgorithms(_planData) {
    // This would parse actual execution plan data
    return [];
  }

  /**
   * Extracts operators from execution plan
   */
  extractOperators(_planData) {
    // This would parse execution plan operators
    return [];
  }

  /**
   * Gets priority sort order for suggestions
   */
  prioritySortOrder(priority) {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return order[priority] || 999;
  }

  /**
   * Analyzes index usage patterns and provides recommendations
   * @param {string} database - Database name to analyze
   * @returns {object} Index analysis and recommendations
   */
  async analyzeIndexUsage(database, { limit = 10, impactThreshold = 0, schema = null } = {}) {
    const pool = await acquirePool(this.connectionManager);

    const safeDb = sanitizeDbName(database);
    const dbPredicate = safeDb ? `DB_ID(N'${safeDb}')` : 'DB_ID()';
    const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 10));

    // Optional schema filter. The missing-index DMVs expose the object id, and
    // OBJECT_SCHEMA_NAME(object_id, database_id) resolves the owning schema, so
    // we can filter to a specific schema honestly in SQL (applied before TOP so
    // the limit caps the filtered set). sanitizeDbName doubles single quotes and
    // rejects brackets, keeping the value safe inside the N'...' literal.
    let safeSchema = null;
    if (schema) {
      try {
        safeSchema = sanitizeDbName(schema);
      } catch {
        // sanitizeDbName is shared with the database param; rethrow so the
        // message names the parameter the caller actually passed.
        throw new TypeError(`Invalid schema name: ${schema}`);
      }
    }
    const schemaPredicate = safeSchema
      ? ` AND OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id) = N'${safeSchema}'`
      : '';

    const result = await pool.request().query(`
      SELECT TOP (${safeLimit})
        OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id) AS schema_name,
        OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
        mid.equality_columns,
        mid.inequality_columns,
        mid.included_columns,
        migs.user_seeks,
        migs.user_scans,
        migs.avg_user_impact,
        CONVERT(decimal(18,2),
          migs.avg_total_user_cost * migs.avg_user_impact
          * (migs.user_seeks + migs.user_scans)) AS impact_score
      FROM sys.dm_db_missing_index_group_stats migs
      INNER JOIN sys.dm_db_missing_index_groups mig
        ON migs.group_handle = mig.index_group_handle
      INNER JOIN sys.dm_db_missing_index_details mid
        ON mig.index_handle = mid.index_handle
      WHERE mid.database_id = ${dbPredicate}${schemaPredicate}
      ORDER BY impact_score DESC
    `);

    const parseCols = csv =>
      csv
        ? csv
            .split(',')
            .map(c => c.trim().replaceAll(/^\[|\]$/g, ''))
            .filter(Boolean)
        : [];

    const recommendations = (result.recordset || [])
      .filter(r => (r.avg_user_impact ?? 0) >= impactThreshold)
      .map(r => {
        const keyColumns = [...parseCols(r.equality_columns), ...parseCols(r.inequality_columns)];
        const includedColumns = parseCols(r.included_columns);
        const includeClause = includedColumns.length
          ? ` INCLUDE (${includedColumns.join(', ')})`
          : '';
        // Qualify the ON-target with the recommendation's schema so the DDL
        // targets <schema>.<table>, not dbo.<table>, now that schema filtering
        // surfaces cross-schema recommendations. schema_name/table_name are
        // trusted catalog values (OBJECT_SCHEMA_NAME/OBJECT_NAME); bracket-escape
        // them for defense-in-depth. Include the schema in the index name too so
        // two schemas sharing a table name don't collide.
        const schemaName = r.schema_name ?? 'dbo';
        const onTarget = `[${escapeBracketIdentifier(schemaName)}].[${escapeBracketIdentifier(
          r.table_name
        )}]`;
        return {
          type: 'missing_index',
          priority: indexPriority(r.avg_user_impact),
          schema: r.schema_name,
          table: r.table_name,
          columns: keyColumns,
          includedColumns,
          avgUserImpact: r.avg_user_impact,
          userSeeks: r.user_seeks,
          userScans: r.user_scans,
          impactScore: r.impact_score,
          suggestion: `CREATE INDEX IX_${schemaName}_${r.table_name}_missing ON ${onTarget} (${keyColumns.join(
            ', '
          )})${includeClause}`
        };
      });

    // Only return what we actually computed. Missing-index recommendations come
    // from the DMVs above; unused/duplicate/fragmented-index analysis is not yet
    // implemented and is intentionally omitted rather than reported as empty
    // (which would read as "analyzed, none found").
    return {
      database: database || null,
      schema: schema || null,
      timestamp: new Date().toISOString(),
      recommendations
    };
  }

  /**
   * Provides aggregate optimization insights for a database: missing-index
   * summary plus a count of expensive queries, with a prioritized roadmap.
   *
   * Note: the get_optimization_insights tool declares an `analysis_period`
   * (24h/7d/30d) that this method does not accept. The two DMV sources have
   * different time semantics: the missing-index DMVs (sys.dm_db_missing_index_*)
   * are cumulative aggregates with no per-event history and cannot be windowed,
   * whereas sys.dm_exec_query_stats does carry last_execution_time. Windowing
   * only the expensive-query half while the missing-index half stayed all-time
   * would produce an inconsistent, misleading result, so the parameter is
   * deferred pending a consistent time-windowed source rather than partially
   * applied.
   * @param {string} database - Database name
   * @returns {object} Optimization insights
   */
  async getOptimizationInsights(database) {
    const pool = await acquirePool(this.connectionManager);

    const indexAnalysis = await this.analyzeIndexUsage(database, { limit: 100 });

    const safeDb = sanitizeDbName(database);
    const dbPredicate = safeDb ? `qt.dbid = DB_ID(N'${safeDb}')` : '1 = 1';
    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS expensive_query_count
      FROM sys.dm_exec_query_stats qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
      WHERE ${dbPredicate}
        AND qs.total_worker_time / qs.execution_count >= 1000000
    `);

    const missingIndexCount = indexAnalysis.recommendations.length;
    const highImpactIndexCount = indexAnalysis.recommendations.filter(
      r => r.priority === 'high'
    ).length;
    const expensiveQueryCount = countResult.recordset?.[0]?.expensive_query_count ?? 0;

    const roadmap = [];
    if (highImpactIndexCount > 0) {
      roadmap.push({
        priority: 'high',
        action: `Add ${highImpactIndexCount} high-impact missing index(es)`
      });
    }
    if (expensiveQueryCount > 0) {
      roadmap.push({
        priority: 'medium',
        action: `Review ${expensiveQueryCount} expensive query(ies) (>1s avg CPU)`
      });
    }
    if (roadmap.length === 0) {
      // These DMVs are populated from cache and reset on restart/recompile/
      // memory pressure, so an empty result is "nothing in cache", which is not
      // the same as "the database is healthy". Say so honestly.
      roadmap.push({
        priority: 'info',
        action:
          'No missing-index or expensive-query signals found in the DMV cache. ' +
          'This may indicate a healthy workload or simply a cold/recently-cleared cache.'
      });
    }

    return {
      database: database || null,
      timestamp: new Date().toISOString(),
      summary: { missingIndexCount, highImpactIndexCount, expensiveQueryCount },
      recommendations: indexAnalysis.recommendations.slice(0, 10),
      roadmap
    };
  }
}
