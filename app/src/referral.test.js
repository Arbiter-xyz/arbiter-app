import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// referral.js runs captureReferralCode() and initReferralPanel() at import time.
// Stub the DOM/location globals before importing so the module doesn't throw
// in the node test environment.
vi.stubGlobal('location', { search: '' });
vi.stubGlobal('document', {
  getElementById: vi.fn(() => null),
});

const { copyReferralLink } = await import('./referral.js');

describe('copyReferralLink', () => {
  let input;
  let stats;

  beforeEach(() => {
    input = {
      value: 'https://example.com/?ref=ABC123',
      select: vi.fn(),
    };
    stats = {
      textContent: '',
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes to the clipboard on the success path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyReferralLink(input, stats);

    expect(writeText).toHaveBeenCalledWith(input.value);
    expect(input.select).not.toHaveBeenCalled();
    expect(stats.textContent).toContain('copied');
  });

  it('falls back to select() when the Clipboard API rejects (#319)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyReferralLink(input, stats);

    expect(writeText).toHaveBeenCalledWith(input.value);
    expect(input.select).toHaveBeenCalledTimes(1);
    expect(stats.textContent).toContain('Copy failed');
  });

  it('falls back to select() when navigator.clipboard is undefined (insecure context)', async () => {
    vi.stubGlobal('navigator', {});

    await copyReferralLink(input, stats);

    expect(input.select).toHaveBeenCalledTimes(1);
    expect(stats.textContent).toContain('Copy failed');
  });
});