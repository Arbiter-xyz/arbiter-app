// Public worker profile page (issue #86). Reads only already-public,
// unauthenticated endpoints — no owed balance or session data here.
import { truncateAddress, formatRatio, workerOgImageUrl } from './format.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

const $ = (id) => document.getElementById(id);

async function getJson(path) {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

async function loadProfile() {
  const address = new URLSearchParams(location.search).get('address');
  if (!address) {
    $('profile-address').textContent = 'No worker address given';
    return;
  }

  // textContent throughout: the address comes from the URL.
  $('profile-address').textContent = truncateAddress(address);
  $('profile-address').title = address;
  document.title = `Arbiter — Worker ${truncateAddress(address)}`;
  const og = workerOgImageUrl(BACKEND_URL, address);
  $('og-image').setAttribute('content', og);
  $('twitter-image').setAttribute('content', og);

  const [rep, stake, board] = await Promise.allSettled([
    getJson(`/workers/${encodeURIComponent(address)}/reputation`),
    getJson(`/workers/${encodeURIComponent(address)}/stake`),
    getJson('/leaderboard'),
  ]);

  if (rep.status === 'fulfilled') {
    const r = rep.value;
    const ratio = r.matchRatio ?? (r.totalAnswers ? r.matched / r.totalAnswers : null);
    $('profile-ratio').textContent = `${formatRatio(ratio)} (${r.matched ?? 0}/${r.totalAnswers ?? 0})`;
    $('profile-answers').textContent = r.totalAnswers ?? 0;
  }
  if (stake.status === 'fulfilled') {
    $('profile-stake').textContent = `${stake.value.stake ?? 0} USDC`;
  }

  const rows = board.status === 'fulfilled' ? board.value.leaderboard : [];
  const idx = rows.findIndex((row) => row.workerId === address);
  if (idx >= 0) {
    $('profile-rank').textContent = `#${idx + 1}`;
  } else {
    // Un-established workers are excluded from the leaderboard
    // (isEstablishedWorker); show the page but say so plainly.
    $('profile-status').textContent = 'Not yet ranked — only established workers appear on the leaderboard.';
  }

  if (rep.status === 'rejected' && stake.status === 'rejected') {
    $('profile-status').textContent = `Failed to load: ${rep.reason.message}`;
  }
}

loadProfile();
