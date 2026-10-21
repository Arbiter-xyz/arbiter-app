import { toggleUsdcDisplayPrecision } from './units.js';

// A full page reload here would silently discard any unsaved state the user
// has elsewhere on the page (an in-progress question, a stake amount typed
// into a form, etc.) just to pick up a display-only preference. Instead,
// broadcast the change so any component rendering USDC amounts can re-render
// in place; a reload is no longer required for this to take effect.
document.querySelectorAll('[data-usdc-precision-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const precision = toggleUsdcDisplayPrecision();
    button.textContent = `${precision}-decimal USDC`;
    window.dispatchEvent(new CustomEvent('arbiter:usdc-precision-changed', { detail: { precision } }));
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
