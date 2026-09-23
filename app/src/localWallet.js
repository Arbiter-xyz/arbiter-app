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
}

export function clearLocalWallet() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Returns the raw secret for a one-time "back this up somewhere safe"
 * reveal — this wallet holds real staked USDC and accrued earnings, and
 * there is no recovery path if localStorage is cleared (browser reset,
 * private browsing, different device). Never logged, never sent to the
 * backend — only ever read back out for the user to copy themselves. */
export function getLocalWalletSecret() {
  return localStorage.getItem(STORAGE_KEY);
}

/** Returns an object matching the same {getAddress, signTransaction} shape
 * as StellarWalletsKit, so the rest of the app doesn't need to know which
 * wallet is active. */
export function createOrLoadLocalWallet() {
  let secret = localStorage.getItem(STORAGE_KEY);
  if (!secret) {
    secret = Keypair.random().secret();
    localStorage.setItem(STORAGE_KEY, secret);
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
