# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Report privately through either channel:

- **GitHub Security Advisories** — use the ["Report a vulnerability"](https://github.com/Arbiter-xyz/arbiter-app/security/advisories/new)
  button on this repository's **Security** tab (preferred: it keeps the
  report, discussion and fix private until a coordinated disclosure).
- **Email** — `security@arbiter.xyz`.

Please include enough to reproduce: affected page/flow, browser/environment,
and the impact you believe it has. If you have a proof of concept, attach it.

## What's in scope

This repository — the Arbiter frontend — is the client-side security-sensitive
surface. In particular:

- The non-custodial quick-start wallet (`walletWorker.js`): key generation,
  storage, and signing, all meant to stay inside the Web Worker and never
  touch the main thread or leave the browser unencrypted.
- Admin console authentication and any place a bearer token or secret could
  end up logged, cached, or sent somewhere it shouldn't (error reporting,
  session replay).
- Input rendering: anywhere self-reported or third-party data (worker IDs,
  question/answer text, SEP-24 anchor fields) reaches the DOM — XSS via
  `innerHTML` is the main risk shape here.

Out of scope: the backend API (report to
[arbiter-backend](https://github.com/Arbiter-xyz/arbiter-backend)), the
on-chain contract (report to
[arbiter-contract](https://github.com/Arbiter-xyz/arbiter-contract)), and
findings that require a compromised host or already-leaked secret.

## Deployment status

This is presently a **testnet-only** deployment. It is production-shaped,
but the keys and funds involved are testnet — please calibrate severity
accordingly. We would still rather hear about an issue early than read it
in a public issue.

## What to expect

We aim to acknowledge a report within **3 business days** and to give an
initial assessment within **7 business days**. We'll keep you updated as
we work on a fix and are happy to credit you in the advisory unless you'd
prefer otherwise.
