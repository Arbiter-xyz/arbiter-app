import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableLocales, isRtl } from './i18n.js';

// Regression for issue #288: i18n.js's RTL set (ar, he, fa, ur) is
// deliberately broader than the set of locales that ship a catalog
// (currently only en, ar). he/fa/ur are forward-looking entries so that
// isRtl() is already correct the day a catalog for one of them lands;
// they are not reachable today because detectLocale() can only resolve
// to a locale present in CATALOGS. This test locks in that every locale
// that *is* selectable also reports the right RTL-ness, and that the
// forward-looking entries don't blow up when queried directly.
test('every catalog-backed locale has a correct isRtl() result', () => {
  for (const locale of availableLocales()) {
    assert.equal(typeof isRtl(locale), 'boolean');
  }
  assert.equal(isRtl('en'), false);
  assert.equal(isRtl('ar'), true);
});

test('forward-looking RTL locales without a catalog are still queryable', () => {
  // he/fa/ur have no catalog yet (see CATALOGS), so they can never be
  // selected by detectLocale(), but isRtl() should still answer them
  // correctly rather than throwing, since callers may pass an explicit
  // locale that isn't the active one.
  for (const locale of ['he', 'fa', 'ur']) {
    assert.equal(isRtl(locale), true);
    assert.equal(availableLocales().includes(locale), false);
  }
});
