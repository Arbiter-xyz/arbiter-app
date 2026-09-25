// Service worker for the worker console.
//
// Two responsibilities:
//   1. Push notifications (existing behaviour).
//   2. Background Sync for the offline-first answer queue: when the browser
//      regains connectivity it fires a `sync` event with tag 'answer-queue',
//      and we ask every open client to flush its IndexedDB-backed queue.
//
// The actual queue lives in IndexedDB and is owned by the page (see
// app/src/main.js). The service worker deliberately does NOT talk to the
// network itself: reconciliation needs the live question state (is the
// question still open?) which the page already tracks, and doing the submit
// from the page keeps exactly-once semantics in one place. The SW's job is
// just to wake the page up at the right moment.

const ANSWER_SYNC_TAG = 'answer-queue';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Ask all controlled clients to drain the queued answers. Returns a promise
// that resolves once every client has acknowledged the flush, so the browser
// knows the sync completed and won't immediately re-fire it.
async function flushAnswerQueue() {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  await Promise.all(
    clients.map(
      (client) =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          // Resolve on ack, but never hang forever if the page is busy.
          const timer = setTimeout(resolve, 5000);
          channel.port1.onmessage = () => {
            clearTimeout(timer);
            resolve();
          };
          client.postMessage({ type: 'FLUSH_ANSWER_QUEUE' }, [channel.port2]);
        }),
    ),
  );
}

self.addEventListener('sync', (event) => {
  if (event.tag === ANSWER_SYNC_TAG) {
    event.waitUntil(flushAnswerQueue());
  }
});

// Some browsers (notably older Safari) don't support Background Sync. The
// page falls back to flushing on the `online` event, but if it explicitly
// asks us to retry we honour that too.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'RETRY_ANSWER_QUEUE') {
    event.waitUntil(flushAnswerQueue());
  }
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
