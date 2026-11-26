import { test, expect } from "@playwright/test";

// #455: a backend that never answers must not leave the customer page stuck.
test("a hung request times out and the buttons re-enable", async ({ page }) => {
  await page.clock.install();
  // Every backend request hangs: never fulfilled.
  await page.route(/localhost:4000\//, () => {});
  await page.goto("/customer.html");

  await page.fill("#customer-key-input", "ak_live_test");
  await page.locator("#form-customer-login").evaluate((f) => f.requestSubmit());
  await expect(page.locator("#btn-customer-login")).toBeDisabled();

  await page.clock.fastForward(15_000);

  await expect(page.locator("#btn-customer-login")).toBeEnabled();
  await expect(page.locator("#log")).toContainText("no response within 15s");
  // The key went to sessionStorage, not localStorage (#454).
  expect(
    await page.evaluate(() => [
      sessionStorage.getItem("arbiter-customer-api-key"),
      localStorage.getItem("arbiter-customer-api-key"),
    ]),
  ).toEqual(["ak_live_test", null]);
});
