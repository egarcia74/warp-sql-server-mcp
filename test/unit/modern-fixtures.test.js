import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectValidToolResponse } from './fixtures/modern-fixtures.js';

const textResponse = text => [{ type: 'text', text }];

afterEach(() => vi.restoreAllMocks());

describe('expectValidToolResponse', () => {
  it('accepts an own success property even when its value is false', () => {
    expect(expectValidToolResponse(textResponse('{"success":false}'))).toEqual({ success: false });
  });

  it('rejects a response without a success property', () => {
    expect(() => expectValidToolResponse(textResponse('{}'))).toThrow(
      'Response missing success property'
    );
  });

  it('rejects an inherited success property', () => {
    const parsed = Object.create({ success: true });
    vi.spyOn(JSON, 'parse').mockReturnValueOnce(parsed);

    expect(() => expectValidToolResponse(textResponse('{}'))).toThrow(
      'Response missing success property'
    );
  });

  it('accepts an own success property on a null-prototype object', () => {
    const parsed = Object.assign(Object.create(null), { success: false });
    vi.spyOn(JSON, 'parse').mockReturnValueOnce(parsed);

    expect(expectValidToolResponse(textResponse('{}'))).toBe(parsed);
  });
});
