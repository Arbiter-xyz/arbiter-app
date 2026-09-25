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

document.getElementById('btn-refresh').addEventListener('click', checkStatus);
checkStatus();
setInterval(checkStatus, POLL_MS);
