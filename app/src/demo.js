// Live demo feed. Rather than instrumenting worker-sim.js/ask.js, this
// polls the backend's existing GET /admin/transactions and GET
// /admin/workers (admin.js's fetchAdmin pattern and token) and turns the
// diff between polls into dispatch / answer / settlement events. Tradeoff:
// events are only as fresh as POLL_MS and per-worker answers are inferred
// from totalAnswers increments, not tied to a specific question.
import { safeGet, safeSet, safeRemove } from './storage.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const TOKEN_KEY = 'arbiter-admin-token';
const POLL_MS = 2_000;
const MAX_EVENTS = 200;

const txSeen = new Map(); // questionId -> status
const workerAnswers = new Map(); // workerId -> totalAnswers
let primed = false;
let timer = null;

function short(id) {
  const s = String(id ?? '—');
  return s.length > 16 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}

function pushEvent(kind, label, text) {
  const feed = document.getElementById('demo-feed');
  const li = document.createElement('li');
  li.className = `ev-${kind}`;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  const k = document.createElement('span');
  k.className = 'ev-kind';
  k.textContent = label;
  li.append(time, k, text);
  feed.prepend(li);
  while (feed.children.length > MAX_EVENTS) feed.lastChild.remove();
}

async function fetchAdmin(path) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${safeGet(TOKEN_KEY, 'session')}` },
  });
  if (res.status === 401) {
    safeRemove(TOKEN_KEY, 'session');
    showLogin('That token was rejected — try again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

function diffTransactions(transactions) {
  // Oldest first so the feed reads in order.
  for (const t of [...transactions].reverse()) {
    const prev = txSeen.get(t.questionId);
    txSeen.set(t.questionId, t.status);
    if (!primed) continue;
    if (prev === undefined) {
      pushEvent('dispatch', 'Dispatched', `question ${short(t.questionId)} from ${short(t.payer)}`);
    }
    if (t.status === 'settled' && prev !== 'settled') {
      pushEvent('settle', 'Settled', `question ${short(t.questionId)} → ${t.outcome || 'settled'}`);
    }
  }
}

function diffWorkers(workers) {
  for (const w of workers) {
    const prev = workerAnswers.get(w.workerId);
    workerAnswers.set(w.workerId, w.totalAnswers);
    if (!primed) continue;
    if (prev === undefined) pushEvent('answer', 'Worker online', short(w.workerId));
    else if (w.totalAnswers > prev) {
      pushEvent('answer', 'Answered', `${short(w.workerId)} (+${w.totalAnswers - prev}, ${w.totalAnswers} total)`);
    }
  }
}

async function poll() {
  const status = document.getElementById('demo-status');
  try {
    const [{ transactions }, { workers }] = await Promise.all([
      fetchAdmin('/admin/transactions?limit=100'),
      fetchAdmin('/admin/workers'),
    ]);
    diffTransactions(transactions);
    diffWorkers(workers);
    if (!primed) {
      primed = true;
      pushEvent('dispatch', 'Connected', `${transactions.length} existing transactions, ${workers.length} workers — watching for new activity`);
    }
    status.textContent = `Live · ${workers.length} workers · polled ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    if (err.message === 'unauthorized') return;
    status.textContent = `Can't reach backend: ${err.message}`;
  }
  timer = setTimeout(poll, POLL_MS);
}

function showLogin(message = '') {
  clearTimeout(timer);
  document.getElementById('panel-login').classList.remove('hidden');
  document.getElementById('demo-shell').classList.add('hidden');
  document.getElementById('demo-login-status').textContent = message;
}

function start() {
  document.getElementById('panel-login').classList.add('hidden');
  document.getElementById('demo-shell').classList.remove('hidden');
  poll();
}

document.getElementById('demo-login').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!safeSet(TOKEN_KEY, document.getElementById('demo-token').value.trim(), 'session')) {
    showLogin("Couldn't keep the token — browser storage is blocked. Allow site data and try again.");
    return;
  }
  start();
});
document.getElementById('btn-clear').addEventListener('click', () => {
  document.getElementById('demo-feed').replaceChildren();
});

safeRemove(TOKEN_KEY); // #454: drop a token an older build left in localStorage
if (safeGet(TOKEN_KEY, 'session')) start();
else showLogin();
