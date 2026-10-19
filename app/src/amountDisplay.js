import { toggleUsdcDisplayPrecision } from './units.js';

document.querySelectorAll('[data-usdc-precision-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const precision = toggleUsdcDisplayPrecision();
    button.textContent = `${precision}-decimal USDC`;
    window.location.reload();
  });
});
