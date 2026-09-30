/**
 * Shared real-time job-status channel for the buyer dashboard (issue #6).
 *
 * Replaces per-tab polling with ONE server push stream per browser per
 * payer address, fanned out to every open dashboard tab:
 *
 *   backend ──SSE──▶ leader tab ──BroadcastChannel──▶ every tab (incl. leader)
 *
 * - Leader election uses the Web Locks API: whichever tab holds the lock
 *   `arbiter-status:<address>` owns the EventSource. When that tab closes
 *   or is discarded, the lock is released and another tab takes over
 *   automatically. (No Web Locks → each tab runs its own stream; still
 *   push, just not shared.)
 *
 * Backend contract (GET /payers/:address/questions/stream?token&since):
 *   - `text/event-stream`; each status change is `event: status`,
 *     `id: <seq>` (monotonic per payer), `data: {questionId, status,
 *     outcome?, confidence?, ...}`.
 *   - On connect the server first replays every event with seq > `since`
 *     (or > the Last-Event-ID header on EventSource's own auto-reconnect),
 *     then streams live. This is the backfill for a reconnecting client.
 *   - The snapshot endpoint GET /payers/:address/questions returns a
 *     `cursor` = latest seq included in the snapshot.
 *
 * Correctness rules implemented here:
 *   1. Every subscriber starts from a snapshot, so a question that settled
 *      before the tab connected renders its final state immediately.
 *   2. Events carry a contiguous seq; any gap (a missed intermediate
 *      status, e.g. a backgrounded/frozen tab that dropped broadcast
 *      messages) triggers a snapshot resync instead of silently skipping.
 *   3. A tab returning to the foreground, or coming back online, resyncs
 *      from the snapshot and the stream resumes from its cursor.
 */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export function subscribeQuestionStatus({ backendUrl, address, getToken, onSnapshot, onEvent, onConnection }) {
  const channelName = `arbiter-status:${address}`;
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
  let cursor = 0;
  let closed = false;
  let source = null;
  let retryMs = RETRY_MIN_MS;
  let releaseLock = null;
  let resyncing = null;

  async function resync() {
    if (resyncing) return resyncing;
    resyncing = (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${backendUrl}/payers/${address}/questions?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        const data = await res.json();
        if (Number.isFinite(data.cursor)) cursor = Math.max(cursor, data.cursor);
        onSnapshot(data);
      } finally {
        resyncing = null;
      }
    })();
    return resyncing;
  }

  function deliver(seq, payload) {
    if (seq <= cursor) return; // duplicate (replay overlap / own broadcast)
    if (cursor && seq > cursor + 1) {
      resync(); // gap: we missed intermediate statuses
      return;
    }
    cursor = seq;
    onEvent(payload);
  }

  bc?.addEventListener('message', ({ data }) => {
    if (data?.type === 'status') deliver(data.seq, data.payload);
    else if (data?.type === 'connection') onConnection?.(data.connected);
  });

  function announce(connected) {
    onConnection?.(connected);
    bc?.postMessage({ type: 'connection', connected });
  }

  async function openStream() {
    if (closed) return;
    const token = await getToken();
    const url = `${backendUrl}/payers/${address}/questions/stream?token=${encodeURIComponent(token)}&since=${cursor}`;
    source = new EventSource(url);
    source.onopen = () => {
      retryMs = RETRY_MIN_MS;
      announce(true);
    };
    source.addEventListener('status', (e) => {
      const seq = Number(e.lastEventId);
      const payload = JSON.parse(e.data);
      bc?.postMessage({ type: 'status', seq, payload });
      deliver(seq, payload);
    });
    source.onerror = () => {
      announce(false);
      // CONNECTING: the browser is auto-reconnecting with Last-Event-ID.
      // CLOSED (e.g. 401 after the session token expired): reopen ourselves
      // with a fresh token and `since=cursor`, with backoff.
      if (source.readyState === EventSource.CLOSED && !closed) {
        source = null;
        setTimeout(openStream, retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      }
    };
  }

  function becomeLeaderWhenAvailable() {
    if (!navigator.locks) return openStream();
    navigator.locks.request(channelName, () => {
      if (closed) return;
      openStream();
      // Hold the lock until unsubscribe (or the tab dies).
      return new Promise((resolve) => (releaseLock = resolve));
    });
  }

  const onVisible = () => document.visibilityState === 'visible' && resync();
  const onOnline = () => resync();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);

  const ready = resync().then(becomeLeaderWhenAvailable);

  return {
    ready,
    resync,
    close() {
      closed = true;
      source?.close();
      releaseLock?.();
      bc?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    },
  };
}
