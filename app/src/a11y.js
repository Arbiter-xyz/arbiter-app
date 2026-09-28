const FONT_SCALE_KEY = 'arbiter:a11y:font-scale';
const CONTRAST_KEY = 'arbiter:a11y:high-contrast';
const SCALES = [1, 1.15, 1.3, 1.5];

function readScale() {
  const saved = Number.parseFloat(localStorage.getItem(FONT_SCALE_KEY));
  return SCALES.includes(saved) ? saved : 1;
}

function applyScale(scale) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
  localStorage.setItem(FONT_SCALE_KEY, String(scale));
  document.querySelectorAll('[data-font-status]').forEach((status) => {
    status.textContent = `${Math.round(scale * 100)}% text size`;
  });
}

function applyContrast(enabled) {
  document.documentElement.toggleAttribute('data-theme', enabled);
  localStorage.setItem(CONTRAST_KEY, enabled ? 'true' : 'false');
  document.querySelectorAll('[data-contrast-toggle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Standard contrast' : 'High contrast';
  });
}

function initialiseControls() {
  let scale = readScale();
  const contrast = localStorage.getItem(CONTRAST_KEY) === 'true';
  applyScale(scale);
  applyContrast(contrast);

  document.querySelectorAll('[data-font-decrease]').forEach((button) => button.addEventListener('click', () => {
    scale = SCALES[Math.max(0, SCALES.indexOf(scale) - 1)];
    applyScale(scale);
  }));
  document.querySelectorAll('[data-font-increase]').forEach((button) => button.addEventListener('click', () => {
    scale = SCALES[Math.min(SCALES.length - 1, SCALES.indexOf(scale) + 1)];
    applyScale(scale);
  }));
  document.querySelectorAll('[data-contrast-toggle]').forEach((button) => button.addEventListener('click', () => {
    applyContrast(!document.documentElement.hasAttribute('data-theme'));
  }));
}

initialiseControls();
