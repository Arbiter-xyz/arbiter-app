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
  {
    ignores: ['dist/**', 'storybook-static/**', 'playwright-report/**', 'test-results/**'],
  },
];
