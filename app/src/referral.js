// Worker referral links (issue #84).
//
// Backend contract (arbiter-backend, store.js-backed like Stake/Owed):
//   POST /workers/:address/referral        (Bearer session) -> { code }
//   GET  /workers/:address/referral/stats  (Bearer session) -> { referred, established }
// Attribution happens at sponsored onboarding: the stored ?ref= code is sent
// as `referralCode` in the POST /sponsor/onboard/build body. Counts are only
// readable by the referring worker's own session — no public surface.
// Rewards are reputational only (a visible count); no USDC reward.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const STORAGE_KEY = 'arbiter.referralCode';
const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;

// Capture an inbound ?ref= code so onboarding can attribute it later.
export function captureReferralCode() {
  const code = new URLSearchParams(location.search).get('ref');
  if (!code || !CODE_RE.test(code)) return;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // storage unavailable — attribution is best-effort
  }
}

// Returns the pending referral code (if any) and clears it, for inclusion
// in the sponsored-onboarding request body.
export function consumeReferralCode() {
  try {
    const code = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    return code && CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function referralLink(code) {
  return `${location.origin}/index.html?ref=${encodeURIComponent(code)}`;
}

async function authedFetch(path, token, init = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

// Wires the referral block in the earnings panel. The console dispatches
// `arbiter:session` ({ address, token }) once ensureSession() succeeds.
export function initReferralPanel() {
  const btn = document.getElementById('btn-referral');
  const input = document.getElementById('referral-link');
  const stats = document.getElementById('referral-stats');
  if (!btn || !input || !stats) return;

  let session = null;

  async function refreshStats() {
    if (!session) return;
    try {
      const { referred = 0, established = 0 } = await authedFetch(
        `/workers/${session.address}/referral/stats`,
        session.token,
      );
      stats.textContent = `${referred} referred · ${established} reached established status`;
    } catch {
      stats.textContent = '';
    }
  }

  window.addEventListener('arbiter:session', (e) => {
    session = e.detail;
    btn.disabled = false;
    refreshStats();
  });

  btn.addEventListener('click', async () => {
    if (!session) return;
    btn.disabled = true;
    try {
      const { code } = await authedFetch(`/workers/${session.address}/referral`, session.token, { method: 'POST' });
      input.value = referralLink(code);
      input.classList.remove('hidden');
      try {
        await navigator.clipboard.writeText(input.value);
        stats.textContent = 'Link copied to clipboard.';
      } catch {
        input.select();
      }
    } catch (err) {
      stats.textContent = `Could not create referral link: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

captureReferralCode();
initReferralPanel();
