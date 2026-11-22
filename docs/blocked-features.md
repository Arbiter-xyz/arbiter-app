# Blocked features

Features that cannot be built in this repo until arbiter-backend ships the
underlying contract. Kept here so the scoping isn't lost when the issues close.

## Webhook setup wizard (#137)

**Blocked on:** outbound webhooks in arbiter-backend (URL registration,
signature verification, delivery retries). Today the app is poll-based
(`ask.js` `pollJob()` → `GET /oracle/:jobId`) or SSE-based inbound to workers
(`/app/events`) — there is no outbound webhook to an integrator.

**Planned frontend scope once unblocked:**
- Lives in `dashboard.js` (payer-facing — settlement webhooks belong to the payer).
- Steps: enter URL → show signing secret once → send test delivery → list
  recent deliveries with status/retry count.
- Follow `admin.js`'s `fetchAdmin()`/`VIEWS` authenticated-fetch pattern.

## API key management (#138)

**Blocked on:** multiple named keys per account in arbiter-backend. Today only
`ADMIN_TOKEN` (single operator token in `localStorage` under `TOKEN_KEY`) and
one session token per address (`ensureSession()`) exist.

**Planned frontend scope once unblocked:**
- New panel in `dashboard.js` listing keys (name, prefix, created, last used).
- Create (show secret once), rotate, and revoke with inline confirmation.
- Same authenticated-fetch pattern as `fetchAdmin()`.
- Open question: bearer key for metered `/oracle` vs. multi-key session tokens —
  decide with the backend contract.

## Not listed here: referral rewards and social recovery UI (#287 review)

Checked whether referral rewards being reputation-only, or social recovery's
missing UI, belong in this doc alongside #137/#138. Neither is actually
**blocked on arbiter-backend** — the bar for this doc — so they're
intentionally left off it:

- **Referral rewards (reputation-only)** — `app/src/referral.js` already
  states "Rewards are reputational only (a visible count); no USDC reward."
  That's a deliberate product choice, not something waiting on a backend
  capability; there's no missing endpoint or contract feature blocking a
  paid reward, it just isn't the design today.
- **Social recovery UI** — `app/src/localWallet.js` already implements
  client-side k-of-n Shamir split/reconstruct in full (issue #74), entirely
  without backend involvement. What's missing is the `main.js` UI wiring to
  surface it, per the dangling-comment note in `main.js` near
  `activateWallet`. That's an unimplemented frontend feature, not a backend
  blocker — tracking it here would misrepresent it as needing
  arbiter-backend work it doesn't need.
