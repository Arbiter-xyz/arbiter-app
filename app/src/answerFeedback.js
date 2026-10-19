/**
 * Thumbs-up / thumbs-down feedback on a resolved answer in the buyer
 * dashboard (issue #110).
 *
 * BACKEND DEPENDENCY — this endpoint does not exist in arbiter-backend yet.
 * Expected contract:
 *
 *   POST {BACKEND_URL}/payers/:address/questions/:questionId/feedback?token=<session token>
 *   Content-Type: application/json
 *   { "rating": "up" | "down" }
 *
 *   200/201/204 -> recorded (a repeat submission should overwrite the old rating)
 *   401/403     -> invalid/expired session, or questionId not owned by :address
 *   404/405/501 -> treated here as "endpoint not deployed yet" and surfaced to the user
 *
 * The token is the same payer session token from dashboard.js's
 * ensureSession() (and passed the same way as GET /payers/:address/questions),
 * so a bare questionId is never enough to submit feedback.
 */

const RATINGS = [
  { value: 'up', symbol: '👍', label: 'Good answer' },
  { value: 'down', symbol: '👎', label: 'Bad answer' },
];

/**
 * @param {object} q question row from GET /payers/:address/questions
 * @param {{ backendUrl: string, address: string, ensureSession: () => Promise<string>, log: (m: string) => void }} ctx
 * @returns {HTMLElement}
 */
export function renderAnswerFeedback(q, { backendUrl, address, ensureSession, log }) {
  const wrap = document.createElement('div');
  wrap.className = 'answer-feedback';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Rate this answer');

  const status = document.createElement('span');
  status.className = 'answer-feedback-status';
  status.setAttribute('aria-live', 'polite');

  let current = q.feedback === 'up' || q.feedback === 'down' ? q.feedback : null;
  const buttons = RATINGS.map(({ value, symbol, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary answer-feedback-btn';
    btn.textContent = symbol;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.dataset.rating = value;
    btn.addEventListener('click', () => submit(value));
    return btn;
  });

  function sync() {
    for (const btn of buttons) btn.setAttribute('aria-pressed', String(btn.dataset.rating === current));
  }

  async function submit(rating) {
    const previous = current;
    current = rating;
    sync();
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = 'Sending…';
    try {
      const token = await ensureSession();
      const url = `${backendUrl}/payers/${address}/questions/${encodeURIComponent(q.questionId)}/feedback?token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if ([404, 405, 501].includes(res.status)) {
        throw new Error('feedback endpoint is not available on this backend yet');
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `unexpected status ${res.status}`);
      }
      status.textContent = 'Thanks for the feedback.';
      log(`Feedback "${rating}" recorded for ${q.questionId}.`);
    } catch (err) {
      current = previous;
      sync();
      status.textContent = 'Could not send feedback.';
      log(`Could not send feedback for ${q.questionId}: ${err.message}`);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  sync();
  wrap.append(...buttons, status);
  return wrap;
}
