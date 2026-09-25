(() => {
  "use strict";

  /* -------------------------------------------------------------------
     Mobile nav toggle
  ------------------------------------------------------------------- */
  const navToggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("primary-nav");

  function closeNav() {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeNav);
    });

    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && nav.classList.contains("is-open")) {
        closeNav();
        navToggle.focus();
      }
    });

    document.addEventListener("click", (evt) => {
      if (!nav.classList.contains("is-open")) return;
      if (nav.contains(evt.target) || navToggle.contains(evt.target)) return;
      closeNav();
    });
  }

  /* -------------------------------------------------------------------
     Scroll-reveal — pure progressive enhancement. Content is visible by
     default (see .reveal in CSS); we only opt INTO the hidden-until-
     visible animation once we know IntersectionObserver exists and the
     user hasn't asked for reduced motion.
  ------------------------------------------------------------------- */
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if ("IntersectionObserver" in window && !prefersReducedMotion) {
    document.documentElement.classList.add("js-reveal-ready");

    const revealEls = document.querySelectorAll(".reveal");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );

    revealEls.forEach((el) => observer.observe(el));

    // Safety net: IntersectionObserver normally fires reliably as a user
    // scrolls, but anything that can capture/render the page without a
    // real scroll (full-page screenshot tools, some prerendering/print
    // paths) can bypass it entirely — which would leave real content
    // permanently invisible. That's an unacceptable failure mode for a
    // page whose entire job is to be read, so force everything visible
    // shortly after load regardless of intersection state. Scrolling to
    // content within that window still gets the nice animate-in; anything
    // else just becomes visible a beat later instead of never.
    window.setTimeout(() => {
      revealEls.forEach((el) => el.classList.add("is-visible"));
      observer.disconnect();
    }, 2500);
  }

  /* -------------------------------------------------------------------
     Copy-to-clipboard on code snippets — genuinely useful for a
     developer-facing page, not decorative. Injected via JS so the
     snippet degrades to plain, manually-selectable text if this fails.
  ------------------------------------------------------------------- */
  document.querySelectorAll(".terminal").forEach((terminal) => {
    const bar = terminal.querySelector(".terminal-bar");
    const codeEl = terminal.querySelector("code");
    if (!bar || !codeEl || !navigator.clipboard) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code to clipboard");
    bar.appendChild(button);

    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(codeEl.textContent.trim());
        button.textContent = "Copied";
        button.classList.add("copy-btn-done");
      } catch (err) {
        button.textContent = "Press ⌘/Ctrl+C";
      }
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("copy-btn-done");
      }, 2000);
    });
  });

  /* -------------------------------------------------------------------
     "Try it now" sandbox widget — a real call to a real Arbiter backend's
     zero-payment sandbox endpoint, live in the hero itself rather than a
     mockup or a link further down the page. This is the single
     highest-leverage UX fix for a prospective integrator: seeing one real
     response, with zero wallet/testnet-USDC setup, before scrolling past
     the first screen. Degrades honestly (not silently) if no backend is
     reachable — this static page has no way to know whether one is
     running locally.
  ------------------------------------------------------------------- */
  const API_BASE = "https://arbiter-backend-production-4e43.up.railway.app";

  const tryItForm = document.getElementById("try-it-form");
  const tryItInput = document.getElementById("try-it-input");
  const tryItResult = document.getElementById("try-it-result");
  const tryItSubmit = document.getElementById("try-it-submit");

  // The hero widget is already visible without scrolling on desktop (it
  // sits beside the copy, not below it) — this only matters on mobile,
  // where the two columns stack and "Ask a question live" needs to jump
  // the visitor down to it and drop them straight into the input.
  if (tryItInput) {
    document.querySelectorAll('a[href="#try-it-input"]').forEach((link) => {
      link.addEventListener("click", () => {
        window.setTimeout(() => tryItInput.focus(), 400);
      });
    });
  }

  /* -------------------------------------------------------------------
     Voice input for the try-it widget — typing a full question on a
     phone keyboard is real friction for exactly the frictionless
     first-impression this hero is built to deliver. Uses the Web Speech
     API where available and only ever fills the same #try-it-input the
     existing submit handler already reads from, so the submission path
     to /oracle/sandbox is untouched. Where SpeechRecognition is absent
     (notably most non-Chrome mobile browsers) the button is never shown
     at all, matching trustLive's silent-absence-on-failure pattern
     rather than presenting a broken affordance.
  ------------------------------------------------------------------- */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const tryItMic = document.getElementById("try-it-mic");

  if (tryItMic && tryItInput && SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = document.documentElement.lang || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    let listening = false;
    let baseText = "";

    function setListening(next) {
      listening = next;
      tryItMic.classList.toggle("is-listening", listening);
      tryItMic.setAttribute("aria-pressed", String(listening));
      tryItMic.setAttribute("aria-label", listening ? "Stop voice input" : "Ask by voice");
    }

    recognition.addEventListener("result", (evt) => {
      let transcript = "";
      for (let i = evt.resultIndex; i < evt.results.length; i += 1) {
        transcript += evt.results[i][0].transcript;
      }
      const prefix = baseText ? `${baseText} ` : "";
      tryItInput.value = `${prefix}${transcript}`.trim();
    });

    recognition.addEventListener("error", () => setListening(false));
    recognition.addEventListener("end", () => setListening(false));

    tryItMic.addEventListener("click", () => {
      if (listening) {
        recognition.stop();
        return;
      }
      baseText = tryItInput.value.trim();
      try {
        recognition.start();
        setListening(true);
      } catch (err) {
        setListening(false);
      }
    });

    // Only reveal the affordance once we know the API exists — the button
    // ships hidden in the markup so unsupported browsers never flash it.
    tryItMic.hidden = false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setTryItState(state, status, answer) {
    if (!tryItResult) return;
    tryItResult.className = `try-it-result is-${state}`;
    tryItResult.innerHTML = "";

    const statusEl = document.createElement("span");
    statusEl.className = "try-it-status";
    statusEl.textContent = status;
    tryItResult.appendChild(statusEl);

    if (answer) {
      const answerEl = document.createElement("p");
      answerEl.className = "try-it-answer";
      answerEl.textContent = answer;
      tryItResult.appendChild(answerEl);
    }
  }

  if (tryItForm) {
    tryItForm.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const question = tryItInput.value.trim();
      if (!question) return;

      tryItSubmit.disabled = true;
      setTryItState("loading", "Sending to sandbox…");

      try {
        const res = await fetch(`${API_BASE}/oracle/sandbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `unexpected status ${res.status}`);
        }
        const { statusUrl } = await res.json();

        let job = null;
        for (let i = 0; i < 30; i += 1) {
          const pollRes = await fetch(`${API_BASE}${statusUrl}`);
          job = await pollRes.json();
          if (job.status === "settled") break;
          setTryItState("loading", job.status === "reconciling" ? "Reconciling answers…" : "Waiting for sandbox workers…");
          await sleep(300);
        }

        if (!job || job.status !== "settled") {
          throw new Error("timed out waiting for a result");
        }

        if (job.outcome === "resolved") {
          setTryItState("resolved", `Resolved (sandbox) · confidence ${job.confidence}`, job.answer);
        } else {
          setTryItState("refunded", `Refunded (sandbox) · ${job.reason}`);
        }
      } catch (err) {
        setTryItState(
          "error",
          `Couldn't reach the API (${err.message}). Run the A

/* … truncated 1142 chars — edit only what you need near the top … */
