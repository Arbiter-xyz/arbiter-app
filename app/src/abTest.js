// Client-side A/B bucketing for the worker onboarding flow (issue #108).
//
// SCAFFOLDING ONLY: this assigns and serves variants, and reports the
// assignment to the activity log. There is no events endpoint yet, so no
// exposure/completion data leaves the browser and nothing is measured. To
// turn this into a real experiment, add a backend endpoint (e.g.
// POST /events { experiment, variant, address, event: 'exposure'|'onboarded' })
// and call it where the log lines are written below and on onboarding
// success. Deliberately independent of the feature-flag system (#109).

const STORAGE_PREFIX = 'arbiter.ab.';

export const ONBOARDING_EXPERIMENT = {
  id: 'onboarding-copy-v1',
  variants: {
    // Current copy in index.html's #panel-onboard, leading with "sponsored, free".
    control: null,
    short: {
      text: 'Add USDC to your wallet to start earning. Free — we cover the fees.',
      button: 'Enable USDC',
    },
    detailed: {
      text:
        'Your wallet needs a USDC trustline before it can receive payouts. Arbiter sponsors the ' +
        'account reserve and transaction fee, so this costs you nothing and needs no XLM. ' +
        'You sign one transaction; the key never leaves your wallet.',
      button: 'Onboard (sponsored, free)',
    },
  },
};

// FNV-1a 32-bit: small, deterministic, good enough spread for bucketing.
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function bucketFor(experimentId, variantNames, address) {
  return variantNames[hashString(`${experimentId}:${address}`) % variantNames.length];
}

// Deterministic for a given address; persisted so a returning worker keeps
// the same variant even if the variant list later changes.
export function assignVariant(experiment, address, storage = globalThis.localStorage) {
  const names = Object.keys(experiment.variants);
  const key = `${STORAGE_PREFIX}${experiment.id}.${address}`;
  let stored = null;
  try {
    stored = storage?.getItem(key);
  } catch {}
  if (stored && names.includes(stored)) return stored;
  const variant = bucketFor(experiment.id, names, address);
  try {
    storage?.setItem(key, variant);
  } catch {}
  return variant;
}

export function applyOnboardingVariant(address, log) {
  const variant = assignVariant(ONBOARDING_EXPERIMENT, address);
  const copy = ONBOARDING_EXPERIMENT.variants[variant];
  const panel = document.getElementById('panel-onboard');
  if (copy && panel) {
    const p = panel.querySelector('p');
    const btn = panel.querySelector('#btn-onboard');
    if (p) p.textContent = copy.text;
    if (btn) btn.textContent = copy.button;
  }
  panel?.setAttribute('data-ab-variant', variant);
  log(`A/B experiment ${ONBOARDING_EXPERIMENT.id}: assigned variant "${variant}" (scaffolding only, not reported).`);
  return variant;
}

// --- Tests (issue #250) ---------------------------------------------------
//
// The audit flagged that nothing verified the FNV-1a bucketing spreads
// addresses reasonably evenly across variants, or that assignVariant is
// stable for a repeated address. Both properties hold, so this is a
// not-a-bug review closed with the assertions below as the regression guard.
//
// Run with: node --test app/src/abTest.js

import assert from 'node:assert/strict';
import test from 'node:test';

// In-memory localStorage stand-in so tests don't depend on a browser.
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

// Deterministic pseudo-addresses (Stellar-style G... keys).
function sampleAddresses(n) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = 'G';
    let x = i * 2654435761 + 1;
    for (let j = 0; j < 55; j++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      s += alphabet[x % alphabet.length];
    }
    out.push(s);
  }
  return out;
}

test('hashString is deterministic and returns a 32-bit unsigned int', () => {
  assert.equal(hashString('hello'), hashString('hello'));
  assert.notEqual(hashString('hello'), hashString('world'));
  const h = hashString('arbiter');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test('bucketFor spreads addresses reasonably evenly across variants', () => {
  const names = Object.keys(ONBOARDING_EXPERIMENT.variants);
  const addresses = sampleAddresses(3000);
  const counts = Object.fromEntries(names.map((n) => [n, 0]));
  for (const address of addresses) {
    counts[bucketFor(ONBOARDING_EXPERIMENT.id, names, address)]++;
  }
  const expected = addresses.length / names.length;
  for (const name of names) {
    // Allow a generous +/-25% band; FNV-1a on 3000 samples lands well inside it.
    assert.ok(
      Math.abs(counts[name] - expected) <= expected * 0.25,
      `variant "${name}" got ${counts[name]} of ${addresses.length} (expected ~${expected})`,
    );
  }
});

test('assignVariant is stable across repeated calls for the same address', () => {
  const storage = memoryStorage();
  const address = sampleAddresses(1)[0];
  const first = assignVariant(ONBOARDING_EXPERIMENT, address, storage);
  for (let i = 0; i < 5; i++) {
    assert.equal(assignVariant(ONBOARDING_EXPERIMENT, address, storage), first);
  }
  // Also stable with no storage available (pure hash path).
  assert.equal(assignVariant(ONBOARDING_EXPERIMENT, address, null), first);
});

test('assignVariant honors a previously stored variant', () => {
  const storage = memoryStorage();
  const address = sampleAddresses(1)[0];
  const key = `${STORAGE_PREFIX}${ONBOARDING_EXPERIMENT.id}.${address}`;
  storage.setItem(key, 'detailed');
  assert.equal(assignVariant(ONBOARDING_EXPERIMENT, address, storage), 'detailed');
});
