import { openSecureLocalWallet } from './localWallet.js';
import { subscribeQuestionStatus } from './statusChannel.js';
import { initI18n, onLocaleChange, t, formatUsdc, formatNumber } from './i18n.js';
import { renderMarkdown } from './markdown.js';
import { initI18n, t } from './i18n.js';

initI18n();
import { ensureSession as ensureSharedSession } from './session.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

// See wallet.js for the module list and the connect/quick-start button
// wiring shared with main.js (issue #19).
const kit = createWalletKit();

const el = {
  connect: document.getElementById('panel-connect'),
  dashboard: document.getElementById('panel-dashboard'),
  btnConnect: document.getElementById('btn-connect'),
  btnQuickStart: document.getElementById('btn-quick-start'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnExportJson: document.getElementById('btn-export-json'),
  payerAddress: document.getElementById('payer-address'),
  statSpend: document.getElementById('stat-spend'),
  statCount: document.getElementById('stat-count'),
  statSuccess: document.getElementById('stat-success'),
  spendCalendarGrid: document.getElementById('spend-calendar-grid'),
  spendCalendarTotal: document.getElementById('spend-calendar-total'),
  questionList: document.getElementById('question-list'),
  questionSearch: document.getElementById('question-search'),
  questionStatus: document.getElementById('question-status'),
  log: document.getElementById('log'),
  liveStatus: document.getElementById('live-status'),
};

initI18n();

const state = {
  address: null,
  activeWallet: null,
  sessionToken: null,
  sessionExpiresAt: 0,
  channel: null,
  lastData: null,
  // questionId -> <li>, so a pushed status change patches one row in place.
  items: new Map(),
  // questionId -> setInterval handle for that row's cancel countdown. Kept
  // here (not on the <li>) so render() can clear every live countdown before
  // it replaces the list — otherwise a detached row's interval keeps ticking
  // forever (issue #282).
  countdowns: new Map(),
};

function log(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.log.prepend(li);
  notify(message);
}

/** Proves control of this address once, same primitive as the worker
 * console's ensureSession() — these questions/balance are only readable
 * with a valid session now, not by anyone who just knows the address. */
async function ensureSession() {
  if (state.sessionToken && Date.now() < state.sessionExpiresAt - 60_000) return state.sessionToken;

  log(t('dash.proving'));
  const challengeRes = await fetch(`${BACKEND_URL}/payers/${state.address}/session/challenge`, { method: 'POST' });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error || 'failed to get session challenge');
  const { xdr } = await challengeRes.json();

  const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, {
  return ensureSharedSession({
    address: state.address,
    activeWallet: state.activeWallet,
    sessionToken: state.sessionToken,
    sessionExpiresAt: state.sessionExpiresAt,
    onSession: ({ token, expiresAt }) => {
      state.sessionToken = token;
      state.sessionExpiresAt = expiresAt;
    },
    log,
  });
  if (!sessionRes.ok) throw new Error((await sessionRes.json()).error || 'failed to establish session');
  const { token, expiresAt } = await sessionRes.json();
  state.sessionToken = token;
  state.sessionExpiresAt = expiresAt;
  log(t('dash.session'));
  return token;
}

el.btnConnect.addEventListener('click', async () => {
  setConnectButtonsBusy(true);
  try {
    await kit.openModal({
      onWalletSelected: async (option) => {
        kit.setWallet(option.id);
        const { address } = await kit.getAddress();
        await activate(kit, address);
      },
      onClosed: (err) => {
        setConnectButtonsBusy(false);
        if (err) log(t('log.walletClosed', { error: err.message }));
      },
    });
  } catch (err) {
    setConnectButtonsBusy(false);
    log(t('log.connectFailed', { error: err.message }));
  }
}

// Module list + button wiring live in wallet.js, shared with main.js
// (issue #19). This page has no backup panel, so `quickStart` is unused.
wireConnectButtons({
  kit,
  connectButton: el.btnConnect,
  quickStartButton: el.btnQuickStart,
  onActivated: activate,
  onError: log,
});

el.btnQuickStart.addEventListener('click', async () => {
  setConnectButtonsBusy(true);
  try {
    const localWallet = await openSecureLocalWallet();
    const { address } = await localWallet.getAddress();
    await activate(localWallet, address);
  } catch (err) {
    setConnectButtonsBusy(false);
    log(t('log.quickStartFailed', { error: err.message }));
  }
});

async function switchIdentity(address, wallet = null) {
  state.address = address;
  // Populate activeWallet so ensureSession()'s wallet-signed session-proof
  // flow has a signer (issue #213). Fall back to the kit's currently
  // selected wallet when no explicit wallet is passed in.
  state.activeWallet = wallet || state.activeWallet || kit;
  el.payerAddress.textContent = address;
  el.connect.classList.add('hidden');
  el.dashboard.classList.remove('hidden');
  log(t('dash.connectedLog', { address }));
  await loadQuestions();
  log(`Connected ${address}`);
  setSupportWallet(address);
  await loadQuestions();
  startLiveUpdates();
  setConnectButtonsBusy(false);
}

// Live updates (issue #6): polling via statusChannel.js, which re-fetches the
// snapshot on an interval, on tab refocus, and on Refresh.
function startLiveUpdates() {
  state.channel?.close();
  state.channel = subscribeQuestionStatus({
    backendUrl: BACKEND_URL,
    address: state.address,
    getToken: ensureSession,
    onSnapshot: (data) => {
      render(data);
      log(`Loaded ${t('dash.questions', { n: data.questions.length })} — ${formatNumber(data.totalTracked)} tracked in total.`);
    },
    onConnection: (connected) => {
      el.liveStatus.textContent = t(connected ? 'dash.live' : 'dash.reconnecting');
    },
  });
  state.channel.ready.catch((err) => log(`Could not load questions: ${err.message}`));
}

el.btnRefresh.addEventListener('click', async () => {
  if (!state.channel) return;
  el.btnRefresh.disabled = true;
  try {
    const token = await ensureSession();
    const res = await fetch(`${BACKEND_URL}/payers/${state.address}/questions?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(`unexpected status ${res.status}`);
    const data = await res.json();
    render(data);
    log(t('dash.loaded', { count: data.questions.length, total: data.totalTracked }));
    await state.channel.resync();
  } catch (err) {
    log(t('dash.loadFailed', { error: err.message }));
  } finally {
    el.btnRefresh.disabled = false;
  }
});

onLocaleChange(() => state.lastData && render(state.lastData));

// Clears every live cancel countdown. Called before render() replaces the
// question list so a detached row's setInterval can't keep ticking (#282).
function clearCountdowns() {
  for (const handle of state.countdowns.values()) clearInterval(handle);
  state.countdowns.clear();
}

function render(data) {
  state.lastData = data;
  el.statSpend.textContent = formatUsdc(data.totalSpend);
  el.statCount.textContent = formatNumber(data.totalTracked);
  el.statSuccess.textContent = data.successRate === null ? '—' : formatNumber(data.successRate, { style: 'percent' });

  clearCountdowns();
  el.questionList.innerHTML = '';
  state.items.clear();
  if (data.questions.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted small';
    li.textContent = t('dash.empty');
    li.textContent = t('dash.none');
    el.questionList.appendChild(li);
    return;
  }

  for (const q of data.questions) {
    const li = renderQuestionItem(q);
    state.items.set(q.questionId, li);
    el.questionList.appendChild(li);
  }
}

// Intensity floor for the spend calendar. A flat floor (e.g. 0.12) makes a
// tiny real spend (say 0.01 USDC against a 1000 USDC max) render almost
// identically to a much larger one near the floor, so the calendar visually
// overstates small days. Instead we scale on a log curve so small spends
// stay distinguishable from each other while still being visible, and only
// fall back to a small floor for a genuinely zero day.
const SPEND_INTENSITY_FLOOR = 0.06;

function spendIntensity(amount, max) {
  if (!Number.isFinite(amount) || amount <= 0) return SPEND_INTENSITY_FLOOR;
  if (!Number.isFinite(max) || max <= 0) return SPEND_INTENSITY_FLOOR;
  const ratio = Math.min(amount / max, 1);
  // log1p keeps small ratios from collapsing onto the floor: 0.001 -> ~0.14,
  // 0.01 -> ~0.29, 0.1 -> ~0.55, 1 -> 1, so a tiny spend no longer reads the
  // same as a much larger one near the floor.
  const scaled = Math.log1p(ratio * 9) / Math.log1p(9);
  return Math.max(SPEND_INTENSITY_FLOOR, scaled);
}

function renderSpendCalendar(questions, totalSpend) {
  const daily = new Map();
  for (const question of questions) {
    const dateValue = question.createdAt || question.created_at || question.timestamp;
    const date = dateValue ? new Date(dateValue) : null;
    const amount = Number(question.amount || 0);
    if (!date || Number.isNaN(date.valueOf()) || !Number.isFinite(amount)) continue;
    const day = date.toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + amount);
  }
  const entries = [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-84);
  const max = Math.max(...entries.map(([, amount]) => amount), 1);
  el.spendCalendarGrid.replaceChildren();
  for (const [day, amount] of entries) {
    const cell = document.createElement('div');
    cell.className = 'spend-calendar-cell';
    cell.style.setProperty('--spend-intensity', String(spendIntensity(amount, max)));
    cell.setAttribute('role', 'listitem');
    cell.title = `${day}: ${amount.toFixed(2)} USDC`;
    cell.setAttribute('aria-label', cell.title);
    cell.textContent = day.slice(8);
    el.spendCalendarGrid.append(cell);
  }
  if (!entries.length) el.spendCalendarGrid.textContent = 'No dated question records are available yet.';
  el.spendCalendarTotal.textContent = `${Number(totalSpend || 0).toFixed(2)} USDC total`;
}

function renderQuestionItem(q) {
  const li = document.createElement('li');
  li.className = 'question-item';

  const row = document.createElement('div');
  row.className = 'row';

  const left = document.createElement('div');
  const qText = document.createElement('p');
  qText.className = 'q-text';
  // This renderer only creates DOM nodes and assigns textContent to untrusted
  // text. Fenced code is tokenised into isolated safe spans; raw HTML is never
  // interpreted.
  renderFencedCode(qText, q.question || q.questionId);
  const qMeta = document.createElement('div');
  qMeta.className = 'q-meta';
  const parts = [q.tier, q.amount ? `${q.amount} USDC` : null];
  if (q.status === 'settled' && q.outcome === 'resolved') parts.push(t('dash.confidence', { value: q.confidence }));
  const parts = [q.tier, q.amount ? formatUsdc(q.amount) : null];
  if (q.status === 'settled' && q.outcome === 'resolved') parts.push(`confidence ${formatNumber(q.confidence)}`);
  qMeta.textContent = parts.filter(Boolean).join(' · ');
  left.append(qText, qMeta);

  // Issue #20: show the actual answer a resolved question paid for, not just
  // its metadata. Own element (not folded into qMeta) so it reads as "here's
  // your answer," not another metadata fragment. Defensive against a
  // resolved-but-no-answer-field response, which shouldn't happen per the
  // backend but must not break rendering if it does.
  if (q.status === 'settled' && q.outcome === 'resolved' && q.answer) {
    const answerEl = document.createElement('p');
    answerEl.className = 'q-answer';
    const answerLabel = document.createElement('strong');
    answerLabel.textContent = 'Answer: ';
    answerEl.append(answerLabel, q.answer);
    left.append(answerEl);
  }

  const badge = document.createElement('span');
  const { label, cls } = describeStatus(q);
  badge.className = `badge ${cls}`;
  badge.textContent = label;

  // Unstarring while "Starred only" is on should drop the row immediately.
  const star = createStarButton(state.address, q.questionId, () => {
    if (state.starredOnly) renderQuestionList();
  });

  row.append(star, left, badge);
  li.appendChild(row);

  // Issue #32: a question still inside its undo window gets a live
  // countdown and a Cancel button, mirroring the worker console's
  // setInterval-driven timer-bar pattern (main.js's startCountdown()/
  // el.timerBar) rather than inventing a second countdown UI.
  if (q.status !== 'settled' && Number.isFinite(q.cancellableUntil) && q.cancellableUntil > Date.now()) {
    li.appendChild(renderCancelControls(q));
  }

  return li;
}

/** Renders the countdown + Cancel button for a question still inside its
 * undo window (`q.cancellableUntil`, an epoch-ms timestamp assumed to be
 * added to the GET /payers/:address/questions response for an in-progress
 * question — see issue #32). Wired to the assumed
 * POST /payers/:address/questions/:questionId/cancel endpoint, reusing the
 * existing payer session token from ensureSession(). */
function renderCancelControls(q) {
  const wrap = document.createElement('div');
  wrap.className = 'cancel-controls';

  const track = document.createElement('div');
  track.className = 'timer-track';
  const bar = document.createElement('div');
  bar.className = 'timer-bar';
  track.appendChild(bar);

  const label = document.createElement('p');
  label.className = 'muted small';

  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.className = 'secondary';
  btnCancel.textContent = 'Cancel';

  wrap.append(track, label, btnCancel);

  const total = q.cancellableUntil - Date.now();
  let handle = null;

  function tick() {
    const remainingMs = q.cancellableUntil - Date.now();
    if (remainingMs <= 0) {
      clearInterval(handle);
      wrap.remove();
      return;
    }
    const pct = Math.max(0, Math.min(100, (remainingMs / total) * 100));
    bar.style.width = `${pct}%`;
    label.textContent = `You can cancel this for ${Math.ceil(remainingMs / 1000)}s`;
  }
  tick();
  handle = setInterval(tick, 250);

  btnCancel.addEventListener('click', async () => {
    btnCancel.disabled = true;
    try {
      const token = await ensureSession();
      const res = await fetch(
        `${BACKEND_URL}/payers/${state.address}/questions/${encodeURIComponent(q.questionId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `unexpected status ${res.status}`);
      clearInterval(handle);
      wrap.remove();
      const li = wrap.closest('.question-item');
      if (li) {
        const badge = li.querySelector('.badge');
        if (badge) {
          badge.className = 'badge badge-refunded';
          badge.textContent = 'cancelled';
        }
      }
      log(`Cancelled question ${q.questionId}.`);
    } catch (err) {
      clearInterval(handle);
      btnCancel.disabled = false;
      log(`Could not cancel question ${q.questionId}: ${err.message}`);
    }
  });

  return wrap;
}

function describeStatus(q) {
  if (q.status !== 'settled') return { label: t('status.pending'), cls: 'badge-pending' };
  if (q.status !== 'settled') {
    const key = q.status === 'awaiting_workers' || q.status === 'reconciling' ? q.status : 'pending';
    return { label: t(`status.${key}`), cls: 'badge-pending' };
  }
  if (q.outcome === 'resolved') return { label: t('status.resolved'), cls: 'badge-resolved' };
  return { label: t('status.refunded'), cls: 'badge-refunded' };
}

// --- First-visit walkthrough (issue #61) ----------------------------------
// Payers expect a "login"; this page is not one. Explain the read-only,
// address-keyed model and the status badges once, on first connect.
const statsRow = el.statSpend.closest('.row, .stats') || el.statSpend.parentElement;
el.connect.addEventListener(
  'click',
  () =>
    startTour('arbiter_tour_payer_seen', [
      {
        target: null,
        title: 'No account, just your address',
        text: 'This dashboard is read-only. Everything shown is rebuilt from the backend\'s job records for the connected wallet address — nothing is saved, and no account is created.',
      },
      {
        target: statsRow,
        title: 'Your totals',
        text: 'Total spend, number of questions asked, and the share that resolved successfully.',
      },
      {
        target: el.questionList,
        title: 'Status badges',
        text: '"in progress": workers are still answering. "resolved": an answer was settled and paid. "refunded": no valid answer was reached, so your payment was returned.',
      },
    ]),
  { once: true },
);

// --- Live support chat (issue #62) ----------------------------------------
initSupportChat('payer');
