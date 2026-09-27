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
     Live pricing calculator (#pricing) — lets a visitor pick a tier and
     see the current estimated price without connecting a wallet. The
     number comes from the backend's /price endpoint, which runs the same
     pricing.js surge logic the /oracle 402 challenge snapshots at quote
     time — so this is the real price, not a client-side re-derivation.
     If the endpoint is unreachable we fall back to the static base price
     and label the result as an approximation.
  ------------------------------------------------------------------- */
  const pricingGrid = document.querySelector(".pricing-grid");

  if (pricingGrid) {
    const TIERS = [
      { id: "instant", label: "Instant", base: 0.05 },
      { id: "standard", label: "Standard", base: 0.25 },
      { id: "express", label: "Express", base: 0.4 },
      { id: "priority", label: "Priority", base: 0.6 },
    ];

    const calc = document.createElement("div");
    calc.className = "pricing-calculator";

    const heading = document.createElement("h3");
    heading.textContent = "Estimate your cost";

    const tierRow = document.createElement("div");
    tierRow.className = "pricing-calculator-tiers";
    tierRow.setAttribute("role", "group");
    tierRow.setAttribute("aria-label", "Select a pricing tier");

    const output = document.createElement("p");
    output.className = "pricing-calculator-output";
    output.setAttribute("aria-live", "polite");

    const note = document.createElement("p");
    note.className = "pricing-calculator-note";

    let selected = TIERS[1];
    let livePrices = null;

    function render() {
      const live = livePrices && typeof livePrices[selected.id] === "number"
        ? livePrices[selected.id]
        : null;
      const price = live !== null ? live : selected.base;
      output.textContent = `${selected.label}: ${price.toFixed(2)} USDC per request`;
      note.textContent = live !== null
        ? "Live price from the backend's current surge calculation."
        : "Approximate base price — live pricing is temporarily unavailable.";
    }

    TIERS.forEach((tier) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pricing-calculator-tier";
      btn.textContent = tier.label;
      btn.setAttribute("aria-pressed", String(tier.id === selected.id));
      btn.addEventListener("click", () => {
        selected = tier;
        tierRow.querySelectorAll("button").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        render();
      });
      tierRow.appendChild(btn);
    });

    calc.appendChild(heading);
    calc.appendChild(tierRow);
    calc.appendChild(output);
    calc.appendChild(note);
    pricingGrid.insertAdjacentElement("afterend", calc);

    render();

    fetch("/price")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || typeof data !== "object") return;
        const prices = data.prices && typeof data.prices === "object" ? data.prices : data;
        const next = {};
        TIERS.forEach((tier) => {
          if (typeof prices[tier.id] === "number") next[tier.id] = prices[tier.id];
        });
        if (Object.keys(next).length) {
          livePrices = next;
          render();
        }
      })
      .catch(() => {
        /* keep the labeled approximation already rendered */
      });
  }

  /* -------------------------------------------------------------------
     Compare-tiers slider (#pricing) — a presentation layer over the same
     four tiers' already-documented real values (base price, quorum size,
     answer window) that the static .pricing-grid cards list. The cards
     remain the no-JS / reduced-motion fallback; this control is only
     injected when motion is allowed, and it never invents numbers —
     confidence stays qualitative, matching the existing copy.
  ------------------------------------------------------------------- */
  if (pricingGrid && !prefersReducedMotion) {
    const COMPARE_TIERS = [
      { label: "Instant", price: 0.05, quorum: 1, window: "30s", confidence: "Single worker — fastest, least redundant" },
      { label: "Standard", price: 0.25, quorum: 2, window: "20s", confidence: "Two-worker agreement" },
      { label: "Express", price: 0.4, quorum: 2, window: "12s", confidence: "Two-worker agreement, tighter deadline" },
      { label: "Priority", price: 0.6, quorum: 3, window: "8s", confidence: "Highest-confidence consensus" },
    ];

    const compare = document.createElement("div");
    compare.className = "pricing-compare";

    const compareHeading = document.createElement("h3");
    compareHeading.textContent = "Compare tiers";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "pricing-compare-slider";
    slider.min = "0";
    slider.max = String(COMPARE_TIERS.length - 1);
    slider.step = "1";
    slider.value = "1";
    slider.setAttribute("aria-label", "Compare pricing tiers");

    const readout = document.createElement("div");
    readout.className = "pricing-compare-readout";
    readout.setAttribute("aria-live", "polite");

    function renderCompare() {
      const tier = COMPARE_TIERS[Number(slider.value)];
      readout.textContent = "";

      const name = document.createElement("p");
      name.className = "pricing-compare-tier";
      name.textContent = tier.label;

      const price = document.createElement("p");
      price.className = "pricing-compare-price";
      price.textContent = `${tier.price.toFixed(2)} USDC per request`;

      const detail = document.createElement("p");
      detail.className = "pricing-compare-detail";
      detail.textContent = `Quorum of ${tier.quorum} worker${tier.quorum === 1 ? "" : "s"} · ${tier.window} answer window`;

      const confidence = document.createElement("p");
      confidence.className = "pricing-compare-confidence";
      confidence.textContent = tier.confidence;

      readout.appendChild(name);
      readout.appendChild(price);
      readout.appendChild(detail);
      readout.appendChild(confidence);
    }

    slider.addEventListener("input", renderCompare);

    compare.appendChild(compareHeading);
    compare.appendChild(slider);
    compare.appendChild(readout);
    pricingGrid.insertAdjacentElement("afterend", compare);

    renderCompare();
  }

  /* -------------------------------------------------------------------
     Interactive architecture diagram (#architecture) — a hand-authored
     SVG mirroring the README's ASCII flow (app/demo-agent → backend
     server.js → 

/* … truncated 3811 chars — edit only what you need near the top … */
