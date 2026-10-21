/**
 * Dark/light theme toggle (issue #53). Loaded as a classic, render-blocking
 * script in each page's <head> so the stored preference is applied to
 * <html data-theme> before first paint — no flash of the wrong theme.
 * With no stored preference the page follows prefers-color-scheme.
 */
(function () {
  var KEY = 'arbiter-theme';
  var root = document.documentElement;
  var stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // storage blocked — fall back to the system preference.
  }
  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function current() {
    return root.getAttribute('data-theme') || systemTheme();
  }
  if (stored === 'light' || stored === 'dark') root.setAttribute('data-theme', stored);

  function label(btn) {
    var dark = current() === 'dark';
    btn.textContent = dark ? 'Light mode' : 'Dark mode';
    btn.setAttribute('aria-pressed', String(dark));
  }

  document.addEventListener('DOMContentLoaded', function () {
    var host = document.querySelector('.admin-nav h1') || document.querySelector('header .sub') || document.querySelector('header');
    if (!host) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary small theme-toggle';
    btn.setAttribute('aria-label', 'Dark theme');
    label(btn);
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // not persisted, but the switch still applies for this page view.
      }
      label(btn);
    });
    host.insertAdjacentElement('afterend', btn);
  });
})();
