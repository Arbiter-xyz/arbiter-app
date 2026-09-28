// Client-side search/status filter for the buyer dashboard's question list.
// Pure (no DOM) so it can be reused and tested without a browser.

/** Same three states the dashboard badges show — see describeStatus(). */
export function questionStatus(q) {
  if (q.status !== 'settled') return 'in-progress';
  if (q.outcome === 'resolved') return 'resolved';
  return 'refunded';
}

/**
 * @param {Array<object>} questions
 * @param {{ query?: string, status?: 'all'|'in-progress'|'resolved'|'refunded' }} filter
 *   `query` matches (case-insensitively) against the question text or its questionId.
 */
export function filterQuestions(questions, { query = '', status = 'all' } = {}) {
  const needle = query.trim().toLowerCase();
  return questions.filter((q) => {
    if (status !== 'all' && questionStatus(q) !== status) return false;
    if (!needle) return true;
    return (
      String(q.question ?? '').toLowerCase().includes(needle) ||
      String(q.questionId ?? '').toLowerCase().includes(needle)
    );
  });
}
