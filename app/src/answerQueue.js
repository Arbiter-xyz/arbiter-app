// Page-side counterpart to app/public/sw.js's Background Sync offline answer
// queue (#234, #239).
//
// Queues worker answers that failed due to transient network loss, registers
// the 'answer-queue' Background Sync tag on the service worker registration
// (with a message-based RETRY_ANSWER_QUEUE / window 'online' fallback for
// browsers without Background Sync), and handles the service worker's
// FLUSH_ANSWER_QUEUE message by re-submitting queued items and acknowledging
// over the MessageChannel port.

export const ANSWER_SYNC_TAG = 'answer-queue';
const STORAGE_KEY = 'arbiter:offline-answer-queue';

const memoryQueue = [];

function readQueue(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [...memoryQueue];
}

function writeQueue(items, storage = globalThis.localStorage) {
  memoryQueue.length = 0;
  memoryQueue.push(...items);
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function getQueuedAnswers(storage) {
  return readQueue(storage);
}

export async function enqueueOfflineAnswer(entry, { storage, serviceWorker = globalThis.navigator?.serviceWorker } = {}) {
  const queue = readQueue(storage);
  const existingIdx = queue.findIndex((item) => item.questionId === entry.questionId && item.workerId === entry.workerId);
  const record = { ...entry, queuedAt: entry.queuedAt ?? Date.now() };
  if (existingIdx >= 0) {
    queue[existingIdx] = record;
  } else {
    queue.push(record);
  }
  writeQueue(queue, storage);

  try {
    const registration = await serviceWorker?.ready;
    if (registration?.sync?.register) {
      await registration.sync.register(ANSWER_SYNC_TAG);
    } else if (serviceWorker?.controller) {
      serviceWorker.controller.postMessage({ type: 'RETRY_ANSWER_QUEUE' });
    }
  } catch {}

  return record;
}

export async function flushOfflineAnswerQueue({
  submitAnswer,
  storage,
  now = Date.now(),
  onFlushed,
} = {}) {
  const queue = readQueue(storage);
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const remaining = [];
  let flushed = 0;

  for (const item of queue) {
    if (item.deadlineAt && item.deadlineAt <= now) {
      // Question window already expired; drop stale entry rather than retrying forever.
      continue;
    }
    try {
      const ok = await submitAnswer(item);
      if (ok !== false) {
        flushed += 1;
        onFlushed?.(item);
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  writeQueue(remaining, storage);
  return { flushed, remaining: remaining.length };
}

export function registerAnswerQueueSync({
  submitAnswer,
  storage,
  serviceWorker = globalThis.navigator?.serviceWorker,
  win = globalThis.window,
  onFlushed,
} = {}) {
  const handleFlush = async (event) => {
    if (event?.data?.type !== 'FLUSH_ANSWER_QUEUE') return;
    try {
      await flushOfflineAnswerQueue({ submitAnswer, storage, onFlushed });
    } finally {
      event.ports?.[0]?.postMessage({ ok: true });
    }
  };

  const handleOnline = () => {
    if (serviceWorker?.controller) {
      serviceWorker.controller.postMessage({ type: 'RETRY_ANSWER_QUEUE' });
    }
    flushOfflineAnswerQueue({ submitAnswer, storage, onFlushed }).catch(() => {});
  };

  serviceWorker?.addEventListener?.('message', handleFlush);
  win?.addEventListener?.('online', handleOnline);

  return () => {
    serviceWorker?.removeEventListener?.('message', handleFlush);
    win?.removeEventListener?.('online', handleOnline);
  };
}
