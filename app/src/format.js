// Shared formatting helpers for anything rendering a worker id or a match
// ratio (issue #26). Previously hand-duplicated in leaderboard.js and
// admin.js, which had already drifted: admin.js's copies were null/
// undefined-safe and leaderboard.js's were not, so leaderboard.js would
// throw on a falsy/undefined workerId or matchRatio. This module keeps the
// more defensive (admin.js) behavior as the one implementation.

export function truncateAddress(id) {
  if (!id || id.length <= 16 || !id.startsWith('G')) return id || '—';
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

export function formatRatio(ratio) {
  return ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(1)}%`;
}

// og:image URL for a worker profile page (issue #229). The backend has no
// per-worker image route, so this returns the same /og/leaderboard.png that
// worker.html's static placeholder already uses; `address` is accepted so a
// per-worker route can be added here without touching callers.
export function workerOgImageUrl(backendUrl, address) { // eslint-disable-line no-unused-vars
  return `${String(backendUrl || '').replace(/\/+$/, '')}/og/leaderboard.png`;
}
