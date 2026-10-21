const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const POLL_MS = 30_000;
const TIMEOUT_MS = 8_000;
// A reachable backend that takes this long to answer is reported as
// degraded rather than up — slow is a real, observable signal.
const SLOW_MS = 2_000;

const STATES = {
  up: 'Operational',
  degraded: 'Degraded',
  down: "Can't reach backend",
};

function setState(state, detail) {
  const indicator = document.getElementById('status-indicator');
  indicator.className = `status-indicator status-${state}`;
  document.getElementById('status-label').textContent = STATES[state];
  document.getElementById('status-detail').textContent = detail;
}

function formatCount(n) {
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

function renderStats(stats) {
  document.getElementById('stat-resolved').textContent = formatCount(stats.totalResolved);
  document.getElementById('stat-refunded').textContent = formatCount(stats.totalRefunded);
  document.getElementById('stat-workers').textContent = formatCount(stats.onlineWorkers);
  document.getElementById('status-stats').hidden = false;
}

// statusChannel.js falls back to a per-tab EventSource when navigator.locks
// is unavailable, which means push updates can go stale across tabs. Surface
// that mode so "shared push" and "per-tab" are visibly distinguishable.
function renderChannelMode() {
  const el = document.getElementById('status-channel');
  if (!el) return;
  const shared = typeof navigator !== 'undefined' && 'locks' in navigator;
  el.textContent = shared
    ? 'Live updates: shared across tabs.'
    : 'Live updates: per-tab only (cross-tab updates may lag).';
  el.dataset.mode = shared ? 'shared' : 'per-tab';
}

// State is derived only from this live check, the same honest way
// landing/script.js's trustLive does it: on failure we say so, and hide
// the numbers rather than leaving stale ones looking current.
async function checkStatus() {
  const checkedAt = new Date().toLocaleTimeString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();

  try {
    const res = await fetch(`${BACKEND_URL}/stats`, { signal: controller.signal });
    const elapsed = Math.round(performance.now() - started);

    if (!res.ok) {
      document.getElementById('status-stats').hidden = true;
      setState('degraded', `Backend responded with HTTP ${res.status} (checked ${checkedAt}).`);
      return;
    }

    renderStats(await res.json());
    if (elapsed > SLOW_MS) {
      setState('degraded', `Backend is slow to respond: ${elapsed} ms (checked ${checkedAt}).`);
    } else {
      setState('up', `Backend responded in ${elapsed} ms (checked ${checkedAt}).`);
    }
  } catch (err) {
    document.getElementById('status-stats').hidden = true;
    const reason = err.name === 'AbortError' ? `no response within ${TIMEOUT_MS / 1000}s` : err.message;
    setState('down', `Could not reach ${BACKEND_URL}: ${reason} (checked ${checkedAt}).`);
  } finally {
    clearTimeout(timer);
  }
}

// Polling only while the tab is visible: a hidden tab has no one reading
// the status, so the interval is paused to avoid pointless network/CPU
// churn. On return we check immediately so the displayed state is fresh
// rather than up to POLL_MS stale.
let pollTimer = null;

function startPolling() {
  if (pollTimer !== null) return;
  pollTimer = setInterval(checkStatus, POLL_MS);
}

function stopPolling() {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

document.getElementById('btn-refresh').addEventListener('click', checkStatus);
renderChannelMode();
checkStatus();
if (document.visibilityState === 'visible') {
  startPolling();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkStatus();
    startPolling();
  } else {
    stopPolling();
  }
});
