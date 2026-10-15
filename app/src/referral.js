// Worker referral links (issues #84, #205).
//
// Backend contract (arbiter-backend referrals.js):
//   POST /workers/:address/referral-code   body: { token }  -> { code }
//   GET  /workers/:address/referrals?token=<token>          -> { referrer, code, referees, counts: { pending, qualified, disqualified } }

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

async function fetchReferralSummary(address, token) {
  const url = new URL(`${BACKEND_URL}/workers/${encodeURIComponent(address)}/referrals`);
  url.searchParams.set('token', token);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

async function createReferralCode(address, token) {
  const res = await fetch(`${BACKEND_URL}/workers/${encodeURIComponent(address)}/referral-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
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
      const data = await fetchReferralSummary(session.address, session.token);
      const counts = data?.counts || {};
      const qualified = counts.qualified ?? 0;
      const pending = counts.pending ?? 0;
      const disqualified = counts.disqualified ?? 0;
      const referred = Array.isArray(data?.referees)
        ? data.referees.length
        : pending + qualified + disqualified;
      if (data?.code) {
        input.value = referralLink(data.code);
        input.classList.remove('hidden');
      }
      stats.textContent = `${referred} referred (${pending} pending · ${qualified} qualified)`;
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
      const { code } = await createReferralCode(session.address, session.token);
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
