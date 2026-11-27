import { test, expect } from "@playwright/test";

// #452, #453, #454: admin console session handling. Backend calls are stubbed.

const ADDRESS = "GBKYCSECRETADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function stubBackend(page) {
  await page.route(/localhost:4000\/admin\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    const bodies = {
      "/admin/whoami": { role: null },
      "/admin/kyc": {
        customers: [
          {
            address: ADDRESS,
            status: "approved",
            tier: "2",
            reportedAt: Date.now(),
          },
        ],
      },
      "/admin/payouts": { payouts: [] },
      "/admin/workers": { workers: [] },
      "/admin/payers": { payers: [] },
      "/admin/fees": { resolvedCount: 0, totalFeeRevenue: "0" },
      "/admin/treasury": { usdc: "1000", xlm: "100" },
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bodies[path] ?? {}),
    });
  });
}

// dispatchEvent rather than click(): it doesn't depend on hit-testing, so a
// dev-server error overlay for an unrelated page can't swallow it.
const press = (page, selector) => page.locator(selector).dispatchEvent("click");

async function login(page) {
  await page.fill("#admin-token-input", "secret-admin-token");
  await page.locator("#admin-login-form").evaluate((f) => f.requestSubmit());
  await expect(page.locator("#admin-shell")).toBeVisible();
}

test("logout removes the previous session’s KYC rows, and they re-render on next login (#453)", async ({
  page,
}) => {
  await stubBackend(page);
  await page.goto("/admin.html");
  await login(page);

  await press(page, '.admin-nav-link[data-view="kyc"]');
  await expect(page.locator("#kyc-body")).toContainText("approved");

  await press(page, "#btn-admin-logout");
  const kyc = await page.locator("#kyc-body").textContent();
  expect(kyc).not.toContain("GBKYC");
  expect(kyc).not.toContain("approved");
  expect(kyc).toContain("Loading…");

  await login(page);
  await press(page, '.admin-nav-link[data-view="kyc"]');
  await expect(page.locator("#kyc-body")).toContainText("approved");
});

test("the token is kept in sessionStorage, and a legacy localStorage copy is cleared (#454)", async ({
  page,
}) => {
  await stubBackend(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("arbiter-admin-token", "old-persisted-token");
    }
  });
  await page.goto("/admin.html");
  expect(
    await page.evaluate(() => localStorage.getItem("arbiter-admin-token")),
  ).toBeNull();
  await expect(page.locator("#panel-login")).toBeVisible();

  await login(page);
  const stored = await page.evaluate(() => ({
    session: sessionStorage.getItem("arbiter-admin-token"),
    local: localStorage.getItem("arbiter-admin-token"),
  }));
  expect(stored).toEqual({ session: "secret-admin-token", local: null });
});

test("with storage blocked the login form still works and explains the problem (#452)", async ({
  page,
}) => {
  await stubBackend(page);
  await page.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    }
  });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/admin.html");
  await expect(page.locator("#panel-login")).toBeVisible();

  await page.fill("#admin-token-input", "secret-admin-token");
  await page.locator("#admin-login-form").evaluate((f) => f.requestSubmit());
  await expect(page.locator("#admin-login-status")).toContainText(
    "storage is blocked",
  );
  expect(errors).toEqual([]);
});
