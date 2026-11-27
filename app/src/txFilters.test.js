import { describe, it, expect } from 'vitest';
import { parseDay, parseAmount } from './txFilters.js';

describe('parseDay', () => {
  it('resolves a date input to the last millisecond of that local day', () => {
    const result = parseDay('2024-03-15', true);
    const expected = new Date(2024, 2, 15, 23, 59, 59, 999).getTime();
    expect(result).toBe(expected);
  });

  it('uses local timezone, not UTC, for the end-of-day boundary', () => {
    const result = parseDay('2024-01-01', true);
    const localEnd = new Date(2024, 0, 1, 23, 59, 59, 999).getTime();
    expect(result).toBe(localEnd);
  });

  it('handles a leap day correctly', () => {
    const result = parseDay('2024-02-29', true);
    const expected = new Date(2024, 1, 29, 23, 59, 59, 999).getTime();
    expect(result).toBe(expected);
  });

  it('returns null/undefined for empty input', () => {
    expect(parseDay('')).toBeFalsy();
    expect(parseDay(null)).toBeFalsy();
    expect(parseDay(undefined)).toBeFalsy();
  });
});

describe('parseAmount', () => {
  it('parses a whole-USDC string into BigInt stroops', () => {
    expect(parseAmount('100')).toBe(1_000_000_000n);
  });

  it('parses the zero boundary', () => {
    expect(parseAmount('0')).toBe(0n);
    expect(parseAmount('0.0000001')).toBe(1n);
  });

  it('parses a large value beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    const big = '9007199254740993';
    expect(parseAmount(big)).toBe(9007199254740993n * 10_000_000n);
  });

  it('returns falsy for empty input', () => {
    expect(parseAmount('')).toBeFalsy();
    expect(parseAmount(null)).toBeFalsy();
    expect(parseAmount(undefined)).toBeFalsy();
  });

  it('returns falsy for non-numeric input', () => {
    expect(parseAmount('abc')).toBeFalsy();
  });
});
