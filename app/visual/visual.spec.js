import { test, expect } from '@playwright/test';

// Every backend call is stubbed with fixed data so screenshots are
// deterministic; the clock is frozen so relative times never drift.
const FIXED_NOW = new Date('2026-01-01T12:00:00Z');

const fixtures = {
  '/stats': { totalResolved: 1234, totalRefunded: 5, totalSettled: 1239, onlineWorkers: 7 },
  '/oracle/tiers': [
    { id: 'instant', label: 'Instant', price: '0.50', quorumSize: 1, timeoutSeconds: 10 },
    { id: 'standard', label: 'Standard', price: '0.10', quorumSize: 3, timeoutSeconds: 120 },
    { id: 'express', label: 'Express', price: '0.25', quorumSize: 3, timeoutSeconds: 30 },
    { id: 'priority', label: 'Priority', price: '1.00', quorumSize: 5, timeoutSeconds: 60 },
  ],
};

// Job-progression states for the dashboard, captured one at a time so the
// async flow is screenshotted deterministically rather than mid-transition.
const JOB_STATES = ['pending', 'answering', 'reconciling', 'settled', 'refunded'];

async function stubBackend(page, jobStatus = 'settled') {
  await page.clock.install({ time: FIXED_NOW });
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1).*/, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/stream') || pathname.includes('/events')) return route.abort();
    const hit = Object.keys(fixtures).find((k) => pathname.endsWith(k));
    if (hit) return route.fulfill({ json: fixtures[hit] });
    if (/\/oracle\/[^/]+$/.test(pathname)) {
      return route.fulfill({ json: { jobId: 'job-1', status: jobStatus, tier: 'standard', amount: '0.10' } });
    }
    return route.fulfill({ json: [] });
  });
}

const pages = [
  { name: 'landing', url: 'http://localhost:4174/' },
  { name: 'worker-console', url: 'http://localhost:4173/' },
  { name: 'dashboard', url: 'http://localhost:4173/dashboard.html' },
  { name: 'leaderboard', url: 'http://localhost:4173/leaderboard.html' },
];

for (const p of pages) {
  test(`${p.name}`, async ({ page }) => {
    await stubBackend(page);
    await page.goto(p.url);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true });
  });
}

for (const status of JOB_STATES) {
  test(`dashboard job state: ${status}`, async ({ page }) => {
    await stubBackend(page, status);
    await page.goto('http://localhost:4173/dashboard.html?job=job-1');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`dashboard-${status}.png`, { fullPage: true });
  });
}
