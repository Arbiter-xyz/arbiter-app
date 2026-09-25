import { Keypair, TransactionBuilder, Networks } from '@stellar/stellar-sdk';

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
 * Social recovery (issue #74): the secret can be split client-side into
 * k-of-n Shamir shares that the user distributes themselves (contacts, a
 * second device, a password manager). Splitting and reconstruction happen
 * entirely in this module — no share, and never the secret, is sent to the
 * backend, so the non-custodial trust model above is unchanged. Arbiter's
 * backend has no new capability to reconstruct a user's key.
 */
const STORAGE_KEY = 'arbiter_local_wallet_secret';

// GF(256) arithmetic for Shamir secret sharing. 0x11b is the AES/Rijndael
// reduction polynomial; 0x03 is a generator of the multiplicative group.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a, b) {
  if (b === 0) throw new Error('Shamir: division by zero');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
}

function gfPow(base, exp) {
  let result = 1;
  for (let i = 0; i < exp; i++) result = gfMul(result, base);
  return result;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('Shamir: share is not valid hex');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Splits `secret` (a UTF-8 string) into `n` shares, any `k` of which
 * reconstruct it. Each share is a self-describing hex string of the form
 * `k.n.index.<payload>` so a trustee only needs to hand back one opaque
 * blob. Runs entirely in-memory; nothing here touches the network.
 */
export function splitSecret(secret, k, n) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Shamir: secret must be a non-empty string');
  }
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || n < k || n > 255) {
    throw new Error('Shamir: require 2 <= k <= n <= 255');
  }

  const secretBytes = new TextEncoder().encode(secret);
  const shares = [];
  for (let i = 0; i < n; i++) {
    shares.push(new Uint8Array(secretBytes.length));
  }

  for (let byteIndex = 0; byteIndex < secretBytes.length; byteIndex++) {
    // Random degree-(k-1) polynomial with the secret byte as its constant term.
    const coefficients = new Uint8Array(k);
    coefficients[0] = secretBytes[byteIndex];
    const random = randomBytes(k - 1);
    for (let c = 1; c < k; c++) coefficients[c] = random[c - 1];

    for (let shareIndex = 0; shareIndex < n; shareIndex++) {
      const x = shareIndex + 1; // x must be non-zero
      let y = 0;
      for (let c = k - 1; c >= 0; c--) {
        y = gfMul(y, x) ^ coefficients[c];
      }
      shares[shareIndex][byteIndex] = y;
    }
  }

  return shares.map((payload, i) => `${k}.${n}.${i + 1}.${bytesToHex(payload)}`);
}

/**
 * Reconstructs the original secret from `k` (or more) shares produced by
 * `splitSecret`, using Lagrange interpolation at x = 0. Returns the secret
 * string; the caller can then build a Keypair from it.
 */
export function combineShares(shares) {
  if (!Array.isArray(shares) || shares.length === 0) {
    throw new Error('Shamir: no shares provided');
  }

  const parsed = shares.map((share) => {
    const parts = String(share).trim().split('.');
    if (parts.length !== 4) throw new Error('Shamir: malformed share');
    const k = parseInt(parts[0], 10);
    const n = parseInt(parts[1], 10);
    const x = parseInt(parts[2], 10);
    if (!Number.isInteger(k) || !Number.isInteger(n) || !Number.isInteger(x) || x < 1 || x > n) {
      throw new Error('Shamir: malformed share header');
    }
    return { k, n, x, payload: hexToBytes(parts[3]) };
  });

  const threshold = parsed[0].k;
  const length = parsed[0].payload.length;
  if (parsed.length < threshold) {
    throw new Error(`Shamir: need at least ${threshold} shares, got ${parsed.length}`);
  }
  for (const share of parsed) {
    if (share.k !== threshold || share.payload.length !== length) {
      throw new Error('Shamir: shares are from different splits');
    }
  }

  const used = parsed.slice(0, threshold);
  const secretBytes = new Uint8Array(length);

  for (let byteIndex = 0; byteIndex < length; byteIndex++) {
    let acc = 0;
    for (let i = 0; i < used.length; i++) {
      let numerator = 1;
      let denominator = 1;
      for (let j = 0; j < used.length; j++) {
        if (i === j) continue;
        numerator = gfMul(numerator, used[j].x);
        denominator = gfMul(denominator, used[i].x ^ used[j].x);
      }
      const lagrange = gfDiv(numerator, denominator);
      acc ^= gfMul(used[i].payload[byteIndex], lagrange);
    }
    secretBytes[byteIndex] = acc;
  }

  return new TextDecoder().decode(secretBytes);
}

/**
 * Convenience wrapper: reconstruct a Stellar Keypair from a threshold of
 * recovery shares. The resulting keypair (and therefore address) is
 * identical to the one the shares were split from.
 */
export function recoverKeypairFromShares(shares) {
  return Keypair.fromSecret(combineShares(shares));
}

export function hasLocalWallet() {
  return !!localStorage.getItem(STORAGE_KEY);
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

/**
 * Ledger hardware wallet support.
 *
 * Ledger's Stellar app signs *classic transaction envelopes* (and, on
 * recent firmware, Soroban transaction envelopes) but it does NOT expose a
 * primitive for signing a bare Soroban authorization entry. Soroban auth
 * entries are signed over a preimage hash (the "signature payload") that is
 * not a transaction envelope, so the device cannot be asked to sign one
 * directly.
 *
 * The honest, non-misleading path is therefore:
 *   1. If the caller asks us to sign a full transaction envelope (the
 *      normal `signTransaction(xdr)` flow), we hand it to the Ledger
 *      Stellar app via the transport and return the signed envelope.
 *   2. If the caller asks us to sign a bare auth entry (the Soroban
 *      `signAuthEntry` flow), we refuse with a clear, typed error rather
 *      than silently producing a signature the device never made. The
 *      caller can then fall back to a software wallet for that entry, or
 *      restructure the flow so the auth entry is embedded in a transaction
 *      envelope the device *can* sign.
 *
 * The transport is injected (rather than imported) so this module stays
 * testable and so the actual `@ledgerhq/hw-transport-webhid` / Stellar app
 * bindings can be supplied by the app shell without pulling hardware deps
 * into every bundle.
 */
export const LEDGER_AUTH_ENTRY_UNSUPPORTED = 'LEDGER_AUTH_ENTRY_UNSUPPORTED';

export class LedgerAuthEntryUnsupportedError extends Error {
  constructor(message) {
    super(
      message ||
        'Ledger\u2019s Stellar app cannot sign a bare Soroban auth entry. ' +
          'Sign the enclosing transaction envelope instead, or use a software wallet for this entry.'
    );
    this.name = 'LedgerAuthEntryUnsupportedError';
    this.code = LEDGER_AUTH_ENTRY_UNSUPPORTED;
  }
}

/**
 * Build a wallet object backed by a real Ledger device.
 *
 * @param {object} opts
 * @param {object} opts.transport  An open Ledger transport (e.g. from
 *   `@ledgerhq/hw-transport-webhid`). Must expose `send(cla, ins, p1, p2, data)`.
 * @param {string} [opts.path]     BIP-32 derivation path. Defaults to the
 *   standard Stellar path `44'/148'/0'`.
 * @param {string} [opts.networkPassphrase]  Network passphrase used when
 *   parsing/rebuilding envelopes. Defaults to the public network.
 * @param {function} [opts.getPublicKey]  Optional override that returns the
 *   device public key (e.g. from `@ledgerhq/hw-app-str`). If omitted, the
 *   adapter issues the Stellar app's GET_PUBLIC_KEY APDU itself.
 * @param {function} [opts.signEnvelope]  Optional override that signs a
 *   transaction envelope XDR on the device. If omitted, the adapter issues
 *   the Stellar app's SIGN_TRANSACTION APDU itself.
 */
export function createLedgerWallet(opts = {}) {
  const {
    transport,
    path = "44'/148'/0'",
    networkPassphrase = Networks.PUBLIC,
    getPublicKey,
    signEnvelope,
  } = opts;

  if (!transport || typeof transport.send !== 'function') {
    throw new Error('createLedgerWallet requires an open Ledger transport');
  }

  // Stellar app APDU constants (see LedgerHQ/app-stellar).
  const CLA = 0xe0;
  const INS_GET_PUBLIC_KEY = 0x02;
  const INS_SIGN_TRANSACTION = 0x04;

  function encodePath(derivationPath) {
    const segments = derivationPath
      .split('/')
      .filter((s) => s.length > 0)
      .map((s) => {
        const hardened = s.endsWith("'") || s.endsWith('h') || s.endsWith('H');
        const index = parseInt(hardened ? s.slice(0, -1) : s, 10);
        if (Number.isNaN(index)) {
          throw new Error(`Invalid derivation path segment: ${s}`);
        }
        return (index | (hardened ? 0x80000000 : 0)) >>> 0;
      });
    const buf = new Uint8Array(1 + segments.length * 4);
    buf[0] = segments.length;
    segments.forEach((seg, i) => {
      const off = 1 + i * 4;
      buf[off] = (seg >>> 24) & 0xff;
      buf[off + 1] = (seg >>> 16) & 0xff;
      buf[off + 2] = (seg >>> 8) & 0xff;
      buf[off + 3] = seg & 0xff;
    });
    return buf;
  }

  async function devicePublicKey() {
    if (typeof getPublicKey === 'function') {
      return getPublicKey(path);
    }
    const data = encodePath(path);
    const res = await transport.send(CLA, INS_GET_PUBLIC_KEY, 0, 0, data);
    // Response: [pubkeyLen, ...pubkey, addressLen, ...address]
    const pubkeyLen = res[0];
    const pubkey = res.slice(1, 1 + pubkeyLen);
    return { publicKey: pubkey, raw: res };
  }

  async function deviceSignEnvelope(xdr) {
    if (typeof signEnvelope === 'function') {
      return signEnvelope(xdr, path);
    }
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    const txBytes = new Uint8Array(tx.toEnvelope().toXDR());
    const pathBytes = encodePath(path);
    const payload = new Uint8Array(pathBytes.length + txBytes.length);
    payload.set(pathBytes, 0);
    payload.set(txBytes, pathBytes.length);
    const res = await transport.send(CLA, INS_SIGN_TRANSACTION, 0, 0, payload);
    // Response: [sigLen, ...signature]
    const sigLen = res[0];
    const signature = res.slice(1, 1 + sigLen);
    return { signature, raw: res };
  }

  return {
    id: 'ledger',
    async getAddress() {
      const { publicKey } = await devicePublicKey();
      const keypair = Keypair.fromPublicKey(
        typeof publicKey === 'string' ? publicKey : Buffer.from(publicKey).toString('hex')
      );
      return { address: keypair.publicKey() };
    },
    async signTransaction(xdr, signOpts = {}) {
      const passphrase = signOpts.networkPassphrase || networkPassphrase;
      const { signature } = await deviceSignEnvelope(xdr);
      const tx = TransactionBuilder.fromXDR(xdr, passphrase);
      const { publicKey } = await devicePublicKey();
      const keypair = Keypair.fromPublicKey(
        typeof publicKey === 'string' ? publicKey : Buffer.from(publicKey).toString('hex')
      );
      tx.addSignature(keypair.publicKey(), Buffer.from(signature).toString('base64'));
      return { signedTxXdr: tx.toXDR() };
    },
    /**
     * Soroban auth-entry signing is not supported by the Ledger Stellar app.
     * We fail loudly and specifically so callers can degrade honestly
     * (e.g. prompt for a software wallet) instead of shipping a signature
     * the device never produced.
     */
    async signAuthEntry() {
      throw new LedgerAuthEntryUnsupportedError();
    },
  };
}
