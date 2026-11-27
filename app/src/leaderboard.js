import { truncateAddress, formatRatio, workerProfileUrl } from './format.js';
// Deliberately using i18n.js's formatUsdc (not units.js's): this is a
// user-facing display surface, and i18n.js's implementation is the
// locale-aware formatter intended for rendered output. units.js's
// variant is for on-chain/base-unit math. See the dx issue tracking the
// three divergent formatUsdc implementations.
import { formatUsdc } from './i18n.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

// Built with createElement/textContent, not innerHTML — workerId is
// whatever a caller passed as GET /app/events's ?worker= param (no auth
// required for a non-address id, see workerAuth.js::requiresAuth), and
// this table is public and unauthenticated. Interpolating it into HTML
// would be a stored-XSS hole on the one page anyone can load with no
// session at all.
function renderRow(row, rank) {
  const tr = document.createElement('tr');

  const rankCell = document.createElement('td');
  rankCell.textContent = rank;

  const idCell = document.createElement('td');
  idCell.title = row.workerId;
  // Link to the worker's public profile page (issue #86).
  const link = document.createElement('a');
  link.href = workerProfileUrl(row.workerId);
  link.textContent = truncateAddress(row.workerId);
  idCell.appendChild(link);

  const ratioCell = document.createElement('td');
  const ratioSpan = document.createElement('span');
  ratioSpan.className = 'muted small';
  ratioSpan.textContent = `(${row.matched}/${row.totalAnswers})`;
  ratioCell.append(`${formatRatio(row.matchRatio)} `, ratioSpan);

  const totalCell = document.createElement('td');
  totalCell.textContent = row.totalAnswers;

  const stakeCell = document.createElement('td');
  stakeCell.textContent = formatUsdc(row.stake);

  tr.append(rankCell, idCell, ratioCell, totalCell, stakeCell);
  return tr;
}

async function loadLeaderboard() {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="muted small">Loading…</td></tr>';

  try {
    const res = await fetch(`${BACKEND_URL}/leaderboard`);
    if (!res.ok) throw new Error(`backend returned ${res.status}`);
    const { leaderboard } = await res.json();

    if (leaderboard.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted small">No established workers yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    leaderboard.forEach((row, i) => tbody.appendChild(renderRow(row, i + 1)));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted small">Failed to load: ${err.message}</td></tr>`;
  }
}

// Public, unauthenticated activity feed (issue #78). Consumes the
// anonymized settlement stream from the backend's public channel —
// distinct from the worker-only /app/events SSE channel dispatch.js
// gates. Events carry only category/tier/outcome/amount; never workerId
// or payer address. Rendered with createElement/textContent (not
// innerHTML) for the same reason as renderRow above: this is a public
// surface and the payload is caller-influenced.
function renderActivityItem(event) {
  const li = document.createElement('li');
  li.className = 'activity-item';

  const outcome = document.createElement('span');
  outcome.className = `activity-outcome activity-outcome-${event.outcome}`;
  outcome.textContent = event.outcome;

  const detail = document.createElement('span');
  detail.className = 'muted small';
  detail.textContent = `${event.category} · tier ${event.tier} · ${formatUsdc(event.amount)}`;

  li.append(outcome, ' ', detail);
  return li;
}

function initActivityFeed() {
  const list = document.getElementById('activity-feed');
  if (!list) return;

  // Degrade silently when the backend is unreachable: no error UI, no
  // broken element — just leave the feed empty.
  let source;
  try {
    source = new EventSource(`${BACKEND_URL}/activity`);
  } catch {
    return;
  }

  source.addEventListener('settlement', (msg) => {
    let event;
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    // Defensive: never render identifying fields even if a backend
    // regression leaks them into the payload.
    if (event.workerId || event.payer) return;

    list.prepend(renderActivityItem(event));
    while (list.children.length > 20) list.removeChild(list.lastChild);
  });

  source.onerror = () => {
    // Silent degradation — EventSource auto-reconnects; no UI change.
  };
}

// Public route view for the unified app shell (#143). Renders the
// leaderboard and activity feed for any visitor — no session or wallet
// required, matching the previous standalone leaderboard.html. The
// shell mounts this view into its own container, so the DOM ids below
// are looked up lazily at mount time rather than at module load.
export function mountLeaderboard(root) {
  root.innerHTML = `
    <section class="leaderboard-view">
      <header class="leaderboard-header">
        <h1>Leaderboard</h1>
        <button id="btn-refresh" type="button">Refresh</button>
      </header>
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Worker</th>
            <th>Match ratio</th>
            <th>Answers</th>
            <th>Stake</th>
          </tr>
        </thead>
        <tbody id="leaderboard-body"></tbody>
      </table>
      <section class="activity-section">
        <h2>Recent settlements</h2>
        <ul id="activity-feed" class="activity-feed"></ul>
      </section>
    </section>
  `;

  const refreshBtn = root.querySelector('#btn-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadLeaderboard);

  loadLeaderboard();
  initActivityFeed();
}

// --- Accessibility controls for the standalone leaderboard.html (#488) ---
// Handles data-font-decrease / data-font-increase / data-contrast-toggle.
// style.css already provides html { font-size: calc(100% * var(--font-scale)) }
// and :root[data-theme='high-contrast'] palette; we only need to wire the
// buttons and persist choices across reloads.

const FONT_STEP = 0.1;
const FONT_MIN  = 0.7;
const FONT_MAX  = 1.5;

function initAccessibilityControls() {
  const decreaseBtn  = document.querySelector('[data-font-decrease]');
  const increaseBtn  = document.querySelector('[data-font-increase]');
  const statusOutput = document.querySelector('[data-font-status]');
  const contrastBtn  = document.querySelector('[data-contrast-toggle]');

  if (!decreaseBtn && !increaseBtn && !contrastBtn) return;

  // --- Font scale ---
  const savedScale = parseFloat(localStorage.getItem('fontScale') || '1');
  let scale = Number.isFinite(savedScale) ? Math.min(FONT_MAX, Math.max(FONT_MIN, savedScale)) : 1;

  function applyScale(value) {
    scale = value;
    document.documentElement.style.setProperty('--font-scale', scale);
    localStorage.setItem('fontScale', scale);
    if (statusOutput) statusOutput.textContent = `${Math.round(scale * 100)}% text size`;
    if (decreaseBtn) decreaseBtn.disabled = scale <= FONT_MIN;
    if (increaseBtn) increaseBtn.disabled = scale >= FONT_MAX;
  }

  applyScale(scale);

  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', () => {
      applyScale(parseFloat(Math.max(FONT_MIN, scale - FONT_STEP).toFixed(1)));
    });
  }

  if (increaseBtn) {
    increaseBtn.addEventListener('click', () => {
      applyScale(parseFloat(Math.min(FONT_MAX, scale + FONT_STEP).toFixed(1)));
    });
  }

  // --- High contrast toggle ---
  if (contrastBtn) {
    const savedContrast = localStorage.getItem('highContrast') === 'true';
    let contrastOn = savedContrast;

    function applyContrast(on) {
      contrastOn = on;
      document.documentElement.setAttribute('data-theme', on ? 'high-contrast' : '');
      contrastBtn.setAttribute('aria-pressed', String(on));
      localStorage.setItem('highContrast', String(on));
    }

    applyContrast(contrastOn);

    contrastBtn.addEventListener('click', () => applyContrast(!contrastOn));
  }
}

// Only run on the standalone page; mountLeaderboard() covers the app-shell route.
if (document.querySelector('[data-font-decrease], [data-contrast-toggle]')) {
  document.addEventListener('DOMContentLoaded', () => {
    loadLeaderboard();
    initActivityFeed();
    initAccessibilityControls();
  });
}
