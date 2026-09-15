import { describe, it, expect } from 'vitest';
import { CSV_ROW_TERMINATOR, csvEscapeCell, csvRow } from '../../lib/utils/csv.js';

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
});
