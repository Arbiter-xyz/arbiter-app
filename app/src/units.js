/** Parses a USDC amount string (e.g. "1.5") typed by a user into stroops
 * (7 decimal places), matching the contract's i128 stroop denomination. */
export function stroopsFromUsdcInput(value) {
  const trimmed = String(value).trim();
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new Error('enter a positive amount with up to 7 decimal places');
  }
  const [whole, frac = ''] = trimmed.split('.');
  const paddedFrac = frac.padEnd(7, '0');
  return BigInt(whole) * 10_000_000n + BigInt(paddedFrac || '0');
}

export function usdcFromStroops(stroops) {
  const s = BigInt(stroops);
  const whole = s / 10_000_000n;
  const frac = (s % 10_000_000n).toString().padStart(7, '0');
  return `${whole}.${frac}`;
}

const DISPLAY_PRECISION_KEY = 'arbiter:usdc-display-precision';

/** Display-only preference; all stroop parsing and contract math stay exact. */
export function formatUsdc(value) {
  const precision = localStorage.getItem(DISPLAY_PRECISION_KEY) === '7' ? 7 : 2;
  const amount = Number(value);
  return `${Number.isFinite(amount) ? amount.toFixed(precision) : '—'} USDC`;
}

export function toggleUsdcDisplayPrecision() {
  const next = localStorage.getItem(DISPLAY_PRECISION_KEY) === '7' ? '2' : '7';
  localStorage.setItem(DISPLAY_PRECISION_KEY, next);
  return next;
}
