# Blocked features

Features that cannot be built in this repo until arbiter-backend ships the
underlying contract. Kept here so the scoping isn't lost when the issues close.

## Webhook setup wizard (#137) — unblocked

**No longer blocked.** arbiter-backend serves the outbound-webhook contract:
`POST /webhooks` (register; returns the signing secret once), `GET /webhooks`
(list), and `DELETE /webhooks/:id` (revoke). `customer.js` already manages
webhooks against these endpoints, so the wizard can follow that code rather
than the old poll-based (`ask.js` `pollJob()` → `GET /oracle/:jobId`) or
SSE-based (`/app/events`) patterns.

**Frontend scope:**
- Lives in `dashboard.js` (payer-facing — settlement webhooks belong to the payer).
- Steps: enter URL → show signing secret once → send test delivery → list
  recent deliveries with status/retry count.
- Follow `admin.js`'s `fetchAdmin()`/`VIEWS` authenticated-fetch pattern.

## API key management (#138) — partially unblocked

**Still blocked on:** multiple named keys per account in arbiter-backend.
There is no endpoint to create, name, list, or revoke individual keys.

**Unblocked:** rotation. `POST /billing/account/rotate-key` exists and returns
a fresh key for the calling account, so a rotate action can be built now.

**Frontend scope:**
- Rotate action in `dashboard.js` against `POST /billing/account/rotate-key`
  (show the new secret once).
- New panel in `dashboard.js` listing keys (name, prefix, created, last used) —
  blocked until the backend ships multi-key endpoints.
- Create and revoke with inline confirmation — blocked on the same.
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
