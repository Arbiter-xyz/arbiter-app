// Installable-PWA wiring for the worker console (issue #57): service-worker
// registration (the SW also precaches the static shell), a custom install
// button driven by beforeinstallprompt, and an honest offline banner — the
// SSE dispatch channel can't work offline, so we say so instead of faking it.
import { t } from './i18n.js';
import { webPushSupported } from './platform.js';

let deferredPrompt = null;

export function initPwa() {
  const btnInstall = document.getElementById('btn-install');
  const banner = document.getElementById('offline-banner');
  const pushButton = document.getElementById('btn-enable-push');
  const pushStatus = document.getElementById('push-status');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // non-fatal: the console works without offline caching
    });
  }

  if (!webPushSupported() && pushButton && pushStatus) {
    pushButton.disabled = true;
    pushStatus.dataset.i18n = 'push.unsupported';
    pushStatus.textContent = t('push.unsupported');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the mini-infobar; offer our own button instead.
    event.preventDefault();
    deferredPrompt = event;
    btnInstall?.classList.remove('hidden');
  });

  btnInstall?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btnInstall.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => btnInstall?.classList.add('hidden'));

  const syncOnline = () => banner?.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();
}
