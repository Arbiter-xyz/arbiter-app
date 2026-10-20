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

async function switchIdentity(address, wallet = null) {
  state.address = address;
  // Populate activeWallet so ensureSession()'s wallet-signed session-proof
  // flow has a signer (issue #213). Fall back to the kit's currently
  // selected wallet when no explicit wallet is passed in.
  state.activeWallet = wallet || state.activeWallet || kit;
  el.payerAddress.textContent = address;
  el.connect.classList.add('hidden');
  el.dashboard.classList.remove('hidden');
  log(`Connected ${address}`);
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
    await state.channel.resync();
  } catch (err) {
    log(`Could not load questions: ${err.message}`);
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
  el.spendCalendarTotal.textContent = `${Numbe

/* … truncated 5423 chars — edit only what you need near the top … */
