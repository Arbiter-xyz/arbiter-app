/**
 * Job-status refresh for the buyer dashboard (issue #6, issue #203).
 *
 * The backend has no payer-facing push stream, so this polls the snapshot
 * endpoint GET /payers/:address/questions every POLL_MS. Polling pauses while
 * the tab is hidden and resyncs immediately when the tab is refocused or the
 * browser comes back online. Manual Refresh goes through the same resync().
 */
const POLL_MS = 5_000;

export function subscribeQuestionStatus({ backendUrl, address, getToken, onSnapshot, onConnection }) {
  let closed = false;
  let inflight = null;

  async function resync() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${backendUrl}/payers/${address}/questions?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        const data = await res.json();
        onConnection?.(true);
        onSnapshot(data);
      } catch (err) {
        onConnection?.(false);
        throw err;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  const timer = setInterval(() => {
    if (!closed && document.visibilityState === 'visible') resync().catch(() => {});
  }, POLL_MS);

  const onVisible = () => document.visibilityState === 'visible' && resync().catch(() => {});
  const onOnline = () => resync().catch(() => {});
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);

  return {
    ready: resync(),
    resync,
    close() {
      closed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    },
  };
}
