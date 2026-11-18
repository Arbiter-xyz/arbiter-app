import { defineConfig, devices } from '@playwright/test';

// NOTE: This config is intentionally kept in sync with app/playwright.visual.config.js.
// The npm `visual` script runs `playwright test --config playwright.visual.config.js`
// from the app/ directory; this file exists so the visual suite can also be run
// directly from app/visual/ (e.g. `npx playwright test --config visual/playwright.config.js`).
// Keep testDir/testMatch/snapshotPathTemplate/webServer aligned between the two.
export default defineConfig({
  testDir: '.',
  testMatch: 'app.visual.spec.js',
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
