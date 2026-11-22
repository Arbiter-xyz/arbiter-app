import { defineConfig } from 'vitest/config';

// Unit tests only (issue #45); Playwright specs under visual/ and e2e/ are
// run separately via `npm run e2e` / `npm run visual`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.js'],
    environment: 'node',
  },
});
