/**
 * Isolated signer for the quick-start wallet (issue #7). See
 * docs/security/quick-start-wallet-threat-model.md for the full model.
 *
 * Two storage states, both in IndexedDB (never localStorage):
 *
 *  - "pending-backup": right after creation (or migration of a legacy
 *    plaintext wallet) the raw secret is kept, AES-GCM encrypted under a
 *    non-extractable wrapping key, so the user can still reveal/copy/split
 *    it for backup. Stolen storage (disk image, sync'd profile, a storage-
 *    reading extension) is useless without the non-extractable key.
 *
 *  - "locked": once the user confirms their backup, the seed is imported as
 *    a NON-EXTRACTABLE WebCrypto Ed25519 signing key and the encrypted
 *    secret is deleted. From then on no code on this origin — including an
 *    XSS payload — can read the private key; it can at most request
 *    signatures while it is running, which is the same capability any
 *    extension wallet's content-script bridge has.
 *
 * The raw secret, when it exists at all, only ever lives in this worker's
 * heap; the page talks to it through the narrow RPC below.
 */
import { Keypair, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';

const DB = 'arbiter-wallet';
const STORE = 'keys';
const PKCS8_ED25519_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

let rec = null; // { address, state, wrapKey?, iv?, ct?, signKey? }
let keypair = null; // only while pending-backup, or on browsers without WebCrypto Ed25519

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const load = () => idb('readonly', (s) => s.get('wallet'));
const save = (value) => idb('readwrite', (s) => s.put(value, 'wallet'));
const wipe = () => idb('readwrite', (s) => s.delete('wallet'));

async function ed25519Supported() {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign']);
    return true;
  } catch {
    return false;
  }
}

async function encryptSecret(secret) {
  const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, new TextEncoder().encode(secret));
  return { wrapKey, iv, ct };
}

async function decryptSecret(r) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, r.wrapKey, r.ct);
  return new TextDecoder().decode(pt);
}

async function init({ legacySecret }) {
  rec = await load();
  if (!rec) {
    const kp = legacySecret ? Keypair.fromSecret(legacySecret) : Keypair.random();
    rec = { address: kp.publicKey(), state: 'pending-backup', ...(await encryptSecret(kp.secret())) };
    await save(rec);
  }
  if (rec.state === 'pending-backup') keypair = Keypair.fromSecret(await decryptSecret(rec));
  return { address: rec.address, state: rec.state };
}

async function lock() {
  if (!rec || rec.state !== 'pending-backup') return { state: rec?.state };
  if (!(await ed25519Supported())) {
    // No WebCrypto Ed25519 (older Safari/Firefox): keep the encrypted secret
    // and in-worker signing, but still refuse further exports.
    rec = { ...rec, state: 'locked-fallback' };
  } else {
    const seed = StrKey.decodeEd25519SecretSeed(keypair.secret());
    const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
    pkcs8.set(PKCS8_ED25519_PREFIX);
    pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
    const signKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
    pkcs8.fill(0);
    rec = { address: rec.address, state: 'locked', signKey };
    keypair = null;
  }
  await save(rec);
  return { state: rec.state };
}

async function sign({ xdr, networkPassphrase }) {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  if (rec.state === 'locked') {
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, rec.signKey, tx.hash()));
    tx.addSignature(rec.address, btoa(String.fromCharCode(...sig)));
  } else {
    if (!keypair) keypair = Keypair.fromSecret(await decryptSecret(rec));
    tx.sign(keypair);
  }
  return { signedTxXdr: tx.toXDR() };
}

const handlers = {
  init,
  lock,
  sign,
  exportSecret: () => (rec?.state === 'pending-backup' && keypair ? keypair.secret() : null),
  clear: async () => {
    rec = null;
    keypair = null;
    await wipe();
  },
};

self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    self.postMessage({ id, result: await handlers[op](args || {}) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
