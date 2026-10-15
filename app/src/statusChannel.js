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
const POLL_INTERVAL_MS = 10_000;

export function subscribeQuestionStatus({ backendUrl, address, getToken, onSnapshot, onEvent, onConnection }) {
  const channelName = `arbiter-status:${address}`;
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
  let cursor = 0;
  let closed = false;
  let pollTimer = null;
  let releaseLock = null;
  let resyncing = null;

  function announce(connected) {
    onConnection?.(connected);
    bc?.postMessage({ type: 'connection', connected });
  }

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
        bc?.postMessage({ type: 'snapshot', data });
        announce(true);
      } catch (err) {
        announce(false);
        throw err;
      } finally {
        resyncing = null;
      }
    })();
    return resyncing;
  }

  function deliver(seq, payload) {
    if (seq <= cursor) return; // duplicate (replay overlap / own broadcast)
    if (cursor && seq > cursor + 1) {
      resync().catch(() => {}); // gap: we missed intermediate statuses
      return;
    }
    cursor = seq;
    onEvent?.(payload);
  }

  bc?.addEventListener('message', ({ data }) => {
    if (data?.type === 'snapshot' && data.data) {
      if (Number.isFinite(data.data.cursor)) cursor = Math.max(cursor, data.data.cursor);
      onSnapshot(data.data);
    } else if (data?.type === 'status') {
      deliver(data.seq, data.payload);
    } else if (data?.type === 'connection') {
      onConnection?.(data.connected);
    }
  });

  function startLeaderPolling() {
    if (closed) return;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!closed) resync().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  function becomeLeaderWhenAvailable() {
    if (typeof navigator === 'undefined' || !navigator.locks) {
      startLeaderPolling();
      return;
    }
    navigator.locks.request(channelName, () => {
      if (closed) return;
      startLeaderPolling();
      // Hold the lock until unsubscribe (or the tab dies).
      return new Promise((resolve) => (releaseLock = resolve));
    });
  }

  const onVisible = () => document.visibilityState === 'visible' && resync().catch(() => {});
  const onOnline = () => resync().catch(() => {});
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);

  const ready = resync().then(becomeLeaderWhenAvailable);

  return {
    ready,
    resync,
    close() {
      closed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      releaseLock?.();
      bc?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    },
  };
}
