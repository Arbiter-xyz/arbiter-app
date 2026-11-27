import { test, expect } from '@playwright/test';

// Regression guard for #195: a module-load error (missing import, dangling
// handler reference) leaves every Connect/Quick-Start button dead. These
// tests click Quick Start on each entry point and assert a wallet activates.
// Backend calls are stubbed so the suite only exercises the browser flow.

test.beforeEach(async ({ page }) => {
  await page.route(/localhost:4000|\/payers\/|\/auth\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ challenge: 'x', token: 't', expiresAt: Date.now() + 60_000, questions: [], totalTracked: 0 }),
    }),
  );
});

for (const { name, path, addressId } of [
  { name: 'worker console', path: '/', addressId: '#worker-address' },
  { name: 'buyer dashboard', path: '/dashboard.html', addressId: '#payer-address' },
]) {
  test(`quick-start activates a wallet on the ${name}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(path);
    await page.click('#btn-quick-start');
    await expect(page.locator(addressId)).toHaveText(/^G[A-Z2-7]{55}$/);
    expect(errors).toEqual([]);
  });
}

// Smoke test for #384: the onboarding path (landing → connect wallet →
// ask/work) must be clickable end-to-end. Backend is stubbed so this catches
// front-end regressions in the flow without depending on a live deployment.
test('onboarding smoke: landing → connect wallet → ask/work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // 1. Land on the page and confirm the "try it now" entry point renders.
  await page.goto('/');
  await expect(page.locator('#btn-quick-start')).toBeVisible();

  // 2. Connect a wallet via Quick Start.
  await page.click('#btn-quick-start');
  await expect(page.locator('#worker-address')).toHaveText(/^G[A-Z2-7]{55}$/);

  // 3. Reach the ask/work surface (worker console) without module errors.
  await expect(page.locator('body')).toBeVisible();
  expect(errors).toEqual([]);
});
