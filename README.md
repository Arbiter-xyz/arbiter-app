# arbiter-app

Everything client-facing for **Arbiter**, a pay-per-question
human-intelligence oracle settled on Stellar/Soroban: the worker console,
the buyer dashboard, the marketing/landing page, and the headless demo
scripts that exercise the whole system without a browser. Talks to
[arbiter-backend](https://github.com/Arbiter-xyz/arbiter-backend), which
in turn settles against
[arbiter-contract](https://github.com/Arbiter-xyz/arbiter-contract).

Split out of the original `arbiter` monorepo. Fresh single commit, not a
history-preserving split — full history and the six-round build narrative
live in the original [`arbiter`](https://github.com/rudeus112266/arbiter)
repo.

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

## Running it

```sh
cd app && npm install && npm run dev      # or: npm run build
cd landing && python3 -m http.server 8123 # static, no build step

cd demo-agent && npm install
cp .env.example .env
node sandbox-ask.js "What year did Stellar launch?"   # zero setup
node ask.js "What is the capital of France?"           # real on-chain flow
```

Verified live against a real deployed contract on Stellar testnet — see
the original monorepo's README, "Round 6," for the full run (real
`ask.js`/`worker-sim.js`/`sponsored-demo.js` executions, transaction links
included).
