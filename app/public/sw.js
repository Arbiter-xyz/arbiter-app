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
//
// Page-side counterpart (issue #239): app/src/main.js registers the
// 'answer-queue' Background Sync tag when it enqueues an answer, listens for
// the FLUSH_ANSWER_QUEUE message (acking via the MessageChannel port), and
// posts RETRY_ANSWER_QUEUE for browsers without Background Sync. If you change
// the message types or tag here, update that handler too.

const ANSWER_SYNC_TAG = 'answer-queue';

// --- Offline app shell (issue #57) --------------------------------------
// Static shell assets are served cache-first so the console opens offline.
// Navigations go network-first (fresh deploys win) and fall back to the
// cached page. API calls and the SSE dispatch stream are never cached: live
// data must fail honestly, and the page shows an offline banner instead.
const SHELL_CACHE = 'arbiter-shell-v1';
const SHELL_URLS = ['/', '/index.html', '/dashboard.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('arbiter-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html'))),
    );
    return;
  }

  // Hashed build assets, styles, icons: cache-first, populated on first use.
  if (/\.(js|css|png|svg|json|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
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

// Rich previews (issue #63): the backend includes `preview` (truncated
// question text) and `tier` only for workers who opted in on subscribe. We
// truncate again here as a defence in depth.
const PREVIEW_MAX = 120;

self.addEventListener('push', (event) => {
  let payload = { title: 'Arbiter', body: 'New question available' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // non-JSON push payload — fall back to the default text above
  }

  let body = payload.body;
  if (payload.preview) {
    const text = String(payload.preview);
    body = text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
  }
  const title = payload.tier ? `${payload.title} · ${payload.tier}` : payload.title;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.questionId ? `question-${payload.questionId}` : undefined,
      renotify: !!payload.questionId,
      actions: payload.questionId ? [{ action: 'open', title: 'Answer now' }] : [],
      data: { questionId: payload.questionId },
    }),
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.questionId ? `question-${payload.questionId}` : undefined,
        data: { questionId: payload.questionId },
      }),
      // Also feed any open tab's in-app notification center (issue #133).
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: 'arbiter:notify', message: `${payload.title}: ${payload.body}` }))),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const questionId = event.notification.data && event.notification.data.questionId;
  const target = questionId ? `/?question=${encodeURIComponent(questionId)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c);
      if (existing) {
        if (questionId && 'navigate' in existing) return existing.navigate(target).then((c) => (c || existing).focus());
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

// --- Extension worker console bridge (issue #91) -------------------------
// SCAFFOLDING ONLY — no extension/ directory exists in this repo yet.
//
// This is a speculative, forward-looking bridge for a Manifest V3 extension
// background service worker that would port main.js's core loop
// (ensureSession() challenge/response auth, goOnline()'s EventSource
// connection to /app/events, and the answer-submission fetch to /app/answer)
// so a worker could stay online with the tab closed. Until that extension
// ships, nothing posts messages with EXTENSION_MESSAGE_SOURCE and the
// forwardPushToExtension relay below is inert. It is kept here (rather than
// deleted) so the protocol shape is documented alongside the push flow it
// builds on; treat it as a design sketch, not a live feature.
//
// When the extension lands, wire it up here and remove this disclosure.

const EXTENSION_MESSAGE_SOURCE = 'arbiter-extension';

// Forward a push payload to the extension background worker so it can raise an
// extension-native notification even when no console tab is open.
//
// NOTE: scaffolding only (see above) — no extension/ directory exists yet, so
// this currently has no recipient. It is a no-op until the extension ships.
function forwardPushToExtension(payload) {
  try {
    // chrome.runtime.sendMessage reaches the extension only when the extension
    // has declared externally_connectable for this origin; otherwise this is a
    // no-op and the web-push notification above remains the fallback.
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ source: 'arbiter-page', type: 'push', payload });
    }
  } catch {
    // extension not installed / not reachable — ignore
  }
}
