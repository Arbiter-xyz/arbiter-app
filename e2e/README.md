# End-to-end tests

The automated suite lives in `app/e2e/` and is configured by
`app/playwright.config.js`.

## What exists today

`app/e2e/wallet-connect.spec.js` — a Playwright smoke test that builds the
app, opens the **worker console** (`/`) and the **buyer dashboard**
(`/dashboard.html`), clicks *Quick start*, and asserts a wallet address is
shown with no uncaught page errors. Backend calls are stubbed; no testnet
traffic and no real funds are involved. This is the check that would have
caught #195 (dashboard module failing to load, leaving every connect button
dead).

Run it from `app/`:

```sh
npm install
npx playwright install chromium
npm run e2e
```

Set `E2E_BASE_URL` to test an already-running deployment instead of the
locally built preview.

## Not implemented yet

The following are **not** part of the suite and should not be assumed to be
covered by CI:

- Sponsored funding, sandbox/paid questions, and settlement against a real
  testnet backend.
- Browser-extension wallet (Freighter, Lobstr, xBull, …) flows.
- Ledger hardware-in-the-loop verification.
- A cross-repo (contract + backend + app) integration harness.

Contributions adding any of these should update this README in the same PR.
