import { describe, it, expect, vi, afterEach } from 'vitest';
import { dndPayload, inDndWindow } from './dnd.js';

afterEach(() => vi.restoreAllMocks());

describe('dndPayload', () => {
  it('uses the offset at evaluation time and carries the IANA zone', () => {
    const prefs = { enabled: true, start: '22:00', end: '07:00' };
    const date = new Date('2026-01-15T12:00:00Z');
    const offset = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);

    expect(dndPayload(prefs, date)).toMatchObject({ startUtc: '22:00', endUtc: '07:00' });

    // Simulate a DST shift: same saved prefs, different offset now.
    offset.mockReturnValue(120);
    expect(dndPayload(prefs, date)).toMatchObject({
      startUtc: '00:00',
      endUtc: '09:00',
      start: '22:00',
      end: '07:00',
      timeZone: expect.any(String),
    });
  });

  it('returns null when disabled', () => {
    expect(dndPayload({ enabled: false, start: '22:00', end: '07:00' })).toBeNull();
  });
});

describe('inDndWindow', () => {
  const prefs = { enabled: true, start: '22:00', end: '07:00' };

  it('matches a window that wraps past midnight', () => {
    expect(inDndWindow(prefs, new Date(2026, 0, 1, 23, 0))).toBe(true);
    expect(inDndWindow(prefs, new Date(2026, 0, 1, 6, 59))).toBe(true);
    expect(inDndWindow(prefs, new Date(2026, 0, 1, 12, 0))).toBe(false);
  });
});
