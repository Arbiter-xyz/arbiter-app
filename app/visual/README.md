# Visual regression suite

This suite deliberately does **not** reuse the existing Playwright E2E flow:
that suite exercises wallets and Testnet behavior, while visual comparisons must
be deterministic and never depend on live RPC or backend data. The visual suite
serves the Vite production build locally, injects a representative populated
state, and captures each app page in light and dark mode.

## Committed baselines

Baselines live under `visual/__screenshots__/{projectName}/{arg}{ext}` (see
`snapshotPathTemplate` in `playwright.visual.config.js`) and **must be committed**
for the CI `visual` job to pass. On a first run without a baseline,
`toHaveScreenshot` writes the actual image and fails the test, so an empty
`__screenshots__/` directory means the job can never pass.

## Updating baselines

Generate or intentionally refresh baselines with `npm run visual:update`, then
review the resulting PNGs under `visual/__screenshots__/` before committing them.

Because screenshots are rendered by the browser, baselines must be generated in
the same container CI uses so fonts and rendering match. Use the
`mcr.microsoft.com/playwright` image that matches the installed Playwright
version (see `@playwright/test` in `package.json`):

```sh
docker run --rm -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v<version>-noble \
  bash -lc "npm ci && npm run visual:update"
```

Commit the regenerated files under `visual/__screenshots__/`. CI runs
`npm run visual` (with `retries: 0`) for pull requests that touch `app/`; a
deliberate CSS change will fail the job and upload the Playwright diff artifacts
on failure.
