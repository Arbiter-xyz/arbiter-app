# arbiter-app

Everything client-facing for **Arbiter**, a pay-per-question
human-intelligence oracle settled on Stellar/Soroban: the worker console,
the buyer dashboard, the marketing/landing page, and the headless demo
scripts that exercise the whole system without a browser. Talks to
[arbiter-backend](https://github.com/Arbiter-xyz/arbiter-backend), which
in turn settles against
[arbiter-contract](https://github.com/Arbiter-xyz/arbiter-contract).

Originally split out of a monorepo; that monorepo is now retired — this
repo is the sole source of truth for `app/`, `demo-agent/`, `e2e/`, and
`landing/` going forward, version-checked against `arbiter-backend`'s
reported API version rather than kept in lockstep by hand (see #150).
Pre-split history and the round-by-round build narrative live in the
archived [`arbiter`](https://github.com/rudeus112266/arbiter) repo.

## Backend compatibility

This app and `arbiter-backend` are deployed independently, so they can
drift out of sync. To catch that early, the app declares the backend API
version it was built against as `COMPATIBLE_BACKEND_VERSION` (in
`app/package.json`), and on load fetches the backend's `GET /health`
(via `VITE_BACKEND_URL`) to read the version string it reports.

- **Match** — nothing happens; the app runs normally.
- **Mismatch** — the app shows a visible, non-blocking banner naming both
  versions. It does **not** block or gate usage: HTTP APIs are forgiving,
  and most mismatches won't actually break anything, so the notice only
  informs (developer or end user) that the two are out of sync.

This mirrors `arbiter-backend`'s own pin against `arbiter-contract`: the
version is declared in one place and checked at runtime, rather than
assumed to stay in lockstep by hand.

## Cross-repo integration harness

Each of the three split repos (contract/backend/app) has its own CI, but
nothing exercises them *together* — an interface change (a new contract
method, a changed backend response shape) can pass all three repos' CI
independently while silently breaking the real integrated system. The
`e2e/` directory is the home for a harness that closes that gap from the
consumer's side.

`e2e/docker-compose.integration.yml` deploys the real stack together:

- **contract** — `arbiter-contract` checked out at the version pinned in
  `e2e/versions.env` (`CONTRACT_REF`), built and deployed to a local
  Soroban sandbox.
- **backend** — `arbiter-backend` checked out at its pinned-compatible
  version (`BACKEND_REF`, per arbiter-backend#163), pointed at the
  deployed contract and reporting its API version on `GET /health`.
- **app** — this repo's `app/` built against the backend, with
  `COMPATIBLE_BACKEND_VERSION` (per #150) asserted against the backend's
  reported version before the lifecycle test runs.

`e2e/integration/lifecycle.test.js` runs one full paid-question lifecycle
against that real integrated stack — **payment → dispatch → reconcile →
settle** — so an interface-breaking change fails loudly here rather than
at deploy time. It is wired into this repo's CI (`.github/workflows/`),
which brings up the compose stack, waits for the backend health check,
and runs the lifecycle test.

## Frontend surfaces

Today the repo ships five disconnected entry points, each requiring its
own wallet connection with no shared session between them:

- `landing/` — static marketing site + live "try it now" sandbox widget
- `app/index.html` — worker console
- `app/dashboard.html` — buyer dashboard
- `app/leaderboard.html` — leaderboard
- `app/admin.html` — bearer-token-gated read-only ops console

A wallet holder who both asks and answers questions reconnects twice, in
two different tabs, because nothing carries that connection across pages
(`ensureSession()` is duplicated near-identically in `app/src/main.js`
and `app/src/dashboard.js`).

The target is one unified app shell behind a single connection, with
role-aware views and a consistent design system applied across every
surface including admin. This is tracked as an epic (#151) and broken
into dependency-ordered work:

- #143 — shared app shell with router and one wallet-connect/session module
- #144 — migrate buyer dashboard into the unified app shell (depends on #143)
- #145 — migrate leaderboard into the unified app shell as a public route (depends on #143)
- #146 — extract shared design tokens from `landing/` into an app-wide stylesheet
- #147 — apply the shared design system to the admin console (depends on #146)

## Layout

```
app/          # Vite worker console (index.html) + buyer dashboard (dashboard.html)
landing/      # static marketing site + live "try it now" sandbox widget
demo-agent/   # headless buyer/worker/proof scripts (ask.js, worker-sim.js, sponsored-demo.js)
e2e/          # browser click-through harness + cross-repo integration harness
```

## Notable pieces

- `app/src/localWallet.js` — a non-custodial, browser-generated quick-start
  wallet alongside real wallet-connect support (Freighter/Lobstr/xBull/
  Hana/Albedo/HOT Wallet), so trying the product doesn't require installing
  an extension first.
- `demo-agent/sandbox-ask.js` — zero setup, no wallet, no chain: the
  fastest way to see a real response shape.
- `demo-agent/sponsored-demo.js` — proves, on real testnet, that a keypair
  which has never held a stroop of XLM can create an account, open a
  trustline, pay for a question, and get settled, entirely sponsored.
- `app/admin.html` — a bearer-token-gated read-only ops console
  (transactions, workers, payers, live treasury balance, fee revenue,
  fraud/trust monitoring) served against arbiter-backend's `/admin/*`.

## Running it

```sh
cd app && npm install && npm run dev      # or: npm run build
cd landing && python3 -m http.server 8123 # static, no build step

cd demo-agent && npm install
cp .env.example .env
node sandbox-ask.js "What year did Stellar launch?"   # zero setup
node ask.js "What is the capital of France?"           # real on-chain flow

# cross-repo integration harness (real contract + backend + app together)
docker compose -f e2e/docker-compose.integration.yml up --build --abort-on-container-exit
```

Verified live against a real deployed contract on Stellar testnet. (That
run predates this repo's split; see "Round 6" in the archived
[`arbiter`](https://github.com/rudeus112266/arbiter) monorepo README for
the full run — real `ask.js`/`worker-sim.js`/`sponsored-demo.js`
executions, transaction links included.)
