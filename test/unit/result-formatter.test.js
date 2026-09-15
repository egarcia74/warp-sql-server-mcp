import { describe, it, expect } from 'vitest';
import {
  formatCell,
  formatQueryResults,
  createTextTable
} from '../../lib/utils/result-formatter.js';
import { BaseToolHandler } from '../../lib/tools/handlers/base-handler.js';

// Neither formatter had any test. Both inlined `String(row[header] || '')`, so a cell
// holding 0, false or 0.0 rendered as an empty string - identical to NULL - in the default
// output of every tool. A COUNT(*) of zero read as "no data".
describe('result formatting', () => {
  describe('formatCell', () => {
    it('renders falsy VALUES, collapsing only null and undefined', () => {
      expect(formatCell(0)).toBe('0');
      expect(formatCell(false)).toBe('false');
      expect(formatCell(0.0)).toBe('0');
      expect(formatCell('')).toBe('');

      expect(formatCell(null)).toBe('');
      expect(formatCell(undefined)).toBe('');
    });

    it('renders ordinary values unchanged', () => {
      expect(formatCell(42)).toBe('42');
      expect(formatCell('text')).toBe('text');
      expect(formatCell(true)).toBe('true');
    });
  });

  describe('formatQueryResults', () => {
    it('shows a zero count rather than a blank cell', () => {
      // The symptom that exposed this: SELECT COUNT(*) returning 0 displayed nothing,
      // which reads as NULL - and COUNT(*) can never be NULL.
      const text = formatQueryResults([{ fk_count: 0 }]).content[0].text;
      const dataRow = text.split('\n')[2];

      expect(dataRow.trim()).toBe('0');
      expect(dataRow.trim()).not.toBe('');
    });

    it('distinguishes false from NULL', () => {
      const text = formatQueryResults([{ flag: false, missing: null }]).content[0].text;
      const cells = text
        .split('\n')[2]
        .split('|')
        .map(c => c.trim());

      expect(cells[0]).toBe('false');
      expect(cells[1]).toBe('');
    });

    it('reports an empty recordset distinctly', () => {
      expect(formatQueryResults([]).content[0].text).toBe('No data returned');
    });
  });

  describe('one table formatter', () => {
    // BaseToolHandler carried a byte-identical copy of createTextTable and its own
    // formatAsTable. Testing one said nothing about the other, so they drifted together
    // into the same bug. This asserts they are now the same code path.
    const awkward = [
      { zero: 0, flag: false, name: 'x', nothing: null },
      { zero: 7, flag: true, name: 'yy', nothing: 'set' }
    ];

    it('produces identical output from both entry points', () => {
      const viaModule = formatQueryResults(awkward).content[0].text;
      const viaHandler = BaseToolHandler.prototype.formatAsTable.call(
        BaseToolHandler.prototype,
        awkward
      )[0].text;

      expect(viaHandler).toBe(viaModule);
    });

    it('pads columns to the widest cell, header included', () => {
      const table = createTextTable(
        ['id', 'value'],
        [
          ['1', 'a'],
          ['22', 'bbbb']
        ]
      );
      const [header, separator, first] = table.split('\n');

      expect(header).toBe('id | value');
      expect(separator).toBe('-- | -----');
      expect(first).toBe('1  | a    ');
    });
  });
});
