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
     Interactive architecture diagram (#architecture) — a hand-authored
     SVG mirroring the README's ASCII flow (app/demo-agent → backend
     server.js → oracle.js → dispatch.js/reconcile.js → oracle-escrow
     contract → USDC SAC, with Claude as reconciliation-only). Nodes are
     clickable and reveal the real README detail for each component.
     Progressive enhancement: the SVG and its labels are fully legible
     without JS; this only wires up the click-to-expand detail panel.
  ------------------------------------------------------------------- */
  const archDiagram = document.getElementById("architecture-diagram");
  const archDetail = document.getElementById("architecture-detail");

  if (archDiagram && archDetail) {
    const nodes = Array.from(archDiagram.querySelectorAll("[data-arch-node]"));

    const ARCH_DETAIL = {
      app: {
        title: "app / demo-agent",
        body: "The client that submits a question and pays for an answer. The demo agent (and any integrator's app) POSTs to the backend's /ask endpoint, then polls for the reconciled result. It never talks to the contract or Claude directly.",
      },
      backend: {
        title: "backend (server.js)",
        body: "Express server exposing /ask, /sandbox, and /health. server.js orchestrates the request: it calls oracle.js to fan the question out to the model providers, then hands the collected answers to dispatch.js and reconcile.js.",
      },
      oracle: {
        title: "oracle.js",
        body: "Fans a single question out to multiple model providers in parallel and collects their answers. This is the quorum step — the backend needs several independent answers before it can reconcile.",
      },
      dispatch: {
        title: "dispatch.js / reconcile.js",
        body: "dispatch.js sends the question to the providers; reconcile.js compares the returned answers, picks the consensus result, and decides whether the answer is trustworthy enough to settle. Claude is used here only as a reconciliation aid — never as a primary answer source.",
      },
      claude: {
        title: "Claude (reconciliation-only)",
        body: "Claude is not one of the answering providers. It is invoked only during reconciliation to help judge agreement between the other providers' answers. It has no role in dispatch and cannot unilaterally settle a payment.",
      },
      contract: {
        title: "oracle-escrow (Soroban contract)",
        body: "The on-chain escrow that holds funds until an answer is reconciled. Public entry points: submit (record a reconciled answer), resolve (release payment to the provider), refund (return funds to the asker), refund_timeout (refund after the deadline passes), stake / unstake (provider collateral), and withdraw (pull accrued balances).",
      },
      usdc: {
        title: "USDC SAC",
        body: "The Stellar Asset Contract wrapping USDC. oracle-escrow moves real USDC through this SAC for every stake, resolve, refund, and withdraw — the contract never holds a bespoke token.",
      },
    };

    function showArchDetail(key) {
      const detail = ARCH_DETAIL[key];
      if (!detail) return;
      archDetail.innerHTML = "";
      const heading = document.createElement("h3");
      heading.textContent = detail.title;
      const para = document.createElement("p");
      para.textContent = detail.body;
      archDetail.appendChild(heading);
      archDetail.appendChild(para);
    }

    nodes.forEach((node) => {
      const key = node.getAttribute("data-arch-node");
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", `Show details for ${ARCH_DETAIL[key] ? ARCH_DETAIL[key].title : key}`);

      const activate = () => {
        nodes.forEach((n) => n.classList.remove("is-selected"));
        node.classList.add("is-selected");
        showArchDetail(key);
      };

      node.addEventListener("click", activate);
      node.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          activate();
        }
      });
    });
  }

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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* -------------------------------------------------------------------
     #how-it-works flow animation — a self-contained, generic visual of
     the four stages (dispatch → quorum answers → reconciliation →
     settlement). It is driven by the real sandbox lifecycle when a
     try-it submission is in flight (see setTryItState below), and
     otherwise idles on a clearly generic loop that never implies a
     specific fabricated transaction. Respects prefers-reduced-motion by
     rendering the static, fully-lit end state instead of animating.
  ------------------------------------------------------------------- */
  const flowEl = document.getElementById("flow-animation");
  const flowStages = flowEl ? Array.from(flowEl.querySelectorAll("[data-flow-stage]")) : [];
  const FLOW_STAGES = ["dispatch", "answers", "reconcile", "settle"];

  function setFlowStage(stage) {
    if (!flowStages.length) return;
    const activeIndex = FLOW_STAGES.indexOf(stage);
    flowStages.forEach((el) => {
      const idx = FLOW_STAGES.indexOf(el.getAttribute("data-flow-stage"));
      el.classList.toggle("is-active", idx === activeIndex);
      el.classList.toggle("is-done", activeIndex >= 0 && idx < activeIndex);
    });
  }

  let flowIdleTimer = null;

  function stopFlowIdle() {
    if (flowIdleTimer !== null) {
      window.clearInterval(flowIdleTimer);
      flowIdleTimer = null;
    }
  }

  function startFlowIdle() {
    if (!flowStages.length || prefersReducedMotion) return;
    stopFlowIdle();
    let i = 0;
    setFlowStage(FLOW_STAGES[i]);
    flowIdleTimer = window.setInterval(() => {
      i = (i + 1) % FLOW_STAGES.length;
      setFlowStage(FLOW_STAGES[i]);
    }, 2200);
  }

  if (flowStages.length) {
    if (prefersReducedMotion) {
      // Static, fully-lit end state — no motion, but the flow is still shown.
      flowStages.forEach((el) => el.classList.add("is-done"));
    } else {
      startFlowIdle();
    }
  }

  function setTryItState(state, status, answer) {
    if (!tryItResult) return;
    tryItResult.className = `try-it-result is-${state}`;
    tryItResult.innerHTML = "";


/* … truncated 2652 chars — edit only what you need near the top … */
