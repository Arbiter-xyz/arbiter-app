// Shared display helpers for the public pages (leaderboard, worker profile).

export function truncateAddress(id) {
  if (id.length <= 16 || !id.startsWith('G')) return id;
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

export function formatRatio(ratio) {
  return ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(1)}%`;
}

// Public profile URL for a worker (issue #86).
export function workerProfileUrl(id) {
  return `/worker.html?address=${encodeURIComponent(id)}`;
}

// Backend-rendered Open Graph card for a worker (issue #85). The PNG itself
// is rendered by arbiter-backend from already-public leaderboard data.
export function workerOgImageUrl(backendUrl, id) {
  return `${backendUrl}/og/workers/${encodeURIComponent(id)}.png`;
}
