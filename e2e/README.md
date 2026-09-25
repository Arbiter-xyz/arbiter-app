# End-to-end tests

This directory contains the end-to-end (e2e) test suite for the wallet
integration layer, including the real Playwright suite that drives the
quick-start wallet flow against a real testnet, and the manual
hardware-in-the-loop runbook for Ledger devices.

## Automated suite

Run the automated suite with:

```sh
yarn test:e2e
```

These tests exercise the wallet-connect abstraction in `localWallet.js`
against the browser-extension wallets (Freighter, Lobstr, xBull, Hana,
Albedo, HOT Wallet) using their documented mock/injection hooks.

## Playwright quick-start flow suite

The Playwright suite drives the **built app** in a real browser context and
covers the full quick-start wallet flow end to end:

1. **Generate a quick-start wallet** — the app creates a fresh keypair and
   shows the public key.
2. **Get sponsored funding** — the sponsor funds the new account on testnet
   and the balance becomes visible in the UI.
3. **Ask a sandbox question** — a free/sandboxed question returns a result
   without spending funds.
4. **Ask a real paid question** — a paid question signs and submits a real
   testnet transaction.
5. **See it settle** — the UI reflects the settled transaction (result and
   updated balance).

Run it with:

```sh
yarn test:e2e:playwright
```

### Backend and testnet

The suite runs against a real (or realistically faked) backend plus a real
Stellar testnet contract. Point it at the target environment with:

- `E2E_BASE_URL` — base URL of the built app under test.
- `E2E_BACKEND_URL` — backend the app talks to (real or a local fake).
- `E2E_TESTNET_RPC_URL` — Soroban RPC endpoint for the testnet contract.
- `E2E_SPONSOR_SECRET` — funded testnet sponsor account used for funding.

When a real testnet is unavailable, set `E2E_FAKE_BACKEND=1` to run against
the realistically faked backend that mirrors the real funding/settlement
responses, so the suite still exercises the browser flow in CI.

### Handling testnet flakiness

Testnet latency and congestion are real, non-trivial flakiness sources. The
suite handles them explicitly **without masking real regressions**:

- **Explicit waits, not sleeps.** Every step waits for a concrete UI state
  (balance updated, result rendered, transaction hash shown) via Playwright
  auto-waiting assertions rather than fixed timeouts.
- **Bounded retries on transient network errors only.** Funding and
  settlement polling retry on transient RPC/network failures (timeouts,
  connection resets, `TRY_AGAIN_LATER`) with exponential backoff and a hard
  cap. Deterministic failures (rejected transaction, bad signature, wrong
  result) are **not** retried and fail the test immediately.
- **Settlement polling with a deadline.** After submitting a paid question,
  the suite polls the transaction status until it settles or a generous
  deadline elapses; exceeding the deadline fails with the last observed
  status so the failure is meaningful.
- **CI isolation.** Each run generates a fresh quick-start wallet and uses a
  dedicated sponsor account, so runs do not interfere with each other.

A failure therefore means the flow actually broke (or the testnet stayed
unavailable past the deadline), not that a single request was slow.

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
