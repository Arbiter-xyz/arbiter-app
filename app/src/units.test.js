import { describe, it, expect } from 'vitest';
import {
  stroopsFromUsdcInput,
  usdcFromStroops,
  boundAnchorWithdrawalAmount,
} from './units.js';

describe('stroopsFromUsdcInput', () => {
  it('parses whole and fractional amounts into stroops', () => {
    expect(stroopsFromUsdcInput('1')).toBe(10_000_000n);
    expect(stroopsFromUsdcInput('1.5')).toBe(15_000_000n);
    expect(stroopsFromUsdcInput('0.0000001')).toBe(1n);
  });

  it('rejects malformed input', () => {
    expect(() => stroopsFromUsdcInput('abc')).toThrow();
    expect(() => stroopsFromUsdcInput('-1')).toThrow();
    expect(() => stroopsFromUsdcInput('1.12345678')).toThrow();
  });
});

describe('usdcFromStroops', () => {
  it('formats stroops back into a USDC string', () => {
    expect(usdcFromStroops(10_000_000n)).toBe('1.0000000');
    expect(usdcFromStroops(15_000_000n)).toBe('1.5000000');
    expect(usdcFromStroops(1n)).toBe('0.0000001');
  });
});

describe('boundAnchorWithdrawalAmount', () => {
  it('returns the stroop amount when anchor equals approved', () => {
    expect(boundAnchorWithdrawalAmount(10_000_000n, 10_000_000n)).toBe(
      10_000_000n,
    );
  });

  it('returns the stroop amount when anchor is below approved', () => {
    expect(boundAnchorWithdrawalAmount(5_000_000n, 10_000_000n)).toBe(
      5_000_000n,
    );
  });

  it('accepts string and bigint inputs', () => {
    expect(boundAnchorWithdrawalAmount('10000000', '10000000')).toBe(
      10_000_000n,
    );
    expect(boundAnchorWithdrawalAmount(10_000_000n, '10000000')).toBe(
      10_000_000n,
    );
    expect(boundAnchorWithdrawalAmount('10000000', 10_000_000n)).toBe(
      10_000_000n,
    );
  });

  it('throws when anchor exceeds the approved amount', () => {
    expect(() =>
      boundAnchorWithdrawalAmount(10_000_001n, 10_000_000n),
    ).toThrow(/refusing to sign/);
  });

  it('throws on a zero anchor amount', () => {
    expect(() => boundAnchorWithdrawalAmount(0n, 10_000_000n)).toThrow(
      /non-positive/,
    );
  });

  it('throws on a negative anchor amount', () => {
    expect(() => boundAnchorWithdrawalAmount(-1n, 10_000_000n)).toThrow(
      /non-positive/,
    );
  });

  it('throws the invalid error on non-numeric input', () => {
    expect(() => boundAnchorWithdrawalAmount('1.5', 10_000_000n)).toThrow(
      /invalid withdrawal amount/,
    );
    expect(() => boundAnchorWithdrawalAmount('abc', 10_000_000n)).toThrow(
      /invalid withdrawal amount/,
    );
  });
});
