import { describe, expect, it } from "vitest";
import { takeQueryParam } from "./queryParam.js";

function fakeWindow(href) {
  const win = {
    location: { href },
    history: {
      state: { s: 1 },
      calls: [],
      replaceState(state, _title, url) {
        this.calls.push([state, url]);
        win.location.href = new URL(url, win.location.href).href;
      },
    },
  };
  return win;
}

describe("takeQueryParam (#456, #460)", () => {
  it("returns the value and strips only that parameter", () => {
    const win = fakeWindow(
      "https://app.test/customer.html?a=1&checkout=success&b=2#top",
    );
    expect(takeQueryParam("checkout", win)).toBe("success");
    expect(win.location.href).toBe(
      "https://app.test/customer.html?a=1&b=2#top",
    );
    expect(win.history.calls).toEqual([
      [{ s: 1 }, "/customer.html?a=1&b=2#top"],
    ]);
  });

  it("leaves a clean path when it was the only parameter", () => {
    const win = fakeWindow("https://app.test/?apikey_session=cs_test_123");
    expect(takeQueryParam("apikey_session", win)).toBe("cs_test_123");
    expect(win.location.href).toBe("https://app.test/");
  });

  it("does nothing when the parameter is absent", () => {
    const win = fakeWindow("https://app.test/customer.html?x=1");
    expect(takeQueryParam("checkout", win)).toBeNull();
    expect(win.history.calls).toEqual([]);
  });

  it("decodes values such as ids containing slashes", () => {
    const win = fakeWindow("https://app.test/?apikey_session=cs%2Fa%2Fb");
    expect(takeQueryParam("apikey_session", win)).toBe("cs/a/b");
  });
});
