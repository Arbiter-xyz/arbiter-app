// Minimal service worker whose only real job is handling push events —
// this is NOT an offline-caching strategy (deliberately out of scope; the
// worker console needs a live network connection to do anything useful
// anyway, so caching the app shell for offline use wouldn't buy much).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Arbiter', body: 'New question available' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // non-JSON push payload — fall back to the default text above
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.questionId ? `question-${payload.questionId}` : undefined,
      data: { questionId: payload.questionId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    }),
  );
});

// --- Extension worker console bridge (issue #91) -------------------------
// The Manifest V3 extension background service worker (extension/background.js)
// ports main.js's core loop — ensureSession() challenge/response auth,
// goOnline()'s EventSource connection to /app/events, and the answer-submission
// fetch to /app/answer — so a worker can stay online with the tab closed.
//
// This page-side service worker is the bridge between that extension and the
// existing web-push flow: it forwards push payloads to the extension (which is
// already running persistently) so extension-native notifications are at least
// a parity replacement for web push, and it relays the extension's answer
// submissions back into any open console tab. It builds on push.js /
// btnEnablePush rather than replacing them.

const EXTENSION_MESSAGE_SOURCE = 'arbiter-extension';

// Forward a push payload to the extension background worker so it can raise an
// extension-native notification even when no console tab is open.
function forwardPushToExtension(payload) {
  try {
    // chrome.runtime.sendMessage reaches the extension only when the extension
    // has declared externally_connectable for this origin; otherwise this is a
    // no-op and the web-push notification above remains the fallback.
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'arbiter:push', payload });
    }
  } catch {
    // Extension not installed / not reachable — web push already handled it.
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== EXTENSION_MESSAGE_SOURCE) return;

  if (data.type === 'arbiter:push') {
    forwardPushToExtension(data.payload || {});
    return;
  }

  // The extension answered a dispatched question in the background; surface it
  // to any open console tab so the UI stays in sync with the extension loop.
  if (data.type === 'arbiter:answered') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'arbiter:answered', payload: data.payload || {} });
        }
      }),
    );
  }
});
