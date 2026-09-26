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

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

// Same hand-picked module list as the worker console — see main.js.
// Ledger is added explicitly (not via allowAllModules()) so the Trezor/
// protobufjs surface stays excluded — see the round-5 note in main.js.
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [new FreighterModule(), new LobstrModule(), new xBullModule(), new HanaModule(), new AlbedoModule(), new HotWalletModule(), new LedgerModule()],
});

const el = {
  connect: document.getElementById('panel-connect'),
  dashboard: document.getElementById('panel-dashboard'),
  btnConnect: document.getElementById('btn-connect'),
  btnQuickStart: document.getElementById('btn-quick-start'),
  btnRefresh: document.getElementById('btn-refresh'),
  payerAddress: document.getElementById('payer-address'),
  statSpend: document.getElementById('stat-spend'),
  statCount: document.getElementById('stat-count'),
  statSuccess: document.getElementById('stat-success'),
  questionList: document.getElementById('question-list'),
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
}

function setConnectButtonsBusy(busy) {
  el.btnConnect.disabled = busy;
  el.btnQuickStart.disabled = busy;
}

/** Proves control of this address once, same primitive as the worker
 * console's ensureSession() — these questions/balance are only readable
 * with a valid session now, not by anyone who just knows the address. */
async function ensureSession() {
  if (state.sessionToken && Date.now() < state.sessionExpiresAt - 60_000) return state.sessionToken;

  log('Proving control of your address (one signature)…');
  const challengeRes = await fetch(`${BACKEND_URL}/payers/${state.address}/session/challenge`, { method: 'POST' });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error || 'failed to get session challenge');
  const { xdr } = await challengeRes.json();

  const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, {
    address: state.address,
    networkPassphrase: WalletNetwork.TESTNET,
  });

  const sessionRes = await fetch(`${BACKEND_URL}/payers/${state.address}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  if (!sessionRes.ok) throw new Error((await sessionRes.json()).error || 'failed to establish session');
  const { token, expiresAt } = await sessionRes.json();
  state.sessionToken = token;
  state.sessionExpiresAt = expiresAt;
  log('Session established.');
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
        if (err) log(`Wallet selection closed: ${err.message}`);
      },
    });
  } catch (err) {
    setConnectButtonsBusy(false);
    log(`Wallet connect failed: ${err.message}`);
  }
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

async function activate(wallet, address) {
  state.activeWallet = wallet;
  state.address = address;
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

function renderQuestionItem(q) {
  const li = document.createElement('li');
  li.className = 'question-item';

  const row = document.createElement('div');
  row.className = 'row';

  const left = document.createElement('div');
  const qText = document.createElement('p');
  qText.className = 'q-text';
  // Markdown is rendered through a sanitizing renderer (markdown.js) that
  // builds safe DOM nodes — never innerHTML of raw user content.
  renderMarkdown(qText, q.question || q.questionId);
  const qMeta = document.createElement('div');
  qMeta.className = 'q-meta';
  const parts = [q.tier, q.amount ? formatUsdc(q.amount) : null];
  if (q.status === 'settled' && q.outcome === 'resolved') parts.push(`confidence ${formatNumber(q.confidence)}`);
  qMeta.textContent = parts.filter(Boolean).join(' · ');
  left.append(qText, qMeta);

  const badge = document.createElement('span');
  const { label, cls } = describeStatus(q);
  badge.className = `badge ${cls}`;
  badge.textContent = label;

  row.append(left, badge);
  li.appendChild(row);
  return li;
}

function describeStatus(q) {
  if (q.status !== 'settled') {
    const key = q.status === 'awaiting_workers' || q.status === 'reconciling' ? q.status : 'pending';
    return { label: t(`status.${key}`), cls: 'badge-pending' };
  }
  if (q.outcome === 'resolved') return { label: t('status.resolved'), cls: 'badge-resolved' };
  return { label: t('status.refunded'), cls: 'badge-refunded' };
}
