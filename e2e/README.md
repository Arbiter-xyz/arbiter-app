# End-to-end tests

This directory contains the end-to-end (e2e) test suite for the wallet
integration layer, including the manual hardware-in-the-loop runbook for
Ledger devices.

## Automated suite

Run the automated suite with:

```sh
yarn test:e2e
```

These tests exercise the wallet-connect abstraction in `localWallet.js`
against the browser-extension wallets (Freighter, Lobstr, xBull, Hana,
Albedo, HOT Wallet) using their documented mock/injection hooks.

## Ledger hardware-in-the-loop runbook

Hardware-in-the-loop CI is not feasible for Ledger devices, so the Ledger
path is verified with the manual runbook below. It proves that a real
payment signs and settles via Ledger, and it documents the honest
degradation path for Soroban auth-entry signing on current firmware.

### Prerequisites

- A Ledger Nano S Plus / Nano X / Stax with the **Stellar app** installed
  and up to date (firmware and app).
- Ledger Live installed, or the device unlocked and the Stellar app open.
- A funded Stellar testnet account whose secret key is loaded on the device.
- The app running locally with the Ledger adapter enabled.

### Background: what the Stellar app can and cannot sign

Ledger's Stellar app signs **classic transaction envelopes** (payment,
create account, change trust, manage data, etc.). It does **not** natively
sign **Soroban auth entries** on current firmware: the device has no
APDU command for the `SorobanAuthorizationEntry` preimage, and the
`SOROBAN_CREDENTIALS_ADDRESS` signature payload is not exposed to the app.

The adapter in `localWallet.js` therefore:

1. Uses the device for classic envelope signing (the real, supported path).
2. Detects Soroban auth-entry signing requests and **fails loudly** with a
   typed `LedgerUnsupportedOperationError` instead of silently producing an
   invalid or misleading signature.
3. Surfaces a documented fallback: the user is told to sign the auth entry
   with a supported software wallet (Freighter/Lobstr/etc.) or to use a
   delegated signer, and the UI shows the exact reason.

### Steps

1. **Connect the device.** Open the Stellar app on the Ledger, then in the
   app choose *Connect Ledger*. Confirm the adapter reports the device as
   connected and the public key matches the account shown in Ledger Live.
2. **Classic payment (supported path).** Build a testnet payment of 1 XLM to
   a second funded account. Sign with Ledger. Confirm:
   - the device displays the destination, amount, and fee;
   - the user approves on-device;
   - the signed envelope is submitted and the payment settles (verify the
     transaction hash on a testnet explorer and the recipient balance).
3. **Soroban auth entry (unsupported path).** Build a Soroban invocation
   that requires an auth entry signed by the Ledger account. Attempt to sign
   with Ledger. Confirm:
   - the adapter throws `LedgerUnsupportedOperationError`;
   - the UI shows the honest message explaining that current Stellar app
     firmware cannot sign Soroban auth entries;
   - the UI offers the documented fallback (software wallet or delegated
     signer) rather than a silent failure or a bogus signature.
4. **Reconnect / error handling.** Disconnect the device mid-flow and confirm
   the adapter reports a clear connection error and does not hang.

### Expected results

- Step 2 settles on-chain via Ledger — this is the end-to-end proof that a
  real payment signs and settles via the hardware wallet.
- Step 3 fails with a typed, user-visible error and a documented fallback,
  never a silent or misleading success.

### Notes

- If a future Stellar app firmware adds native Soroban auth-entry signing,
  update the adapter to route auth entries to the device and extend this
  runbook with the supported-path steps.
- A faithful emulator (e.g. Speculos with the Stellar app) may be used in
  place of physical hardware for steps 1–2; document the emulator version
  and app build used.
