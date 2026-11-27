// Web Storage access that never throws (#452, #454).
//
// Browsers with site data blocked, and some embedded webviews, throw a
// SecurityError on any storage access, sometimes even on reading the
// `localStorage` property itself. An uncaught throw at module top level
// stops the rest of the page script, so every read and write goes through
// these helpers instead.
//
// `area` picks the store: 'local' (default) for preferences that should
// survive a browser restart, 'session' for credentials that shouldn't.

function store(area) {
  try {
    return area === "session"
      ? globalThis.sessionStorage
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The stored string, or null when missing or storage is unavailable. */
export function safeGet(key, area = "local") {
  try {
    return store(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores the value; returns false when storage is unavailable or full. */
export function safeSet(key, value, area = "local") {
  try {
    const s = store(area);
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Removes the key; a no-op when storage is unavailable. */
export function safeRemove(key, area = "local") {
  try {
    store(area)?.removeItem(key);
  } catch {
    // Storage blocked: there's nothing stored to clear.
  }
}
