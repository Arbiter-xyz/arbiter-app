// fetch() with a deadline (#283, #455): a hung connection would otherwise
// leave a caller's loading state (disabled buttons) stuck forever.

export class RequestTimeoutError extends Error {
  constructor(ms) {
    super(
      `no response within ${Math.round(ms / 1000)}s — check your connection and try again`,
    );
    this.name = "RequestTimeoutError";
  }
}

/**
 * Like fetch(), but aborts after `timeoutMs` and rejects with a readable
 * RequestTimeoutError. A caller-supplied `signal` still aborts the request.
 */
export async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch,
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onCallerAbort = () => ctrl.abort();
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  try {
    return await fetchImpl(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === "AbortError" && !options.signal?.aborted)
      throw new RequestTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
