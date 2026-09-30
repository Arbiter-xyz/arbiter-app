// WCAG 2.1 AA gate (issue #5): loads every page of the built app and the
// landing page in headless Chromium, in both LTR (en) and RTL (ar), and runs
// axe-core against the wcag2a/wcag2aa/wcag21a/wcag21aa rule sets. Any
// violation fails CI. Usage: node scripts/a11y-check.mjs <baseUrl> <landingUrl>
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const [base = 'http://localhost:4173', landing = 'http://localhost:4174'] = process.argv.slice(2);
const pages = [
  `${base}/index.html`,
  `${base}/dashboard.html`,
  `${base}/leaderboard.html`,
  `${base}/admin.html`,
  `${landing}/index.html`,
];

const browser = await chromium.launch();
let failures = 0;
for (const locale of ['en', 'ar']) {
  const context = await browser.newContext({ locale });
  await context.addInitScript((l) => localStorage.setItem('arbiter_locale', l), locale);
  for (const url of pages) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => page.goto(url));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    for (const v of violations) {
      failures++;
      console.error(`✗ [${locale}] ${url} — ${v.id} (${v.impact}): ${v.help}`);
      for (const n of v.nodes.slice(0, 5)) console.error(`    ${n.target.join(' ')}`);
    }
    if (!violations.length) console.log(`✓ [${locale}] ${url}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
if (failures) {
  console.error(`\n${failures} accessibility violation(s).`);
  process.exit(1);
}
