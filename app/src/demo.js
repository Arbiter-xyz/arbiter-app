// Live demo dashboard. Rather than instrumenting worker-sim.js / ask.js,
// this diffs successive snapshots of GET /admin/workers and
// GET /admin/transactions (same auth + fetch pattern as admin.js) and turns
// the changes into dispatch / answer / settlement events.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const TOKEN_KEY = 'arbiter-admin-token';
const POLL_MS = 2000;

const seenTx = new Map();
const seenWorkers = new Map();
let first = true;

async function fetchAdmin(path) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
  });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

function logEvent(kind, text) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="badge badge-${kind === 'settled' ? 'resolved' : 'pending'}"></span> <span class="muted small"></span> `;
  li.children[0].textContent = kind;
  li.children[1].textContent = new Date().toLocaleTimeString();
  li.append(text);
  document.getElementById('demo-feed').prepend(li);
}

function short(s) {
  s = String(s ?? '—');
  return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

async function tick() {
  const [{ workers }, { transactions }] = await Promise.all([
    fetchAdmin('/admin/workers'),
    fetchAdmin('/admin/transactions?limit=100'),
  ]);

  const list = document.getElementById('demo-workers');
  list.replaceChildren(
    ...workers.map((w) => {
      const li = document.createElement('li');
      const id = w.workerId || w.id || w.publicKey;
      const answered = w.answeredCount ?? w.answers ?? w.totalAnswers ?? 0;
      li.textContent = `${short(id)} — answers: ${answered}`;
      if (!first && !seenWorkers.has(id)) logEvent('worker', `worker ${short(id)} connected`);
      else if (!first && seenWorkers.get(id) !== answered) logEvent('answer', `worker ${short(id)} answered (total ${answered})`);
      seenWorkers.set(id, answered);
      return li;
    }),
  );
  document.getElementById('demo-worker-count').textContent = `(${workers.length})`;

  for (const t of [...transactions].reverse()) {
    const prev = seenTx.get(t.questionId);
    if (!first && prev !== t.status) {
      if (!prev) logEvent('dispatch', `question ${short(t.questionId)} dispatched`);
      if (t.status === 'settled') logEvent('settled', `question ${short(t.questionId)} settled → ${t.outcome || '—'}`);
    }
    seenTx.set(t.questionId, t.status);
  }
  first = false;
}

async function loop() {
  try {
    await tick();
    document.getElementById('demo-login').classList.add('hidden');
    document.getElementById('demo-shell').classList.remove('hidden');
  } catch (err) {
    if (err.message === 'unauthorized') return showLogin('Token rejected.');
    document.getElementById('demo-status').textContent = err.message;
  }
  setTimeout(loop, POLL_MS);
}

function showLogin(msg = '') {
  document.getElementById('demo-login').classList.remove('hidden');
  document.getElementById('demo-shell').classList.add('hidden');
  document.getElementById('demo-status').textContent = msg;
}

document.getElementById('demo-login-btn').addEventListener('click', () => {
  localStorage.setItem(TOKEN_KEY, document.getElementById('demo-token').value.trim());
  loop();
});

if (localStorage.getItem(TOKEN_KEY)) loop();
else showLogin();
