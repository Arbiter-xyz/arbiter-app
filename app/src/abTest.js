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
