import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from './en.js';
import ar from './ar.js';

// Regression check for #310: t()'s fallback silently masks a missing
// translation, so nothing was catching a key present in en.js but absent
// from ar.js (or vice versa). This locks in full key parity between the
// two locale files going forward.

function keysOf(dict) {
  return Object.keys(dict).sort();
}

test('ar.js has every key defined in en.js', () => {
  const enKeys = keysOf(en);
  const arKeys = new Set(keysOf(ar));
  const missing = enKeys.filter((key) => !arKeys.has(key));
  assert.deepEqual(missing, [], `ar.js is missing translations for: ${missing.join(', ')}`);
});

test('en.js has every key defined in ar.js', () => {
  const arKeys = keysOf(ar);
  const enKeys = new Set(keysOf(en));
  const extra = arKeys.filter((key) => !enKeys.has(key));
  assert.deepEqual(extra, [], `ar.js defines keys not present in en.js: ${extra.join(', ')}`);
});

test('plural-form entries expose the same sub-keys in both locales', () => {
  for (const key of keysOf(en)) {
    const enValue = en[key];
    const arValue = ar[key];
    if (enValue && typeof enValue === 'object' && !Array.isArray(enValue)) {
      assert.ok(arValue && typeof arValue === 'object', `ar.js's "${key}" should also be a plural-form object`);
      // en.js only needs "one"/"other"; ar.js may legitimately define more
      // CLDR plural categories (zero/one/two/few/many/other) since Arabic
      // has six plural forms. Just make sure ar.js isn't missing any of
      // en.js's categories.
      const missingForms = Object.keys(enValue).filter((form) => !(form in arValue));
      assert.deepEqual(missingForms, [], `ar.js's "${key}" is missing plural form(s): ${missingForms.join(', ')}`);
    }
  }
});
