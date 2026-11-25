// Minimal flat ESLint config. Primary goal: catch ReferenceError-class bugs
// (undeclared/unresolved identifiers) before they surface at runtime, which
// is the specific gap this config closes — see issue #294.
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
  // sw.js is a service worker that also hosts a speculative Chrome extension
  // bridge (issue #91). The bridge guards every use with `typeof chrome`
  // but ESLint's no-undef still flags the bare `chrome` identifier unless
  // we declare it here. Using globals.webextensions is narrower than adding
  // `chrome` to the site-wide globals — it only applies to this file.
  {
    files: ['public/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
  },
  {
    ignores: ['dist/**', 'storybook-static/**', 'playwright-report/**', 'test-results/**'],
  },
];
