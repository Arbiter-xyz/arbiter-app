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
 */
const STORAGE_KEY = 'arbiter_local_wallet_secret';

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
