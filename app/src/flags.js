// Runtime feature flags for gradual UI rollout.
//
// Unlike the VITE_* env vars (baked in at build time), flag *values* are
// fetched at runtime, so a flag can be toggled without a rebuild. Only the
// *location* of the flag source is a build-time VITE_* var. Two sources:
//
//  1. Unleash Frontend API / Edge / proxy (VITE_UNLEASH_URL +
//     VITE_UNLEASH_CLIENT_KEY): plain fetch, no SDK. Server-side targeting
//     and rollout strategies are evaluated by Unleash.
//  2. Otherwise a static JSON file (VITE_FLAGS_URL, default /flags.json):
//     { "flagName": true | false | { "enabled": true, "rollout": 25 } }.
//     `rollout` is a 0-100 percentage evaluated client-side against a stable
//     per-browser id, so a given user stays in or out consistently.
//
// Any failure (unconfigured, unreachable, timeout, bad JSON, unknown flag)
// fails open to DEFAULTS, i.e. the app's current behavior.

export const DEFAULTS = Object.freeze({
  pushNotifications: true,
});

const UNLEASH_URL = import.meta.env.VITE_UNLEASH_URL || '';
const UNLEASH_CLIENT_KEY = import.meta.env.VITE_UNLEASH_CLIENT_KEY || '';
const UNLEASH_APP_NAME = import.meta.env.VITE_UNLEASH_APP_NAME || 'arbiter-app';
const FLAGS_URL = import.meta.env.VITE_FLAGS_URL || '/flags.json';
const TIMEOUT_MS = 2000;
const ID_KEY = 'arbiter.flags.uid';

function stableId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID?.() || String(Math.random()).slice(2);
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

// FNV-1a -> bucket 0..99, stable per (flag, user).
export function bucket(flag, id) {
  let h = 0x811c9dc5;
  for (const c of `${flag}:${id}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0) % 100;
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function loadFromUnleash(userId) {
  const u = new URL(UNLEASH_URL);
  u.searchParams.set('appName', UNLEASH_APP_NAME);
  u.searchParams.set('userId', userId);
  const body = await fetchJson(u, { Authorization: UNLEASH_CLIENT_KEY });
  // The frontend API only returns enabled toggles; known-but-absent flags are off.
  const out = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, false]));
  for (const t of body.toggles || []) out[t.name] = t.enabled !== false;
  return out;
}

async function loadFromJson(userId) {
  const raw = await fetchJson(FLAGS_URL);
  const out = {};
  for (const [name, v] of Object.entries(raw || {})) {
    if (typeof v === 'boolean') out[name] = v;
    else if (v && typeof v === 'object') {
      const rollout = Number.isFinite(v.rollout) ? v.rollout : 100;
      out[name] = v.enabled !== false && bucket(name, userId) < rollout;
    }
  }
  return out;
}

let loaded;
export function loadFlags() {
  if (!loaded) {
    const id = stableId();
    const source = UNLEASH_URL && UNLEASH_CLIENT_KEY ? loadFromUnleash(id) : loadFromJson(id);
    loaded = source
      .then((remote) => ({ ...DEFAULTS, ...remote }))
      .catch((err) => {
        console.warn('[flags] using defaults:', err.message);
        return { ...DEFAULTS };
      });
  }
  return loaded;
}

export async function isEnabled(name) {
  const flags = await loadFlags();
  return name in flags ? flags[name] : Boolean(DEFAULTS[name]);
}

// Hide every element marked data-flag="<name>" whose flag evaluates off.
// Elements stay visible until evaluation completes (fail open).
export async function applyFlagGates(root = document) {
  const flags = await loadFlags();
  for (const node of root.querySelectorAll('[data-flag]')) {
    if (flags[node.dataset.flag] === false) {
      node.hidden = true;
      node.style.display = 'none';
    }
  }
}
