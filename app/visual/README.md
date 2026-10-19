# Visual regression suite

This suite deliberately does **not** reuse the existing Playwright E2E flow:
that suite exercises wallets and Testnet behavior, while visual comparisons must
be deterministic and never depend on live RPC or backend data. The visual suite
serves the Vite production build locally, injects a representative populated
state, and captures each app page in light and dark mode.

Create or intentionally refresh baselines with `npm run visual:update`; review
the resulting files in `visual/snapshots/` before committing them. CI runs
`npm run visual` for pull requests that touch `app/` and uploads Playwright
artifacts on failure.
