/**
 * Starred questions on the buyer dashboard (issue #115).
 *
 * Purely client-side bookkeeping layered on data the dashboard already
 * fetches: starred questionIds live in this browser's localStorage, keyed
 * per payer address so one payer's stars never leak to another address
 * connected in the same browser. Like localWallet.js, nothing is synced —
 * stars don't follow a payer to another browser or device, and the UI
 * says so.
 */
const KEY_PREFIX = 'arbiter_starred_questions:';

function storageKey(address) {
  return `${KEY_PREFIX}${address}`;
}

export function loadStarred(address) {
  if (!address) return new Set();
  try {
    const raw = localStorage.getItem(storageKey(address));
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveStarred(address, starred) {
  try {
    localStorage.setItem(storageKey(address), JSON.stringify([...starred]));
  } catch {
    // Storage full/blocked: stars just won't persist past this page load.
  }
}

/** Flips the star on questionId for address; returns the new starred state. */
export function toggleStarred(address, questionId) {
  const starred = loadStarred(address);
  const nowStarred = !starred.has(questionId);
  if (nowStarred) starred.add(questionId);
  else starred.delete(questionId);
  saveStarred(address, starred);
  return nowStarred;
}

export function filterStarred(questions, address) {
  const starred = loadStarred(address);
  return questions.filter((q) => starred.has(q.questionId));
}

/** Star toggle button for one question row. onToggle runs after persisting. */
export function createStarButton(address, questionId, onToggle) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'star-toggle';
  const paint = (on) => {
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Unstar question' : 'Star question');
    btn.title = on ? 'Unstar' : 'Star for quick re-reference';
  };
  paint(loadStarred(address).has(questionId));
  btn.addEventListener('click', () => {
    paint(toggleStarred(address, questionId));
    onToggle?.();
  });
  return btn;
}

/** Inserts a "Starred only" checkbox above listEl; onChange(checked) on toggle. */
export function mountStarredFilter(listEl, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'starred-filter small';
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'filter-starred';
  box.addEventListener('change', () => onChange(box.checked));
  label.append(box, ' Starred only');
  const note = document.createElement('span');
  note.className = 'muted';
  note.textContent = ' — stars are saved in this browser only, per wallet address (not synced across devices).';
  wrap.append(label, note);
  listEl.before(wrap);
  return box;
}
