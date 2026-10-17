# Visual regression suite

This suite deliberately does **not** reuse the existing Playwright E2E flow:
that suite exercises wallets and Testnet behavior, while visual comparisons must
be deterministic and never depend on live RPC or backend data. The visual suite
serves the Vite production build locally, injects a representative populated
state (`app.visual.spec.js`) and deterministic stubbed backend job states
(`visual.spec.js`), and captures each app page across desktop and mobile viewports.

All visual regression runs use the single canonical config at
`app/playwright.visual.config.js` (`app/visual/playwright.config.js` is a thin
re-export for convenience). Create or intentionally refresh baselines with
`npm run visual:update`; review the resulting files in `visual/__screenshots__/`
before committing them. CI runs `npm run visual` for pull requests that touch
`app/` and uploads Playwright artifacts on failure.
