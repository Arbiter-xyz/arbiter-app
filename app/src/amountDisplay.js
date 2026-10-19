import { toggleUsdcDisplayPrecision } from './units.js';

document.querySelectorAll('[data-usdc-precision-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const precision = toggleUsdcDisplayPrecision();
    button.textContent = `${precision}-decimal USDC`;
    window.location.reload();
  });
});

/**
 * Format a balance figure for the admin Treasury tab.
 * Accepts a number or numeric string and renders a USDC amount with
 * thousands separators and a fixed number of decimals.
 */
export function balanceFigure(value, { decimals = 2, symbol = 'USDC' } = {}) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return `— ${symbol}`;
  }
  const formatted = numeric.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${symbol}`;
}
