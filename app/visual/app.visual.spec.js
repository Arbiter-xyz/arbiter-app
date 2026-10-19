import { expect, test } from '@playwright/test';

const pages = [
  ['worker', '/index.html'],
  ['dashboard', '/dashboard.html'],
  ['leaderboard', '/leaderboard.html'],
  ['admin', '/admin.html'],
];

async function populate(page) {
  await page.evaluate(() => {
    const body = document.querySelector('#leaderboard-body, #question-list, #tx-body');
    if (body) body.innerHTML = '<tr><td>1</td><td>Example worker</td><td>98%</td><td>42</td><td>100 USDC</td></tr>';
    document.querySelectorAll('.hidden').forEach((element) => element.classList.remove('hidden'));
  });
}

for (const [name, path] of pages) {
  for (const scheme of ['light', 'dark']) {
    test(`${name} ${scheme} populated`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await populate(page);
      await expect(page).toHaveScreenshot(`${name}-${scheme}.png`, { fullPage: true, animations: 'disabled' });
    });
  }
}
