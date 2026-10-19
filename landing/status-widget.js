/* Arbiter status badge (#136) — dependency-free, embeddable.
   Usage:
     <div id="arbiter-status"></div>
     <script src="https://<host>/status-widget.js" data-target="arbiter-status"
             data-api="https://arbiter-backend-production-4e43.up.railway.app"></script>
   Polls GET /stats and only reports reachability + online worker count —
   resolved/refunded business numbers are deliberately not rendered.
   "Operational" = /stats responded OK with at least one online worker.
   Degrades honestly: shows "status unavailable" when unreachable, never a
   fake "operational". */
(function () {
  const script = document.currentScript;
  const api = (script && script.dataset.api) || "https://arbiter-backend-production-4e43.up.railway.app";
  const mount = document.getElementById((script && script.dataset.target) || "arbiter-status");
  const interval = Number((script && script.dataset.interval) || 60000);
  if (!mount) return;

  const COLORS = { ok: "#1f9d55", degraded: "#d69e2e", unknown: "#8a8a9a" };
  mount.setAttribute("role", "status");
  mount.setAttribute("aria-live", "polite");

  function render(state, text) {
    mount.innerHTML = "";
    const badge = document.createElement("span");
    badge.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;font:500 13px system-ui,sans-serif;" +
      "padding:4px 10px;border:1px solid #ccc3;border-radius:999px;";
    const dot = document.createElement("span");
    dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:" + COLORS[state];
    badge.append(dot, document.createTextNode("Arbiter: " + text));
    mount.append(badge);
  }

  async function check() {
    try {
      const res = await fetch(api + "/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const { onlineWorkers } = await res.json();
      if (typeof onlineWorkers !== "number") throw new Error("bad payload");
      if (onlineWorkers > 0) render("ok", "operational");
      else render("degraded", "no workers online");
    } catch {
      render("unknown", "status unavailable");
    }
  }

  render("unknown", "checking…");
  check();
  setInterval(check, interval);
})();
