// Self-hosted visual regression suite (issue #10). Uses Playwright's own
// toHaveScreenshot() pixel diffing — no SaaS. Baselines live in
// visual/__screenshots__ and are reviewed like code in PRs.
//
// Baselines are generated in the CI container so they match the runner's
// fonts/rendering. See visual/README.md for the update/approval flow.
// This is the single canonical visual config (issue #233). `npm run visual`
// and CI both invoke it via `playwright test --config playwright.visual.config.js`.
// The former app/visual/playwright.config.js was an orphaned duplicate and has
// been removed so there is no drift in what the visual suite covers.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './visual',
  testMatch: '**/*.visual.spec.js',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  retries: 0,
  // Keep diff artifacts (actual/expected/diff) so a deliberate CSS change
  // fails with an inspectable diff instead of a bare assertion error.
  preserveOutput: 'always',
  reporter: [['html', { outputFolder: 'playwright-report-visual', open: 'never' }]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: [
    { command: 'npm run build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: !process.env.CI },
    { command: 'npx vite ../landing --port 4174 --strictPort', port: 4174, reuseExistingServer: !process.env.CI },
  ],
});
