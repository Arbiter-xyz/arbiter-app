# Threat model — browser-held quick-start wallet

The quick-start wallet (`app/src/localWallet.js`, `app/src/walletWorker.js`) is a non-custodial
Stellar key held by the browser so a worker/buyer can start with zero setup — no extension, no
password, no XLM.

## Assets
- The Ed25519 secret seed (controls staked USDC and accrued earnings).
- The ability to sign transactions for the address.

## Adversaries & what they can do

| Adversary | Before (plaintext `localStorage`) | After |
|---|---|---|
| **XSS on the app origin (live)** | Reads `localStorage` → exfiltrates the secret; attacker keeps full control forever, from anywhere. | After backup is confirmed: key is a **non-extractable WebCrypto Ed25519 `CryptoKey`**; no JS on the origin can read it. XSS can only request signatures *while it runs in an open tab*. Closing the XSS hole ends the compromise; the key never needs rotating because it never left. |
| XSS during the backup window (before "I've saved it") | same as above | Can still ask the worker to export the secret. The window is explicit and user-closed; the UI prompts to close it immediately after copying. |
| Stolen storage at rest (disk image, synced profile, malware reading the profile, a storage-reading extension) | Secret in plaintext | Pending-backup secret is AES-GCM encrypted under a non-extractable key; locked state holds only a non-extractable key handle. Browsers store non-extractable keys in the profile's key store, not as readable JSON. |
| Page heap inspection / accidental logging / crash reports | Secret lived as a string in the page's JS heap for the whole session | Secret only ever exists inside the dedicated worker's heap (and only before lock); the page receives the address and signed XDR only. |
| Malicious dependency in the page bundle | Same as XSS | Same as XSS (bounded to live signing after lock). |
| Physical access to an unlocked device | Full control | Unchanged — out of scope for a zero-setup wallet. |
| Backend compromise | No capability | Unchanged: no secret or share is ever sent to the backend. |

## Design

1. **Isolated signer** — a dedicated module Web Worker owns all key material and exposes a
   narrow RPC: `init`, `sign`, `exportSecret`, `lock`, `clear`.
2. **Pending-backup state** — on creation (or migration of a legacy plaintext wallet, which is
   then deleted from `localStorage`) the secret is encrypted with a non-extractable AES-GCM key
   in IndexedDB so the user can still reveal/copy/Shamir-split it.
3. **Locked state** — "I've saved it — lock export" imports the seed as a non-extractable
   Ed25519 signing key (`crypto.subtle.importKey('pkcs8', …, false, ['sign'])`), deletes the
   ciphertext and zeroes the buffer. Signing uses `crypto.subtle.sign('Ed25519', …)` over the
   transaction hash.
4. **Fallback** — browsers without WebCrypto Ed25519 enter `locked-fallback`: export is
   refused, the secret remains AES-encrypted at rest and signing stays in the worker. This is
   weaker against live XSS (the attacker could use the AES key via the same origin) and is
   documented as such.

## Residual risk (honest limits)
- A live XSS can still *use* the key (sign) — as it could with any extension wallet's page
  bridge. Mitigate with CSP and transaction review UX; hardware wallets remain recommended for
  large balances.
- Clearing site data after locking destroys the key; the user's backup (secret copy or Shamir
  shares) is the only recovery path. The UI makes this explicit before locking.
- The extension build (`createOrLoadLocalWallet(storage)` with `chrome.storage.local`) keeps
  the previous model; extension storage is not reachable by web-page XSS.
