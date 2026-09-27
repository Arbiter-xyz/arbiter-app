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
