// Canonical visual regression configuration lives in ../playwright.visual.config.js
// (wired to `npm run visual` and `npm run visual:update` in app/package.json).
// Re-exported here so running `npx playwright test -c visual/playwright.config.js`
// uses the exact same settings, snapshot paths, and webServer setup (#233, #238).
export { default } from '../playwright.visual.config.js';
