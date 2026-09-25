/* Arbiter "Ask" widget — drop-in, dependency-free, sandbox-only.
 *
 * Usage on any host page:
 *   <div data-arbiter-widget></div>
 *   <script src="https://<host>/widget.js" data-api-base="https://your-backend"></script>
 *
 * Same contract as landing/script.js and demo-agent/sandbox-ask.js:
 * POST /oracle/sandbox → poll GET /oracle/:jobId until status === "settled".
 * No payment, no chain, no signup.
 */
(function () {
  "use strict";
  var DEFAULT_API = "https://arbiter-backend-production-4e43.up.railway.app";
  var POLL_MAX = 30;
  var POLL_MS = 300;
  var script = document.currentScript;
  var scriptApi = script && script.getAttribute("data-api-base");

  var CSS =
    ".arb-w{font:14px/1.4 system-ui,sans-serif;border:1px solid #ccc;border-radius:10px;padding:12px;max-width:420px;background:#fff;color:#111}" +
    ".arb-w form{display:flex;gap:6px}.arb-w input{flex:1;padding:8px;border:1px solid #bbb;border-radius:6px}" +
    ".arb-w button{padding:8px 12px;border:0;border-radius:6px;background:#111;color:#fff;cursor:pointer}" +
    ".arb-w button:disabled{opacity:.5}.arb-w .arb-note{font-size:12px;color:#666;margin-top:6px}" +
    ".arb-w .arb-out{margin-top:10px}.arb-w .is-refunded,.arb-w .is-error{color:#a33}";

  function injectCss() {
    if (document.getElementById("arb-w-css")) return;
    var s = document.createElement("style");
    s.id = "arb-w-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function mount(el) {
    if (el.__arbiter) return;
    el.__arbiter = true;
    var api = (el.getAttribute("data-api-base") || scriptApi || DEFAULT_API).replace(/\/$/, "");
    el.classList.add("arb-w");
    el.innerHTML =
      '<form><input type="text" required maxlength="500" placeholder="Ask Arbiter a question…" aria-label="Question">' +
      '<button type="submit">Ask</button></form>' +
      '<div class="arb-note">Sandbox demo — no payment, no chain, no signup.</div>' +
      '<div class="arb-out" aria-live="polite"></div>';
    var form = el.querySelector("form");
    var input = el.querySelector("input");
    var btn = el.querySelector("button");
    var out = el.querySelector(".arb-out");

    function setState(state, status, answer) {
      out.className = "arb-out is-" + state;
      out.textContent = "";
      var p = document.createElement("div");
      p.textContent = status;
      out.appendChild(p);
      if (answer != null) {
        var a = document.createElement("strong");
        a.textContent = typeof answer === "string" ? answer : JSON.stringify(answer);
        out.appendChild(a);
      }
    }

    function render(job) {
      if (job.refunded || job.outcome === "refunded") {
        setState("refunded", "No consensus — would have been refunded.");
      } else {
        setState("resolved", "Resolved:", job.answer != null ? job.answer : job.outcome);
      }
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var question = input.value.trim();
      if (!question) return;
      btn.disabled = true;
      setState("loading", "Asking workers…");
      try {
        var res = await fetch(api + "/oracle/sandbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: question }),
        });
        if (!res.ok) throw new Error("request failed (" + res.status + ")");
        var job = await res.json();
        if (!job.jobId || job.status === "settled") return render(job);
        for (var i = 0; i < POLL_MAX; i++) {
          await sleep(POLL_MS);
          var poll = await fetch(api + "/oracle/" + encodeURIComponent(job.jobId));
          if (!poll.ok) continue;
          var j = await poll.json();
          if (j.status === "settled") return render(j);
          setState("loading", "Waiting for consensus… (" + (j.totalAnswers || 0) + " answers)");
        }
        setState("error", "Timed out waiting for an answer — try again.");
      } catch (err) {
        setState("error", "Couldn't reach Arbiter: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function init() {
    injectCss();
    document.querySelectorAll("[data-arbiter-widget]").forEach(mount);
  }

  window.ArbiterWidget = { mount: function (el) { injectCss(); mount(el); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
