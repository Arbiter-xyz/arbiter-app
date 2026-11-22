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

// Formats a USDC amount (in whole units) for display, e.g. 1234.5 -> "1,234.50".
// Null/undefined-safe so balance lines render even when a value is missing.
// Exported here so consumers (leaderboard.js, admin.js) can import it instead
// of referencing an undefined global (issue #235).
export function formatUsdc(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return '—';
  }
  return Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Renders a labeled balance figure for the admin Treasury tab. Wraps
// formatUsdc with an optional label so each balance line (platform, fiat
// pool, etc.) shows a formatted amount instead of throwing.
export function balanceFigure(amount, label) {
  const figure = formatUsdc(amount);
  return label ? `${label}: ${figure}` : figure;
}

// Builds the og:image URL for a worker profile page (issue #246). worker.js
// imported this from format.js but it was never defined there, so the
// og-image assignment threw on every load. Kept null-safe so a missing
// worker id falls back to the site-wide default image instead of throwing.
const DEFAULT_OG_IMAGE = 'https://handsoff.app/og-default.png';

export function workerOgImageUrl(workerId) {
  if (!workerId) return DEFAULT_OG_IMAGE;
  return `https://handsoff.app/og/worker/${encodeURIComponent(workerId)}.png`;
}
