// Shared wallet session primitive for the buyer dashboard and worker console
// (issues #143, #144, #208).
//
// Proves control of a Stellar address once via a challenge XDR signed with
// signTransaction(), then caches and reuses the resulting bearer token until
// 60 seconds before expiry.

import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';

const DEFAULT_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const EXPIRY_BUFFER_MS = 60_000;

// In-memory cache keyed by `${role}:${address}` so switching views or
// re-invoking ensureSession() for an already-authenticated address reuses the
// active token without prompting the wallet a second time.
const sessionCache = new Map();

export function clearCachedSession(address, role = 'payers') {
  if (!address) {
    sessionCache.clear();
    return;
  }
  sessionCache.delete(`${role}:${address}`);
}

export async function ensureSession({
  address,
  activeWallet,
  sessionToken = null,
  sessionExpiresAt = 0,
  onSession,
  log,
  role = 'payers',
  backendUrl = DEFAULT_BACKEND_URL,
  networkPassphrase = WalletNetwork.TESTNET,
} = {}) {
  if (!address) throw new Error('No wallet address connected');

  const now = Date.now();
  if (sessionToken && now < sessionExpiresAt - EXPIRY_BUFFER_MS) {
    return sessionToken;
  }

  const cacheKey = `${role}:${address}`;
  const cached = sessionCache.get(cacheKey);
  if (cached && now < cached.expiresAt - EXPIRY_BUFFER_MS) {
    onSession?.(cached);
    return cached.token;
  }

  if (!activeWallet || typeof activeWallet.signTransaction !== 'function') {
    throw new Error('No active wallet available to sign session challenge');
  }

  log?.('Proving control of your address (one signature)…');
  const challengeRes = await fetch(`${backendUrl}/${role}/${address}/session/challenge`, {
    method: 'POST',
  });
  if (!challengeRes.ok) {
    const errBody = await challengeRes.json().catch(() => ({}));
    throw new Error(errBody.error || 'failed to get session challenge');
  }
  const { xdr } = await challengeRes.json();

  const { signedTxXdr } = await activeWallet.signTransaction(xdr, {
    address,
    networkPassphrase,
  });

  const sessionRes = await fetch(`${backendUrl}/${role}/${address}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  if (!sessionRes.ok) {
    const errBody = await sessionRes.json().catch(() => ({}));
    throw new Error(errBody.error || 'failed to establish session');
  }

  const { token, expiresAt } = await sessionRes.json();
  const entry = { token, expiresAt };
  sessionCache.set(cacheKey, entry);
  onSession?.(entry);
  log?.('Session established.');
  return token;
}
