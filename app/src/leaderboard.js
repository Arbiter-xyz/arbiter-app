const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

function truncateAddress(id) {
  if (id.length <= 16 || !id.startsWith('G')) return id;
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

function formatRatio(ratio) {
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`;
}

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
  idCell.textContent = truncateAddress(row.workerId);

  const ratioCell = document.createElement('td');
  const ratioSpan = document.createElement('span');
  ratioSpan.className = 'muted small';
  ratioSpan.textContent = `(${row.matched}/${row.totalAnswers})`;
  ratioCell.append(`${formatRatio(row.matchRatio)} `, ratioSpan);

  const totalCell = document.createElement('td');
  totalCell.textContent = row.totalAnswers;

  const stakeCell = document.createElement('td');
  stakeCell.textContent = `${row.stake} USDC`;

  tr.append(rankCell, idCell, ratioCell, totalCell, stakeCell);
  return tr;
}

async function loadLeaderboard() {
  const tbody = document.getElementById('leaderboard-body');
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
  detail.textContent = `${event.category} · tier ${event.tier} · ${event.amount} USDC`;

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

document.getElementById('btn-refresh').addEventListener('click', loadLeaderboard);
loadLeaderboard();
initActivityFeed();
