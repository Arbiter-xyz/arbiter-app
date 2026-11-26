import { afterEach, describe, expect, it, vi } from "vitest";
import { safeGet, safeRemove, safeSet } from "./storage.js";

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function throwingStorage() {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

afterEach(() => vi.unstubAllGlobals());

describe("storage helpers (#452, #454)", () => {
  it("reads, writes and removes in the chosen area", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());

    expect(safeSet("k", "local-v")).toBe(true);
    expect(safeSet("k", "session-v", "session")).toBe(true);
    expect(safeGet("k")).toBe("local-v");
    expect(safeGet("k", "session")).toBe("session-v");

    safeRemove("k");
    expect(safeGet("k")).toBeNull();
    expect(safeGet("k", "session")).toBe("session-v");
  });

  it("never throws when every storage call throws", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    vi.stubGlobal("sessionStorage", throwingStorage());

    expect(safeGet("k")).toBeNull();
    expect(safeGet("k", "session")).toBeNull();
    expect(safeSet("k", "v")).toBe(false);
    expect(safeSet("k", "v", "session")).toBe(false);
    expect(() => safeRemove("k", "session")).not.toThrow();
  });

  it("never throws when reading the storage property itself throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(safeGet("k")).toBeNull();
      expect(safeSet("k", "v")).toBe(false);
      expect(() => safeRemove("k")).not.toThrow();
    } finally {
      delete globalThis.localStorage;
    }
  });

  it("returns null when storage is missing entirely", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(safeGet("k", "session")).toBeNull();
    expect(safeSet("k", "v", "session")).toBe(false);
  });
});
