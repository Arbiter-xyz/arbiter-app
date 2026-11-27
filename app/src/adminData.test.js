import { describe, it, expect } from 'vitest';
import { formatStroopsUsdc, fraudCandidates } from './adminData.js';

describe('formatStroopsUsdc (#451)', () => {
  it('renders a single stroop exactly instead of rounding to 0.00', () => {
    expect(formatStroopsUsdc('1')).toBe('0.0000001');
    expect(formatStroopsUsdc(1n)).toBe('0.0000001');
  });

  it('never rounds sub-cent amounts', () => {
    expect(formatStroopsUsdc('49999')).toBe('0.0049999');
    expect(formatStroopsUsdc('123456789')).toBe('12.3456789');
  });

  it('trims trailing zeros but keeps two decimals', () => {
    expect(formatStroopsUsdc('125000000')).toBe('12.50');
    expect(formatStroopsUsdc('10000000')).toBe('1.00');
    expect(formatStroopsUsdc('0')).toBe('0.00');
  });

  it('handles amounts beyond Number precision', () => {
    expect(formatStroopsUsdc('900719925474099312345')).toBe('90071992547409.9312345');
  });

  it('renders missing or malformed amounts as a dash', () => {
    expect(formatStroopsUsdc(undefined)).toBe('—');
    expect(formatStroopsUsdc(null)).toBe('—');
    expect(formatStroopsUsdc('')).toBe('—');
    expect(formatStroopsUsdc('not-a-number')).toBe('—');
  });
});

describe('fraudCandidates (#450)', () => {
  const workers = [
    { workerId: 'A', established: true, matchRatio: 0.4 },
    { workerId: 'B', established: true, matchRatio: 0.9 },
    { workerId: 'C', established: true, matchRatio: 0.1 },
    { workerId: 'D', established: false, matchRatio: 0.2 },
    { workerId: 'E', established: true, matchRatio: null },
    { workerId: 'F', established: true, matchRatio: 0.5 },
  ];

  it('lists established workers below the threshold, lowest first', () => {
    expect(fraudCandidates(workers, 0.5).map((w) => w.workerId)).toEqual(['C', 'A']);
  });

  it('re-filters when the threshold changes', () => {
    expect(fraudCandidates(workers, 0.95).map((w) => w.workerId)).toEqual(['C', 'A', 'F', 'B']);
    expect(fraudCandidates(workers, 0).map((w) => w.workerId)).toEqual([]);
  });
});
