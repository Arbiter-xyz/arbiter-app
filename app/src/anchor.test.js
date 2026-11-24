import { describe, it, expect, vi, afterEach } from 'vitest';
import { pollTransaction } from './anchor.js';

const config = { transferServer: 'https://anchor.example' };
const jwt = 'test-jwt';
const id = 'tx-1';

afterEach(() => vi.unstubAllGlobals());

function stubStatus(status) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ transaction: { id, status } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('pollTransaction', () => {
  it.each([
    'pending_user_transfer_start',
    'completed',
    'error',
    'refunded',
    'expired',
    'no_market',
    'too_small',
    'too_large',
  ])('resolves on the first poll for terminal status %s', async (status) => {
    const fetchMock = stubStatus(status);
    const onUpdate = vi.fn();
    const tx = await pollTransaction(config, jwt, id, onUpdate);
    expect(tx.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately on a 401 instead of polling until timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(pollTransaction(config, jwt, id, vi.fn())).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
