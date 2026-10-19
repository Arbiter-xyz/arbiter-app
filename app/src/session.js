import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

/** Proves control of an address once (a single signTransaction prompt,
 * same primitive already used for onboarding/staking — never signMessage,
 * whose conventions vary across wallets), then returns a bearer session
 * token reused for every authenticated call until it expires. Single
 * implementation shared by the worker console (main.js) and the buyer
 * dashboard (dashboard.js) — see issue #143. The caller owns the session
 * state and receives updates through `onSession`. This exists because the
 * backend now REQUIRES it for any real-address workerId — see workerAuth.js. */
export async function ensureSession({ address, activeWallet, sessionToken, sessionExpiresAt, onSession, log }) {
  if (sessionToken && Date.now() < sessionExpiresAt - 60_000) return sessionToken;

  if (!activeWallet) {
    throw new Error('No wallet connected — connect a wallet before establishing a session.');
  }

  log('Proving control of your address (one signature)…');
  const challengeRes = await fetch(`${BACKEND_URL}/workers/${address}/session/challenge`, { method: 'POST' });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error || 'failed to get session challenge');
  const { xdr } = await challengeRes.json();

  const { signedTxXdr } = await activeWallet.signTransaction(xdr, {
    address,
    networkPassphrase: WalletNetwork.TESTNET,
  });

  const sessionRes = await fetch(`${BACKEND_URL}/workers/${address}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  if (!sessionRes.ok) throw new Error((await sessionRes.json()).error || 'failed to establish session');
  const { token, expiresAt } = await sessionRes.json();
  onSession({ token, expiresAt });
  log('Session established — you can answer questions as yourself, and only yourself.');
  return token;
}
