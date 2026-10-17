// Self-hosted visual regression suite (issue #10). Uses Playwright's own
// toHaveScreenshot() pixel diffing — no SaaS. Baselines live in
// visual/__screenshots__ and are reviewed like code in PRs.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './visual',
  testMatch: ['visual.spec.js', 'app.visual.spec.js'],
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  retries: 0,
  reporter: [['html', { outputFolder: 'playwright-report-visual', open: 'never' }]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npm run build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: !process.env.CI },
    { command: 'npx vite ../landing --port 4174 --strictPort', port: 4174, reuseExistingServer: !process.env.CI },
  ],
});
