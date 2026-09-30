/* Live landing widgets: throughput ticker (#12), inferred pricing tier (#11)
   and the surge-pricing chart (#9). All data comes from the real backend;
   each widget stays hidden when its endpoint is unreachable instead of
   showing placeholder or simulated numbers. */
(function () {
  "use strict";

  const API_BASE = "https://arbiter-backend-production-4e43.up.railway.app";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- #12 live throughput ticker ----------------------- */
  const ticker = document.getElementById("live-ticker");
  const resolvedEl = document.getElementById("ticker-resolved");
  const workersEl = document.getElementById("ticker-workers");
  const STATS_POLL_MS = 10000;
  let shownResolved = null;

  function countUp(el, from, to) {
    if (reducedMotion || from === null || to <= from) {
      el.textContent = to.toLocaleString();
      return;
    }
    const start = performance.now();
    const dur = 800;
    function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(from + (to - from) * t).toLocaleString();
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function pollStats() {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();
      if (typeof s.totalResolved !== "number") throw new Error("bad payload");
      countUp(resolvedEl, shownResolved, s.totalResolved);
      shownResolved = s.totalResolved;
      if (typeof s.onlineWorkers === "number") workersEl.textContent = s.onlineWorkers.toLocaleString();
      ticker.hidden = false;
    } catch (err) {
      // Keep the last real value on a transient failure; never invent one.
      if (shownResolved === null) ticker.hidden = true;
    }
  }

  if (ticker && resolvedEl && workersEl) {
    pollStats();
    setInterval(() => {
      if (!document.hidden) pollStats();
    }, STATS_POLL_MS);
  }

  /* ---------------- #11 inferred pricing tier ------------------------ */
  const form = document.getElementById("try-it-form");
  const input = document.getElementById("try-it-input");
  const tierHidden = document.getElementById("try-it-tier");
  const tierSummary = document.getElementById("tier-summary");
  const tierSelect = document.getElementById("tier-select");
  let tiers = null; // from listTiersForClient() via GET /oracle/tiers
  let manualTier = null;

  const URGENT = /\b(urgent|asap|now|immediately|right away|quick(ly)?|breaking|live)\b/i;

  // Simple, documented heuristic: urgency keywords → express, very long
  // questions (more context to weigh) → priority, otherwise standard.
  function inferTier(question) {
    const q = (question || "").trim();
    if (URGENT.test(q)) return "express";
    if (q.length > 140) return "priority";
    return "standard";
  }

  function tierMeta(id) {
    return tiers && tiers.find((t) => t.id === id);
  }

  function renderTier() {
    const id = manualTier || inferTier(input.value);
    const meta = tierMeta(id) || tierMeta("standard");
    if (!meta) return;
    tierHidden.value = meta.id;
    const how = manualTier ? "Selected" : "Auto";
    const bits = [`${meta.price} USDC`];
    if (meta.quorumSize) bits.push(`${meta.quorumSize} workers`);
    if (meta.timeoutSeconds) bits.push(`≤${meta.timeoutSeconds}s`);
    tierSummary.textContent = `${how}: ${meta.label || meta.id} · ${bits.join(" · ")}`;
  }

  async function loadTiers() {
    try {
      const res = await fetch(`${API_BASE}/oracle/tiers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = Array.isArray(body) ? body : body.tiers;
      if (!Array.isArray(list) || !list.length) throw new Error("no tiers");
      tiers = list.map((t) => ({ ...t, id: t.id || t.tier || t.name }));
      tierSelect.innerHTML = '<option value="">Auto (recommended)</option>';
      tiers.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = `${t.label || t.id} — ${t.price} USDC`;
        tierSelect.appendChild(opt);
      });
      document.getElementById("tier-picker").hidden = false;
      renderTier();
    } catch (err) {
      // No tier metadata → the plain one-tap Ask still works (backend default).
    }
  }

  if (form && input && tierHidden && tierSummary && tierSelect) {
    input.addEventListener("input", renderTier);
    tierSelect.addEventListener("change", () => {
      manualTier = tierSelect.value || null;
      renderTier();
    });
    loadTiers();
  }

  /* ---------------- #9 live surge-pricing chart ---------------------- */
  const surgeWrap = document.getElementById("surge-live");
  const canvas = document.getElementById("surge-canvas");
  const surgeNow = document.getElementById("surge-now");
  const surgeStatus = document.getElementById("surge-status");
  const WINDOW_MS = 10 * 60 * 1000;
  // Samples: {t, m, s} (server time, multiplier, smoothed supply) or
  // {gap: true, t} marking a disconnect. Gaps are drawn as a break in the
  // line; nothing is ever interpolated across them.
  const samples = [];
  let clockOffset = 0; // serverTime - clientTime, from each event
  let es = null;
  let retryMs = 1000;

  function nowServer() {
    return Date.now() + clockOffset;
  }

  function pushSample(d) {
    const t = typeof d.ts === "number" ? d.ts : Date.parse(d.ts);
    if (!Number.isFinite(t) || typeof d.surgeMultiplier !== "number") return;
    clockOffset = t - Date.now();
    const last = samples[samples.length - 1];
    // Drop out-of-order/replayed events so history is never rewritten.
    if (last && !last.gap && t <= last.t) return;
    samples.push({ t, m: d.surgeMultiplier, s: d.smoothedCount });
    const cutoff = t - WINDOW_MS;
    while (samples.length && samples[0].t < cutoff) samples.shift();
    surgeNow.textContent = `${d.surgeMultiplier.toFixed(2)}x`;
    surgeWrap.hidden = false;
    draw();
  }

  function markGap() {
    const last = samples[samples.length - 1];
    if (last && !last.gap) samples.push({ gap: true, t: nowServer() });
  }

  function draw() {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pts = samples.filter((p) => !p.gap);
    if (!pts.length) return;
    const end = nowServer();
    const start = end - WINDOW_MS;
    const maxM = Math.max(2, ...pts.map((p) => p.m));
    const x = (t) => ((t - start) / WINDOW_MS) * w;
    const y = (m) => h - 4 - ((m - 1) / (maxM - 1)) * (h - 8);

    ctx.strokeStyle = "rgba(128,128,128,0.35)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y(1));
    ctx.lineTo(w, y(1));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < samples.length; i += 1) {
      const p = samples[i];
      if (p.gap) {
        pen = false;
        continue;
      }
      // Step chart: the multiplier holds its value until the next event,
      // matching how the backend applies it to quotes.
      if (!pen) {
        ctx.moveTo(x(p.t), y(p.m));
        pen = true;
      } else {
        ctx.lineTo(x(p.t), y(samples[i - 1].m));
        ctx.lineTo(x(p.t), y(p.m));
      }
      const next = samples[i + 1];
      if (!next) ctx.lineTo(x(end), y(p.m));
    }
    ctx.stroke();
  }

  function connect() {
    es = new EventSource(`${API_BASE}/pricing/surge/stream`);
    es.addEventListener("open", () => {
      retryMs = 1000;
      surgeStatus.textContent = "Live";
    });
    es.addEventListener("message", (evt) => {
      try {
        pushSample(JSON.parse(evt.data));
      } catch (err) {
        /* ignore malformed event */
      }
    });
    es.addEventListener("error", () => {
      markGap();
      surgeStatus.textContent = "Reconnecting…";
      es.close();
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
      draw();
    });
  }

  if (surgeWrap && canvas && "EventSource" in window) {
    connect();
    setInterval(() => {
      if (!document.hidden && samples.length) draw();
    }, 5000);
  }
})();
