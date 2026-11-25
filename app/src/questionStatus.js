// Badge label + class for a question's lifecycle status (issue #448).
//
// Kept out of dashboard.js (which touches the DOM on import) so it can be
// unit-tested on its own. The caller passes its translate function (`t`).

/** Non-settled statuses that have their own label; anything else reads "pending". */
const SPECIFIC_PENDING_STATUSES = new Set(['awaiting_workers', 'reconciling']);

export function describeStatus(q, translate) {
  if (q.status !== 'settled') {
    const key = SPECIFIC_PENDING_STATUSES.has(q.status) ? q.status : 'pending';
    return { label: translate(`status.${key}`), cls: 'badge-pending' };
  }
  if (q.outcome === 'resolved') return { label: translate('status.resolved'), cls: 'badge-resolved' };
  return { label: translate('status.refunded'), cls: 'badge-refunded' };
}
