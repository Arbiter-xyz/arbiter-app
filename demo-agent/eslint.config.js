// Minimal flat ESLint config for the demo-agent Node/ESM scripts. Primary
// goal: catch ReferenceError-class bugs (e.g. require() used under
// "type": "module", undeclared identifiers) before they surface at
// runtime — see issue #295.
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
];
