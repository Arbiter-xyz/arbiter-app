// Regression test for issue #311: the hand-built PKCS8 wrapper used by
// walletWorker.js (PKCS8_ED25519_PREFIX, see src/walletWorker.js) to import a
// raw 32-byte Ed25519 seed into WebCrypto had no known-vector test. This
// pins the prefix bytes against RFC 8032's published Ed25519 test vector 1
// (https://www.rfc-editor.org/rfc/rfc8032#section-7.1), so any future change
// to the prefix that breaks the PKCS8 encoding is caught immediately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Kept identical to src/walletWorker.js's PKCS8_ED25519_PREFIX. Duplicated
// (rather than imported) because walletWorker.js is a dedicated-worker
// module that assigns `self.onmessage` at the top level and cannot be
// imported outside a worker/browser context.
const PKCS8_ED25519_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));
const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// RFC 8032 section 7.1, test vector 1 (SECRET KEY is the 32-byte seed).
const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f';
const EXPECTED_SIGNATURE_HEX =
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100';

test('PKCS8_ED25519_PREFIX wraps the RFC 8032 test-vector-1 seed into a valid importable PKCS8 key', async () => {
  const seed = hexToBytes(SEED_HEX);
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);

  const key = await webcrypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const signature = await webcrypto.subtle.sign('Ed25519', key, new Uint8Array(0));

  assert.equal(bytesToHex(new Uint8Array(signature)), EXPECTED_SIGNATURE_HEX);
});
