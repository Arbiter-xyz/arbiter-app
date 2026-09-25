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

## Layout

```
app/          # Vite worker console (index.html) + buyer dashboard (dashboard.html)
landing/      # static marketing site + live "try it now" sandbox widget
demo-agent/   # headless buyer/worker/proof scripts (ask.js, worker-sim.js, sponsored-demo.js)
e2e/          # browser click-through harness (stubbed)
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
```

Verified live against a real deployed contract on Stellar testnet. (That
run predates this repo's split; see "Round 6" in the archived
[`arbiter`](https://github.com/rudeus112266/arbiter) monorepo README for
the full run — real `ask.js`/`worker-sim.js`/`sponsored-demo.js`
executions, transaction links included.)

## Local stack, widget & demo feed

- **One-command stack (Docker Compose, sandbox only):** with
  [arbiter-backend](https://github.com/Arbiter-xyz/arbiter-backend) cloned as a
  sibling (`../arbiter-backend`, or set `BACKEND_CONTEXT`), run
  `docker compose up --build` to start the backend plus two `worker-sim.js`
  workers, then `docker compose run --rm ask "What is 6 x 7?"` to push a sandbox
  question through to settlement. Secrets come from `.env` files only.
- **Embeddable widget:** `landing/widget.js` — add `<div data-arbiter-widget></div>`
  and `<script src=".../widget.js" data-api-base="https://your-backend"></script>`
  to any page. Sandbox only: no payment, no chain, no signup.
- **Live demo feed:** `app/demo.html` polls `GET /admin/transactions` and
  `GET /admin/workers` (admin token required) and shows dispatch, answer and
  settlement events as they happen — no changes to the CLI scripts needed.
