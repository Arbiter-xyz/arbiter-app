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
