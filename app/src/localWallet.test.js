import { describe, it, expect } from 'vitest';
import { createOrLoadLocalWallet } from './localWallet.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('createOrLoadLocalWallet', () => {
  it('returns the same address on repeated calls against the same storage', async () => {
    const storage = memoryStorage();
    const { address: first } = await createOrLoadLocalWallet(storage).getAddress();
    const { address: second } = await createOrLoadLocalWallet(storage).getAddress();
    expect(first).toMatch(/^G[A-Z2-7]{55}$/);
    expect(second).toBe(first);
  });

  it('generates distinct addresses for separate storages', async () => {
    const a = await createOrLoadLocalWallet(memoryStorage()).getAddress();
    const b = await createOrLoadLocalWallet(memoryStorage()).getAddress();
    expect(a.address).not.toBe(b.address);
  });
});
