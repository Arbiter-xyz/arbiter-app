import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

/**
 * A locally-generated, browser-held keypair as an alternative to installing
 * a wallet extension — the friction Jobs would call out first. This is
 * deliberately NOT a first-party custodial/embedded wallet (which would
 * introduce real custody and regulatory surface); the secret lives only in
 * this browser's localStorage and is never sent anywhere, so the trust
 * model is the same as a browser extension wallet, just without hardware
 * backing. That's a real, disclosed tradeoff: anyone who can run JS in this
 * origin (e.g. via an XSS bug) could read it. Fine for a quick-start/demo
 * identity; a production deployment should offer this alongside, not
 * instead of, real wallets.
 *
 * The same keypair is also reused by the Chrome/Firefox extension worker
 * console (issue #91): the extension background service worker has no
 * `localStorage`, so it passes `chrome.storage.local` (or any async
 * get/set/remove store) as `storage` and gets the identical
 * {getAddress, signTransaction} shape. The secret is still never sent to
 * the backend — only the signed challenge/response is.
 */
const STORAGE_KEY = 'arbiter_local_wallet_secret';

/** Resolves the storage backend: the default browser `localStorage` for the
 * web app, or an injected async store (e.g. `chrome.storage.local`) for the
 * extension service worker. */
function resolveStorage(storage) {
  if (storage) return storage;
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  };
}

export function hasLocalWallet(storage) {
  return !!resolveStorage(storage).getItem(STORAGE_KEY);
}

export function clearLocalWallet(storage) {
  resolveStorage(storage).removeItem(STORAGE_KEY);
}

/** Returns the raw secret for a one-time "back this up somewhere safe"
 * reveal — this wallet holds real staked USDC and accrued earnings, and
 * there is no recovery path if localStorage is cleared (browser reset,
 * private browsing, different device). Never logged, never sent to the
 * backend — only ever read back out for the user to copy themselves. */
export function getLocalWalletSecret(storage) {
  return resolveStorage(storage).getItem(STORAGE_KEY);
}

/** Returns an object matching the same {getAddress, signTransaction} shape
 * as StellarWalletsKit, so the rest of the app doesn't need to know which
 * wallet is active. Pass `storage` (e.g. `chrome.storage.local`) to reuse
 * the same keypair from the extension background service worker. */
export function createOrLoadLocalWallet(storage) {
  const store = resolveStorage(storage);
  let secret = store.getItem(STORAGE_KEY);
  if (!secret) {
    secret = Keypair.random().secret();
    store.setItem(STORAGE_KEY, secret);
  }
  const keypair = Keypair.fromSecret(secret);

  return {
    id: 'local-quick-start',
    async getAddress() {
      return { address: keypair.publicKey() };
    },
    async signTransaction(xdr, opts = {}) {
      const tx = TransactionBuilder.fromXDR(xdr, opts.networkPassphrase);
      tx.sign(keypair);
      return { signedTxXdr: tx.toXDR() };
    },
  };
}
