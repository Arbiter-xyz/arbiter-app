import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, fetchWithTimeout } from "./fetchTimeout.js";

/** A fetch that never settles unless its signal aborts, like a hung socket. */
function hangingFetch() {
  return vi.fn(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
}

describe("fetchWithTimeout (#455)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects with a readable error once the deadline passes", async () => {
    const fetchImpl = hangingFetch();
    const p = fetchWithTimeout(
      "https://x/billing/account",
      {},
      15000,
      fetchImpl,
    );
    const settled = vi.fn();
    p.catch(settled);

    await vi.advanceTimersByTimeAsync(14999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect(err.message).toMatch(/no response within 15s/);
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves normally and clears its timer", async () => {
    const res = { ok: true };
    await expect(
      fetchWithTimeout("u", { method: "POST" }, 1000, async () => res),
    ).resolves.toBe(res);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the caller options and passes other errors through", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      fetchWithTimeout("u", { headers: { A: "1" } }, 1000, fetchImpl),
    ).rejects.toThrow("Failed to fetch");
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ A: "1" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a caller abort as an abort, not a timeout", async () => {
    const caller = new AbortController();
    const p = fetchWithTimeout(
      "u",
      { signal: caller.signal },
      1000,
      hangingFetch(),
    );
    caller.abort();
    const err = await p.catch((e) => e);
    expect(err.name).toBe("AbortError");
  });
});
