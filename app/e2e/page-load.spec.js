import { test, expect } from '@playwright/test';

// Every HTML entry in vite.config.js's rollupOptions.input.
// Keep this list in sync with the build input so a load-time crash on any
// built page (ReferenceError/TypeError) fails CI instead of being found by hand.
const pages = [
  { name: 'worker console', path: '/' },
  { name: 'buyer dashboard', path: '/dashboard.html' },
  { name: 'admin', path: '/admin.html' },
  { name: 'leaderboard', path: '/leaderboard.html' },
  { name: 'customer', path: '/customer.html' },
  { name: 'worker profile', path: '/worker.html' },
  { name: 'status', path: '/status.html' },
];

// Stub backend calls so pages render without a live API, mirroring the
// page.route pattern used in wallet-connect.spec.js.
async function stubBackend(page) {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    }),
  );
}

for (const { name, path } of pages) {
  test(`loads the ${name} page without page errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await stubBackend(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
}
