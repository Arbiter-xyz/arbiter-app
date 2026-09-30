import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  LobstrModule,
  xBullModule,
  HanaModule,
  AlbedoModule,
  HotWalletModule,
  LedgerModule,
} from '@creit.tech/stellar-wallets-kit';
import { openSecureLocalWallet } from './localWallet.js';
import { subscribeQuestionStatus } from './statusChannel.js';
import { initI18n, onLocaleChange, t, formatUsdc, formatNumber } from './i18n.js';
import { renderMarkdown } from './markdown.js';
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
    log(`Quick start failed: ${err.message}`);
  }
});

async function switchIdentity(address) {
  state.address = address;
  if (state.identity.walletId) kit.setWallet(state.identity.walletId);
  el.payerAddress.textContent = address;
  el.connect.classList.add('hidden');
  el.dashboard.classList.remove('hidden');
  log(`Connected ${address}`);
  startLiveUpdates();
  setConnectButtonsBusy(false);
}

// Live updates (issue #6): one shared push stream across all dashboard tabs
// for this address instead of each tab polling. The snapshot is only
// re-fetched to backfill (reconnect, gap, tab refocus) or on Refresh.
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
    onEvent: applyStatusEvent,
    onConnection: (connected) => {
      el.liveStatus.textContent = t(connected ? 'dash.live' : 'dash.reconnecting');
    },
  });
  state.channel.ready.catch((err) => log(`Could not load questions: ${err.message}`));
}

function applyStatusEvent(q) {
  const existing = state.items.get(q.questionId);
  const prev = state.lastData?.questions.find((x) => x.questionId === q.questionId);
  const merged = { ...prev, ...q };
  if (prev) Object.assign(prev, q);
  const li = renderQuestionItem(merged);
  if (existing) existing.replaceWith(li);
  else el.questionList.prepend(li);
  state.items.set(q.questionId, li);
  log(`${q.questionId}: ${describeStatus(merged).label}`);
  // Aggregates (spend / success rate) are server-computed; refresh them
  // once a job reaches its terminal state.
  if (q.status === 'settled') state.channel?.resync();
}

el.btnRefresh.addEventListener('click', async () => {
  if (!state.channel) return;
  el.btnRefresh.disabled = true;
  try {
    await state.channel.resync();
  } catch (err) {
    log(`Could not load questions: ${err.message}`);
  } finally {
    el.btnRefresh.disabled = false;
  }
});

onLocaleChange(() => state.lastData && render(state.lastData));

function render(data) {
  state.lastData = data;
  el.statSpend.textContent = formatUsdc(data.totalSpend);
  el.statCount.textContent = formatNumber(data.totalTracked);
  el.statSuccess.textContent = data.successRate === null ? '—' : formatNumber(data.successRate, { style: 'percent' });

  el.questionList.innerHTML = '';
  state.items.clear();
  if (data.questions.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted small';
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
    cell.style.setProperty('--spend-intensity', String(Math.max(0.12, amount / max)));
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

  // Surface the real, load-bearing guarantee for still-pending questions:
  // refund_timeout() is permissionless (no require_auth()), so anyone can
  // force a refund once the timeout window elapses — even if Arbiter's
  // backend disappears. Stated plainly, not oversold.
  if (q.status !== 'settled') {
    const safety = document.createElement('p');
    safety.className = 'q-safety muted small';
    safety.textContent = refundSafetyLine(q);
    li.appendChild(safety);
  }

  return li;
}

/** Plain-language statement of the on-chain refund guarantee. The contract's
 * refund_timeout() is permissionless, so this is checkable against real
 * behavior — not marketing copy. Kept as a single helper so future guarantees
 * (pause switch, threshold custody) can be appended without a rewrite. */
function refundSafetyLine(q) {
  const base = 'Your funds are recoverable even if Arbiter goes down: after the refund timeout window, anyone can trigger an automatic refund on-chain — no action from Arbiter required.';
  if (q.refundAvailableAt) {
    const when = new Date(q.refundAvailableAt);
    if (!Number.isNaN(when.getTime())) {
      return `${base} Refund available from ${when.toLocaleString()}.`;
    }
  }
  return base;
}

function describeStatus(q) {
  if (q.status !== 'settled') {
    const key = q.status === 'awaiting_workers' || q.status === 'reconciling' ? q.status : 'pending';
    return { label: t(`status.${key}`), cls: 'badge-pending' };
  }
  if (q.outcome === 'resolved') return { label: t('status.resolved'), cls: 'badge-resolved' };
  return { label: t('status.refunded'), cls: 'badge-refunded' };
}
