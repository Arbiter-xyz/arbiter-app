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

## Session replay (opt-in)

`app/src/sessionReplay.js` can record PostHog session replays of the worker
console (`index.html`) and, separately gated, the admin console. It is **off
by default** and a no-op unless configured at build time in `app/.env`:

| Variable | Effect |
| --- | --- |
| `VITE_SESSION_REPLAY_POSTHOG_KEY` | PostHog project key. Unset = nothing loads. |
| `VITE_SESSION_REPLAY_HOST` | PostHog host (default `https://us.i.posthog.com`; point at a self-hosted instance if preferred). |
| `VITE_SESSION_REPLAY_ADMIN` | `true` to also record `admin.html`. Anything else = admin never recorded. |

Browsers sending Do-Not-Track or Global Privacy Control are never recorded.
No cookies/localStorage identifiers, no autocapture, and no network
headers/bodies are recorded (admin requests carry the bearer token).

**Exclusions are named, not generic.** `BLOCKED_SELECTORS` removes
`#backup-secret` (raw secret key), `#admin-token-input`, the KYC and
payouts views (`#view-kyc`/`#kyc-body`, `#view-payouts`/`#payouts-body`,
including the full addresses in cell `title`s) and the withdraw
payout-address input entirely from recordings. `MASKED_TEXT_SELECTORS` masks
rendered text that `td()` writes into `textContent` elsewhere (addresses,
amounts). Any new sensitive element must be added to one of these lists;
`maskAllInputs` stays on only as a backstop.

**Why full replay rather than error-context capture only (#106-style).**
The bugs we can't reproduce are mostly flow bugs: wallet-connect handshakes,
the onboard/stake/go-online sequence, withdraw UI states. Those produce no
exception for an error tracker to capture, so a stack trace plus
breadcrumbs shows nothing. Replay is the only thing that shows what the user
actually did. The cost is another third-party script with DOM access, which
matters most on the admin console. That is why admin recording needs its own
second opt-in, and why everything sensitive is blocked by name. If Sentry
(#106) ships and covers enough of the real debugging need, leave this unset.

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
