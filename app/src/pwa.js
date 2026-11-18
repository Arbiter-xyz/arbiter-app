// Installable-PWA wiring for the worker console (issue #57): service-worker
// registration (the SW also precaches the static shell), a custom install
// button driven by beforeinstallprompt, and an honest offline banner — the
// SSE dispatch channel can't work offline, so we say so instead of faking it.
//
// The SW's IndexedDB answer queue (see flushAnswerQueue in app/public/sw.js)
// is owned by the page: we register Background Sync for it and, as a fallback
// for browsers without the SyncManager, ask the SW to flush on reconnect.
import { t } from './i18n.js';
import { webPushSupported } from './platform.js';

const ANSWER_QUEUE_SYNC_TAG = 'flush-answer-queue';

let deferredPrompt = null;

async function requestAnswerQueueSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) {
      await reg.sync.register(ANSWER_QUEUE_SYNC_TAG);
    } else if (reg.active) {
      // No Background Sync support: nudge the SW to flush now that we're online.
      reg.active.postMessage({ type: 'FLUSH_ANSWER_QUEUE' });
    }
  } catch {
    // non-fatal: the queue will be retried on the next online event
  }
}

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

  const syncOnline = () => {
    const online = navigator.onLine;
    banner?.classList.toggle('hidden', online);
    if (online) requestAnswerQueueSync();
  };
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();
}
