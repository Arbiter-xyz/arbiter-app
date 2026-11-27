import { readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

// Service-worker harness (#467): runs public/sw.js in a VM context with fake
// `self`, `caches` and `fetch`, then dispatches navigation fetch events.
const SOURCE = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

function response(status, body) {
  const r = {
    ok: status >= 200 && status < 300,
    status,
    body,
    clone: () => response(status, body),
  };
  return r;
}

function load(fetchImpl) {
  const listeners = {};
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      put: async (req, res) => store.set(req.url, res),
      match: async (req) => store.get(typeof req === "string" ? req : req.url),
      addAll: async () => {},
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (k) => stores.delete(k),
    match: async (req) => {
      const url = typeof req === "string" ? `https://app.test${req}` : req.url;
      for (const s of stores.values()) if (s.has(url)) return s.get(url);
      return undefined;
    },
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (type, fn) => (listeners[type] = fn),
    clients: { claim: async () => {}, matchAll: async () => [] },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(SOURCE, {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    console,
    setTimeout,
    clearTimeout,
  });

  async function navigate(path) {
    let responded;
    listeners.fetch({
      request: {
        method: "GET",
        mode: "navigate",
        url: `https://app.test${path}`,
      },
      respondWith: (p) => (responded = p),
    });
    const res = await responded;
    await new Promise((r) => setTimeout(r, 0)); // let the cache write settle
    return res;
  }
  const cached = async (path) =>
    (await caches.match({ url: `https://app.test${path}` }))?.body;
  return { navigate, cached };
}

describe("sw.js navigation caching (#467)", () => {
  let next;
  beforeEach(() => (next = []));
  const fetchQueue = async () => {
    const step = next.shift();
    if (step === "offline") throw new TypeError("Failed to fetch");
    return step;
  };

  it("caches a good page and serves it offline", async () => {
    const sw = load(fetchQueue);
    next.push(response(200, "good"), "offline");
    expect((await sw.navigate("/dashboard.html")).body).toBe("good");
    expect((await sw.navigate("/dashboard.html")).body).toBe("good");
  });

  it("does not let a 500 or 404 overwrite the cached page", async () => {
    const sw = load(fetchQueue);
    next.push(
      response(200, "good"),
      response(500, "boom"),
      response(404, "missing"),
      "offline",
    );
    await sw.navigate("/dashboard.html");
    expect((await sw.navigate("/dashboard.html")).status).toBe(500); // online: shown as-is
    await sw.navigate("/dashboard.html");
    expect(await sw.cached("/dashboard.html")).toBe("good");
    expect((await sw.navigate("/dashboard.html")).body).toBe("good"); // offline fallback
  });

  it("never caches an error page that had no good copy", async () => {
    const sw = load(fetchQueue);
    next.push(response(503, "down"));
    await sw.navigate("/new.html");
    expect(await sw.cached("/new.html")).toBeUndefined();
  });
});
