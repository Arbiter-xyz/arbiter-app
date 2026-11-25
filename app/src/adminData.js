// Pure helpers for the admin console (admin.js touches the DOM on import, so
// the data shaping it relies on lives here where it can be unit-tested).
import { usdcFromStroops } from './units.js';

/**
 * Exact USDC text for a stroop amount, for the Transactions table (issue #451).
 * Never rounds: 1 stroop is `0.0000001`. Trailing zeros beyond two decimals are
 * trimmed (`12.5000000` → `12.50`). Missing amounts render as `—`.
 */
export function formatStroopsUsdc(amountStroops) {
  if (amountStroops === undefined || amountStroops === null || amountStroops === '') return '—';
  let text;
  try {
    text = usdcFromStroops(amountStroops);
  } catch {
    return '—';
  }
  const [whole, frac] = text.split('.');
  const trimmed = frac.replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${trimmed}`;
}

/**
 * Workers to list in the Fraud & Trust table (issue #450): established workers
 * with a match ratio strictly below `threshold`, lowest ratio first.
 */
export function fraudCandidates(workers, threshold) {
  return workers
    .filter((w) => w.established && w.matchRatio !== null && w.matchRatio !== undefined && w.matchRatio < threshold)
    .sort((a, b) => a.matchRatio - b.matchRatio);
}
