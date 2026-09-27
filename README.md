# Arbiter

Arbiter is a protocol for verifiable oracle answers. Buyers post questions, workers
answer them, and settlement happens on-chain. This repository contains the web
surfaces (worker console, buyer dashboard, landing page) plus a few zero-setup
demo scripts.

## Repository layout

- `app/` — Vite SPA: worker console, buyer dashboard, landing page sandbox widget.
- `demo-agent/` — Node CLI scripts, including `sandbox-ask.js`, the zero-setup
  on-ramp that calls the free `/oracle/sandbox` endpoint with no wallet and no
  signing.
- `extension/` — Manifest V3 browser extension surfaces.

## "Verify this claim" browser extension

The `extension/` directory ships a Manifest V3 "verify this claim" extension. It
is a fundamentally different surface from the pages in `app/`: instead of
navigating to an Arbiter page, it works from a right-click context menu on
arbitrary third-party pages.

### What it does

1. The background service worker registers a context-menu entry for selected
text.
2. Right-clicking a selection and choosing **Verify this claim with Arbiter**
   captures the selected page text and sends it as a question to the free
   `/oracle/sandbox` endpoint — the same zero-setup pattern as
   `demo-agent/sandbox-ask.js` (no wallet, no signing).
3. The sandbox result renders in the extension popup/panel, so the user never
   navigates away from the source page.

### Sandbox-only MVP

This first version is deliberately sandbox-only:

- It calls `/oracle/sandbox`, which is free and requires no wallet.
- It holds no key and performs no signing. It cannot reuse `localWallet.js`
  as-is, since extension storage (`chrome.storage`) and the service-worker
  background-page lifecycle differ meaningfully from a page-scoped
  `localStorage` secret and a long-lived Vite SPA session.
- It **never silently spends real funds**. Any future real-payment path (the
  paid `/oracle` flow) must be an unambiguous, separate user action — either
  the extension holding its own key (a new custody surface) or deferring to an
  existing installed wallet extension for signing.

### Out of scope for the initial version

- Real-money payment flow (see above).
- Publishing to the Chrome/Firefox stores.
