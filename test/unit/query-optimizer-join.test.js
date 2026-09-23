import { describe, it, expect } from 'vitest';
import { QueryOptimizer } from '../../lib/analysis/query-optimizer.js';

const optimizer = new QueryOptimizer();

describe('JOIN column extraction compatibility', () => {
  it.each([
    ['ordinary aliases', 'JOIN B b ON a.id=b.id', ['a.id', 'b.id']],
    ['case-insensitive keywords', 'join B b on A.id=b.ID', ['A.id', 'b.ID']],
    ['embedded JOIN', 'ADJOIN B b ON a.id=b.id', ['a.id', 'b.id']],
    ['qualified tables', 'JOIN dbo.B b ON a.id=b.id', []],
    ['missing aliases', 'JOIN B ON a.id=b.id', []],
    ['empty conditions', 'JOIN B b ON ', []],
    ['whitespace conditions', 'JOIN B b ON   ', []],
    ['keyword prefixes', 'JOIN B b ON a.id=b.id WHEREVER c.id=1', ['a.id', 'b.id']],
    ['newline before suffix', 'JOIN B b ON a.id=b.id\nWHERE c.id=1', ['a.id', 'b.id']],
    ['newline inside condition', 'JOIN B b ON a.id=b.id\nAND c.id=1', []],
    ['backtracking ON whitespace', 'JOIN B b ON  \nWHERE x\nfoo', []],
    ['overlapping JOIN headers', 'JOIN JOIN a ON ON\n x.id=y.id', ['x.id', 'y.id']],
    [
      'last ON on the same line',
      'JOIN B b ON a.id=b.id JOIN C c ON b.other=c.id',
      ['b.other', 'c.id']
    ],
    ['embedded ON', 'JOIN B b ON a.id=b.id XON c.id=d.id', ['c.id', 'd.id']],
    [
      'first line containing ON',
      'JOIN ON\nb ON a.id=b.id ON c.id=d.id',
      ['a.id', 'b.id', 'c.id', 'd.id']
    ],
    [
      'case-sensitive deduplication across matches',
      'JOIN B b ON a.id=b.id AND a.id=B.id WHERE JOIN C c ON b.id=c.id',
      ['a.id', 'b.id', 'B.id', 'c.id']
    ],
    ['ASCII column tokens', 'JOIN B b ON _a.id=1b.id AND a.1id=a.$id', ['_a.id']],
    ['semicolon inside condition', 'JOIN B b ON a.id=b.id; c.id=1', ['a.id', 'b.id', 'c.id']]
  ])('preserves %s', (_name, query, expected) => {
    expect(optimizer.extractJoinColumns(query)).toEqual(expected);
  });

  it.each(['\n', '\r', '\r\n', '\u2028', '\u2029'])(
    'does not treat trailing %j as the end of the condition',
    terminator => {
      expect(optimizer.extractJoinColumns(`JOIN B b ON a.id=b.id${terminator}`)).toEqual([]);
    }
  );

  it.each([null, undefined, '', 42, {}, []])('rejects invalid input %j', query => {
    expect(optimizer.extractJoinColumns(query)).toEqual([]);
  });

  it('analyzes 10,000 characters and skips 10,001 characters', () => {
    const query = 'JOIN B b ON a.id=b.id'.padStart(10_000, ' ');
    expect(optimizer.extractJoinColumns(query)).toEqual(['a.id', 'b.id']);
    expect(optimizer.extractJoinColumns(query + 'x')).toEqual([]);
  });
});

describe('JOIN extraction CPU bounds', () => {
  it.each([
    [
      'condition suffix whitespace',
      'JOIN B b ON a.id=b.id'.padEnd(9999, ' ') + 'x',
      ['a.id', 'b.id']
    ],
    ['ON whitespace with no valid ending', `JOIN B b ON ${' '.repeat(1000)}!\nX`, []],
    ['long line before ON', `JOIN ${'x'.repeat(9800)}\nb ON a.id=b.id`, ['a.id', 'b.id']]
  ])('bounds CPU work for %s', (_name, query, expected) => {
    optimizer.extractJoinColumns('JOIN B b ON a.id=b.id');
    const start = process.cpuUsage();
    let columns;
    for (let attempt = 0; attempt < 3; attempt++) {
      columns = optimizer.extractJoinColumns(query);
    }
    const elapsed = process.cpuUsage(start);

    expect(columns).toEqual(expected);
    // CPU time excludes scheduler delays. Three capped inputs leave a generous
    // margin for coverage instrumentation while exposing either quadratic scan.
    expect(elapsed.user + elapsed.system).toBeLessThan(100_000);
  });
});
