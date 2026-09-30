/* Ask Arbiter — embeddable sandbox widget.
 *
 * Drop-in usage on any page:
 *   <div data-arbiter-widget></div>
 *   <script src="https://<host>/widget.js" data-api-base="https://your-backend"></script>
 *
 * Every element carrying [data-arbiter-widget] gets its own ask box. The
 * backend is taken from the container's data-api-base, then the script
 * tag's, then the public Railway deployment. Same contract as the landing
 * try-it box and demo-agent: POST /oracle/sandbox, then poll
 * GET /oracle/:jobId (30 × 300ms) until status === "settled".
 *
 * Sandbox only: no payment, no chain, no signup. Dependency-free; all
 * backend text is rendered via textContent, never innerHTML.
 */
(function () {
  "use strict";

  var DEFAULT_API_BASE = "https://arbiter-backend-production-4e43.up.railway.app";
  var POLL_ATTEMPTS = 30;
  var POLL_INTERVAL_MS = 300;
  var script = document.currentScript;
  var scriptApiBase = script && script.getAttribute("data-api-base");

  var CSS =
    ".arbiter-w{font:14px/1.4 system-ui,sans-serif;border:1px solid #ccc;border-radius:10px;padding:12px;max-width:420px;background:#fff;color:#111}" +
    ".arbiter-w form{display:flex;gap:6px}" +
    ".arbiter-w input{flex:1;padding:8px;border:1px solid #bbb;border-radius:6px;font:inherit}" +
    ".arbiter-w button{padding:8px 12px;border:0;border-radius:6px;background:#111;color:#fff;font:inherit;cursor:pointer}" +
    ".arbiter-w button:disabled{opacity:.5;cursor:default}" +
    ".arbiter-w .aw-note{font-size:12px;opacity:.65;margin:0 0 8px}" +
    ".arbiter-w .aw-result{margin-top:10px;min-height:1em}" +
    ".arbiter-w .aw-status{font-size:12px;text-transform:uppercase;letter-spacing:.04em;opacity:.7}" +
    ".arbiter-w .is-resolved .aw-status{color:#2e9e5b;opacity:1}" +
    ".arbiter-w .is-refunded .aw-status,.arbiter-w .is-error .aw-status{color:#d64545;opacity:1}";

  function injectStyles() {
    if (document.getElementById("arbiter-widget-css")) return;
    var style = document.createElement("style");
    style.id = "arbiter-widget-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function el(tag, props) {
    var node = document.createElement(tag);
    for (var k in props) node[k] = props[k];
    return node;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function mount(container) {
    if (container.getAttribute("data-arbiter-mounted")) return;
    container.setAttribute("data-arbiter-mounted", "1");
    var apiBase = (container.getAttribute("data-api-base") || scriptApiBase || DEFAULT_API_BASE).replace(/\/$/, "");

    var root = el("div", { className: "arbiter-w" });
    var note = el("p", { className: "aw-note", textContent: "Ask Arbiter — sandbox: no payment, no chain, no signup." });
    var form = el("form");
    var input = el("input", { type: "text", placeholder: "Ask a question…", required: true, maxLength: 500 });
    input.setAttribute("aria-label", "Question for Arbiter");
    var submit = el("button", { type: "submit", textContent: "Ask" });
    var result = el("div", { className: "aw-result" });
    result.setAttribute("aria-live", "polite");
    form.append(input, submit);
    root.append(note, form, result);
    container.appendChild(root);

    function setState(state, status, answer) {
      result.className = "aw-result is-" + state;
      result.replaceChildren(el("div", { className: "aw-status", textContent: status }));
      if (answer) result.appendChild(el("div", { className: "aw-answer", textContent: answer }));
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var question = input.value.trim();
      if (!question) return;
      submit.disabled = true;
      setState("loading", "Asking…");
      try {
        var res = await fetch(apiBase + "/oracle/sandbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: question }),
        });
        if (!res.ok) throw new Error("backend returned " + res.status);
        var jobId = (await res.json()).jobId;

        for (var i = 0; i < POLL_ATTEMPTS; i++) {
          await sleep(POLL_INTERVAL_MS);
          var job = await (await fetch(apiBase + "/oracle/" + encodeURIComponent(jobId))).json();
          if (job.status !== "settled") continue;
          if (job.outcome === "resolved") setState("resolved", "Resolved", String(job.answer));
          else setState("refunded", "Refunded", job.reason ? String(job.reason) : "No consensus reached.");
          return;
        }
        setState("error", "Still working", "No answer yet — try again in a moment.");
      } catch (err) {
        setState("error", "Couldn't reach Arbiter", err.message);
      } finally {
        submit.disabled = false;
      }
    });
  }

  function init() {
    injectStyles();
    document.querySelectorAll("[data-arbiter-widget]").forEach(mount);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.ArbiterWidget = { mount: function (c) { injectStyles(); mount(c); } };
})();
