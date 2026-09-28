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
import { createOrLoadLocalWallet } from './localWallet.js';
import { renderMarkdown } from './markdown.js';
import { createNotificationCenter } from './notifications.js';

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
  accountSwitcher: document.getElementById('account-switcher'),
  accountSelect: document.getElementById('account-select'),
  btnAddWallet: document.getElementById('btn-add-wallet'),
};

// Connected identities keyed by address, each with its own cached session —
// see the worker console's state (issue #132).
const state = {
  identities: new Map(),
  address: null,
  get identity() {
    return this.identities.get(this.address) || null;
  },
};

const notify = createNotificationCenter({ mount: document.querySelector('header'), storageKey: 'arbiter-dashboard-notifications' });

function log(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.log.prepend(li);
  notify(message);
}

function setConnectButtonsBusy(busy) {
  el.btnConnect.disabled = busy;
  el.btnQuickStart.disabled = busy;
}

/** Proves control of this address once, same primitive as the worker
 * console's ensureSession() — these questions/balance are only readable
 * with a valid session now, not by anyone who just knows the address. */
async function ensureSession() {
  const identity = state.identity; // pinned against a mid-flight account switch
  if (identity.sessionToken && Date.now() < identity.sessionExpiresAt - 60_000) return identity.sessionToken;
  const { address, wallet } = identity;

  log('Proving control of your address (one signature)…');
  const challengeRes = await fetch(`${BACKEND_URL}/payers/${address}/session/challenge`, { method: 'POST' });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error || 'failed to get session challenge');
  const { xdr } = await challengeRes.json();

  const { signedTxXdr } = await wallet.signTransaction(xdr, {
    address,
    networkPassphrase: WalletNetwork.TESTNET,
  });

  const sessionRes = await fetch(`${BACKEND_URL}/payers/${address}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  if (!sessionRes.ok) throw new Error((await sessionRes.json()).error || 'failed to establish session');
  const { token, expiresAt } = await sessionRes.json();
  identity.sessionToken = token;
  identity.sessionExpiresAt = expiresAt;
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
        await activate(kit, address, option.id);
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
    const localWallet = createOrLoadLocalWallet();
    const { address } = await localWallet.getAddress();
    await activate(localWallet, address);
  } catch (err) {
    setConnectButtonsBusy(false);
    log(`Quick start failed: ${err.message}`);
  }
});

async function activate(wallet, address, walletId = null) {
  const existing = state.identities.get(address);
  if (existing) Object.assign(existing, { wallet, walletId });
  else state.identities.set(address, { address, wallet, walletId, sessionToken: null, sessionExpiresAt: 0 });
  log(`Connected ${address}`);
  await switchIdentity(address);
  setConnectButtonsBusy(false);
}

async function switchIdentity(address) {
  state.address = address;
  if (state.identity.walletId) kit.setWallet(state.identity.walletId);
  el.payerAddress.textContent = address;
  el.connect.classList.add('hidden');
  el.dashboard.classList.remove('hidden');
  el.accountSelect.innerHTML = '';
  for (const addr of state.identities.keys()) {
    const option = document.createElement('option');
    option.value = addr;
    option.textContent = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    option.selected = addr === address;
    el.accountSelect.append(option);
  }
  el.accountSwitcher.classList.remove('hidden');
  await loadQuestions();
}

el.accountSelect.addEventListener('change', () => {
  switchIdentity(el.accountSelect.value).catch((err) => log(`Switch failed: ${err.message}`));
});

el.btnAddWallet.addEventListener('click', () => {
  el.dashboard.classList.add('hidden');
  el.connect.classList.remove('hidden');
});

el.btnRefresh.addEventListener('click', loadQuestions);

async function loadQuestions() {
  if (!state.address) return;
  el.btnRefresh.disabled = true;
  try {
    const token = await ensureSession();
    const res = await fetch(`${BACKEND_URL}/payers/${state.address}/questions?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(`unexpected status ${res.status}`);
    const data = await res.json();
    render(data);
    log(`Loaded ${data.questions.length} question(s) — this address has asked ${data.totalTracked} total.`);
  } catch (err) {
    log(`Could not load questions: ${err.message}`);
  } finally {
    el.btnRefresh.disabled = false;
  }
}

function render(data) {
  el.statSpend.textContent = `${data.totalSpend} USDC`;
  el.statCount.textContent = String(data.totalTracked);
  el.statSuccess.textContent = data.successRate === null ? '—' : `${Math.round(data.successRate * 100)}%`;

  el.questionList.innerHTML = '';
  if (data.questions.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted small';
    li.textContent = 'No questions yet.';
    el.questionList.appendChild(li);
    return;
  }

  for (const q of data.questions) {
    el.questionList.appendChild(renderQuestionItem(q));
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
  const parts = [q.tier, q.amount ? `${q.amount} USDC` : null];
  if (q.status === 'settled' && q.outcome === 'resolved') parts.push(`confidence ${q.confidence}`);
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
  if (q.status !== 'settled') return { label: 'in progress', cls: 'badge-pending' };
  if (q.outcome === 'resolved') return { label: 'resolved', cls: 'badge-resolved' };
  return { label: 'refunded', cls: 'badge-refunded' };
}
