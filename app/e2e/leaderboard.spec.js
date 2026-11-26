import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

// #461, #462, #463: the standalone leaderboard page. Backend is stubbed.

const ROWS = [
  {
    workerId: "GWORKERONEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    matchRatio: 0.9,
    matched: 9,
    totalAnswers: 10,
    stake: 50,
  },
  {
    workerId: "worker two&co",
    matchRatio: 0.5,
    matched: 5,
    totalAnswers: 10,
    stake: 20,
  },
];

// dispatchEvent: an unrelated dev-server error overlay can't swallow it.
const press = (page, selector) => page.locator(selector).dispatchEvent("click");

test("renders rows, links profiles, and Refresh re-fetches (#461, #462)", async ({
  page,
}) => {
  let calls = 0;
  await page.route(/localhost:4000\/leaderboard$/, (route) => {
    calls += 1;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ leaderboard: ROWS }),
    });
  });
  await page.route(/localhost:4000\/activity/, (route) => route.abort());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/leaderboard.html");
  const body = page.locator("#leaderboard-body");
  await expect(body.locator("tr")).toHaveCount(2);
  await expect(body).not.toContainText("Loading…");
  await expect(body.locator("a").nth(1)).toHaveAttribute(
    "href",
    "/worker.html?address=worker%20two%26co",
  );
  expect(calls).toBe(1);

  await press(page, "#btn-refresh");
  await expect.poll(() => calls).toBe(2);
  await expect(body.locator("tr")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("a load error is shown as text, never parsed as HTML (#463)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__xss = false;
    const real = window.fetch;
    window.fetch = (input, init) =>
      String(input).endsWith("/leaderboard")
        ? Promise.reject(new Error('<img src=x onerror="window.__xss=true">'))
        : real(input, init);
  });
  await page.route(/localhost:4000\/activity/, (route) => route.abort());
  await page.goto("/leaderboard.html");

  const cell = page.locator("#leaderboard-body td");
  await expect(cell).toHaveText(
    'Failed to load: <img src=x onerror="window.__xss=true">',
  );
  expect(await page.locator("#leaderboard-body img").count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBe(false);
});

// The API-key panel lives on index.html; serve just its markup with apikey.js.
const panel = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
).match(/<section id="panel-apikey"[\s\S]*?<\/section>/)[0];

test("API-key panel Top up goes to the account page and sends no checkout (#459)", async ({
  page,
}) => {
  await page.route("**/__apikey.html*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${panel}<script type="module" src="/src/apikey.js"></script></body></html>`,
    }),
  );
  const checkout = [];
  await page.route(/localhost:4000\/billing\/checkout/, (route) => {
    checkout.push(route.request());
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ apiKey: "ak_live_x", creditBalance: 5 }),
    });
  });
  await page.goto("/__apikey.html?apikey_session=cs_1");
  await expect(page.locator("#apikey-account")).toBeVisible();
  const lookups = checkout.length; // the GET lookup for the session

  const topUp = page.getByRole("link", { name: /top up/i });
  await expect(topUp).toHaveAttribute("href", "/customer.html");
  await expect(page.locator("#btn-apikey-topup")).toHaveCount(0);
  await topUp.click();
  await page.waitForURL("**/customer.html");
  expect(checkout.slice(lookups).filter((r) => r.method() === "POST")).toEqual(
    [],
  );
});
