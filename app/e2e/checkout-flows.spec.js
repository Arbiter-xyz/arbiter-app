import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

// #456, #458, #460: checkout round-trips on the customer page and the
// wallet-free API-key panel. Backend calls are stubbed.

// The API-key panel lives on index.html; serve just its markup so the test
// exercises apikey.js without the rest of the worker console.
const panel = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
).match(/<section id="panel-apikey"[\s\S]*?<\/section>/)[0];
const FIXTURE = `<!doctype html><html><body>${panel}<script type="module" src="/src/apikey.js"></script></body></html>`;

async function openApikeyPanel(page, query = "") {
  await page.route("**/__apikey.html*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE }),
  );
  await page.goto(`/__apikey.html${query}`);
}

test("API-key checkout sends amountUsd and follows checkoutUrl (#458)", async ({
  page,
}) => {
  let body;
  await page.route(/localhost:4000\/billing\/checkout$/, (route) => {
    body = route.request().postDataJSON();
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkoutUrl: "/__paid.html" }),
    });
  });
  await page.route("**/__paid.html", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "paid" }),
  );
  await openApikeyPanel(page);

  await page.fill("#apikey-email", "buyer@example.test");
  await page.fill("#apikey-amount", "25");
  await page.click("#btn-apikey-checkout");

  await page.waitForURL("**/__paid.html");
  expect(body.amountUsd).toBe(25);
  expect(body).not.toHaveProperty("amountUsdc");
  expect(body).not.toHaveProperty("email");
});

test("API-key redirect strips apikey_session and encodes the id (#460)", async ({
  page,
}) => {
  let lookupPath;
  await page.route(/localhost:4000\/billing\/checkout\/.+/, (route) => {
    lookupPath = new URL(route.request().url()).pathname;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiKey: "ak_live_x", creditBalance: 5 }),
    });
  });
  await openApikeyPanel(page, "?apikey_session=cs%2Ftest%2F1&keep=1");

  await expect(page.locator("#apikey-reveal-input")).toHaveValue("ak_live_x");
  expect(lookupPath).toBe("/billing/checkout/cs%2Ftest%2F1");
  expect(page.url()).not.toContain("apikey_session");
  expect(page.url()).toContain("keep=1");
});

async function customerWithKey(page, query) {
  await page.addInitScript(() =>
    localStorage.setItem("arbiter-customer-api-key", "ak_live_test"),
  );
  const accountCalls = [];
  await page.route(/localhost:4000\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/billing/account") accountCalls.push(Date.now());
    const bodies = {
      "/billing/account": {
        accountId: "acct_1",
        creditBalance: "10",
        creditBalanceStroops: "100000000",
      },
      "/webhooks": { webhooks: [] },
    };
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bodies[path] ?? {}),
    });
  });
  await page.clock.install();
  await page.goto(`/customer.html${query}`);
  return accountCalls;
}

test("?checkout=success confirms payment, strips the parameter and refreshes the balance (#456)", async ({
  page,
}) => {
  const accountCalls = await customerWithKey(page, "?checkout=success");

  await expect(page.locator("#log")).toContainText("Payment received");
  expect(page.url()).not.toContain("checkout=");
  await expect.poll(() => accountCalls.length).toBe(1);

  await page.clock.fastForward(5_000);
  await expect.poll(() => accountCalls.length).toBe(2);
});

test("?checkout=cancel shows a cancellation message (#456)", async ({
  page,
}) => {
  const accountCalls = await customerWithKey(page, "?checkout=cancel");

  await expect(page.locator("#log")).toContainText("Checkout cancelled");
  expect(page.url()).not.toContain("checkout=");
  await page.clock.fastForward(5_000);
  expect(accountCalls.length).toBe(1);
});
