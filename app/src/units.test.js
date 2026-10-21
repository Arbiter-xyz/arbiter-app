import { describe, it, expect } from 'vitest';
import { stroopsFromUsdcInput, usdcFromStroops } from './units.js';

describe('stroopsFromUsdcInput', () => {
  it('converts whole numbers', () => {
    expect(stroopsFromUsdcInput('1')).toBe(10_000_000n);
    expect(stroopsFromUsdcInput('0')).toBe(0n);
  });

  it('converts fractional amounts', () => {
    expect(stroopsFromUsdcInput('1.5')).toBe(15_000_000n);
    expect(stroopsFromUsdcInput(' 2.25 ')).toBe(22_500_000n);
  });

  it('accepts exactly 7 decimal places', () => {
    expect(stroopsFromUsdcInput('0.0000001')).toBe(1n);
    expect(stroopsFromUsdcInput('1.2345678')).toBe(12_345_678n);
  });

  it('rejects 8+ decimal places', () => {
    expect(() => stroopsFromUsdcInput('0.00000001')).toThrow();
  });

  it.each(['', 'abc', '-1', '1.', '.5', '1e3', '1,5'])('rejects invalid input %j', (v) => {
    expect(() => stroopsFromUsdcInput(v)).toThrow();
  });
});

describe('usdcFromStroops', () => {
  it('formats with 7 decimals', () => {
    expect(usdcFromStroops(15_000_000n)).toBe('1.5000000');
    expect(usdcFromStroops(1n)).toBe('0.0000001');
    expect(usdcFromStroops('0')).toBe('0.0000000');
  });

  it.each(['0', '1', '1.5', '0.0000001', '123456.7654321'])('round-trips %s', (v) => {
    expect(stroopsFromUsdcInput(usdcFromStroops(stroopsFromUsdcInput(v)))).toBe(
      stroopsFromUsdcInput(v),
    );
  });
});
