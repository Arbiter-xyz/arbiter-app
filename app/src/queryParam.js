// Read a one-shot query parameter and remove it from the address bar and
// history entry straight away (#456, #460), keeping every other parameter
// and the hash. A reload then doesn't repeat the action, and the value
// doesn't linger in history or in Referer headers.
export function takeQueryParam(name, win = globalThis.window) {
  const url = new URL(win.location.href);
  if (!url.searchParams.has(name)) return null;
  const value = url.searchParams.get(name);
  url.searchParams.delete(name);
  win.history.replaceState(
    win.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return value;
}
