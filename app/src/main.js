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
  WalletConnectModule,
} from '@creit.tech/stellar-wallets-kit';
import { createOrLoadLocalWallet, getLocalWalletSecret } from './localWallet.js';
import { StrKey } from '@stellar/stellar-sdk';
import { buildStakeXdr, buildWithdrawXdr, buildWithdrawToXdr } from './contractCalls.js';
import { stroopsFromUsdcInput } from './units.js';
import { initBankWithdraw } from './anchor.js';
import { renderFencedCode } from './codeBlocks.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const USDC_ASSET_CODE = import.meta.env.VITE_USDC_ASSET_CODE || 'USDC';
// Keep in sync with backend MAX_ANSWER_LENGTH. The API remains authoritative.
const MAX_ANSWER_LENGTH = 400;
const ANSWER_DRAFT_PREFIX = 'arbiter:answer-draft:';

// Hand-picked, not allowAllModules(): explicit about which wallets we
// support (matching the original spec's list) rather than automatically
// inheriting whatever the kit adds in a future version — including
// hardware-wallet adapters (Trezor/Ledger) that pull in a large, more
// security-sensitive dependency tree we have no use for. See the README
// for the concrete CVE this sidesteps.
//
// LedgerModule is the one deliberate exception (issue #75): it is added
// explicitly by name rather than via allowAllModules(), so the Trezor
// adapters and their protobufjs dependency tree stay excluded. Ledger's
// browser integration is WebUSB/WebHID against the device directly (the
// kit's Ledger module), not a deep link into the Ledger Live companion
// app. Before merging, re-run round 5's audit process: grep the built
// bundle for `trezor`/`protobuf` and run `npm audit --audit-level=high`,
// confirming the critical/high count stays at zero.
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [new FreighterModule(), new LobstrModule(), new xBullModule(), new HanaModule(), new AlbedoModule(), new HotWalletModule(), new LedgerModule(), ...(WALLETCONNECT_PROJECT_ID ? [new WalletConnectModule({ projectId: WALLETCONNECT_PROJECT_ID, metadata: { name: 'Arbiter', description: 'Arbiter worker console', url: window.location.origin, icons: [] } })] : [])],
});

const el = {
  connect: document.getElementById('panel-connect'),
  backup: document.getElementById('panel-backup'),
  onboard: document.getElementById('panel-onboard'),
  online: document.getElementById('panel-online'),
  question: document.getElementById('panel-question'),
  earnings: document.getElementById('panel-earnings'),
  btnConnect: document.getElementById('btn-connect'),
  btnQuickStart: document.getElementById('btn-quick-start'),
  backupSecret: document.getElementById('backup-secret'),
  btnRevealSecret: document.getElementById('btn-reveal-secret'),
  btnCopySecret: document.getElementById('btn-copy-secret'),
  backupCopyStatus: document.getElementById('backup-copy-status'),
  btnOnboard: document.getElementById('btn-onboard'),
  btnToggle: document.getElementById('btn-toggle'),
  workerAddress: document.getElementById('worker-address'),
  workerStatus: document.getElementById('worker-status'),
  categoryPicker: document.getElementById('category-picker'),
  questionText: document.getElementById('question-text'),
  timerBar: document.getElementById('timer-bar'),
  answerForm: document.getElementById('answer-form'),
  answerInput: document.getElementById('answer-input'),
  answerCount: document.getElementById('answer-count'),
  btnRestoreDraft: document.getElementById('btn-restore-draft'),
  btnAnswer: document.getElementById('btn-answer'),
  owedAmount: document.getElementById('owed-amount'),
  stakeAmount: document.getElementById('stake-amount'),
  trackRecordSummary: document.getElementById('track-record-summary'),
  btnEnablePush: document.getElementById('btn-enable-push'),
  pushStatus: document.getElementById('push-status'),
  digestSelect: document.getElementById('digest-select'),
  digestStatus: document.getElementById('digest-status'),
  btnWithdraw: document.getElementById('btn-withdraw'),
  btnWithdrawBank: document.getElementById('btn-withdraw-bank'),
  bankWithdrawStatus: document.getElementById('bank-withdraw-status'),
  withdrawBeneficiaryInput: document.getElementById('withdraw-beneficiary-input'),
  stakeForm: document.getElementById('stake-form'),
  stakeInput: document.getElementById('stake-input'),
  btnStake: document.getElementById('btn-stake'),
  log: document.getElementById('log'),
  accountSwitcher: document.getElementById('account-switcher'),
  accountSelect: document.getElementById('account-select'),
  btnAddWallet: document.getElementById('btn-add-wallet'),
};

const state = {
  // Every connected identity, keyed by address (issue #132): each keeps its
  // own wallet and cached session, so switching accounts never throws away a
  // still-valid session. `wallet` is either the StellarWalletsKit instance
  // (plus the kit `walletId` to re-select on switch) or a local quick-start
  // wallet — both expose the same {getAddress, signTransaction} shape.
  identities: new Map(),
  address: null,
  get identity() {
    return this.identities.get(this.address) || null;
  },
  get activeWallet() {
    return this.identity?.wallet || null;
  },
  get sessionToken() {
    return this.identity?.sessionToken || null;
  },
  get sessionExpiresAt() {
    return this.identity?.sessionExpiresAt || 0;
  },
  online: false,
  eventSource: null,
  currentQuestion: null,
  countdownHandle: null,
  sessionToken: null,
  sessionExpiresAt: 0,
  lastDraft: null,
};

const notify = createNotificationCenter({ mount: document.querySelector('header'), storageKey: 'arbiter-worker-notifications' });

/** Activity-log entry; also mirrored into the header bell (issue #133). */
function log(message) {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.textContent = `[${time}] ${message}`;
  el.log.prepend(li);
  notify(message);
}

// --- Backend API version check (issue #150) -------------------------------
//
// arbiter-backend and this app are independently deployed repos, so a
// backend API change would otherwise only surface as a broken request
// mid-flow. On load we read the version the backend reports at GET /health
// and, on mismatch, show a visible-but-non-blocking banner. HTTP APIs are
// forgiving, so this informs rather than gates: a mismatch never blocks
// app usage.

function showVersionMismatchNotice(reportedVersion) {
  const banner = document.createElement('div');
  banner.id = 'backend-version-notice';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:9999',
    'padding:8px 12px',
    'background:#7a1f1f',
    'color:#fff',
    'font:13px/1.4 system-ui,sans-serif',
    'text-align:center',
  ].join(';');
  banner.textContent =
    `Backend API version mismatch: this app expects v${COMPATIBLE_BACKEND_VERSION}, ` +
    `but the backend reports v${reportedVersion}. Some features may not work as expected.`;
  document.body.prepend(banner);
}

async function checkBackendVersion() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const reportedVersion = data.apiVersion ?? data.version;
    if (reportedVersion == null) {
      // Backend predates the /health version field; nothing to compare.
      return;
    }
    if (String(reportedVersion) !== String(COMPATIBLE_BACKEND_VERSION)) {
      showVersionMismatchNotice(reportedVersion);
      log(`Backend API version mismatch: expected v${COMPATIBLE_BACKEND_VERSION}, got v${reportedVersion}`);
    }
  } catch (err) {
    // Backend unreachable or malformed: don't block or alarm the user here;
    // the existing request paths already surface connectivity problems.
  }
}

function showPanel(name) {
  for (const key of ['connect', 'onboard', 'online']) {
    el[key].classList.toggle('hidden', key !== name);
  }
  el.earnings.classList.toggle('hidden', name !== 'online');
}

function selectedCategories() {
  return [...el.categoryPicker.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
}

// --- Live category-demand heatmap (issue #77) -----------------------------
//
// Reads the same smoothed per-category online-worker counts dispatch.js
// already computes internally (getSmoothedOnlineWorkerCount() /
// computeSmoothedCount()) via GET /categories/demand, and paints a small
// bar next to each category checkbox so a worker can see which topics are
// short on workers before going online. Degrades gracefully (bars hidden,
// no broken UI) when the backend is unreachable, matching the trustLive
// pattern in landing/script.js.

const DEMAND_REFRESH_MS = 30_000;
let demandRefreshHandle = null;

function demandBarFor(category) {
  const label = el.categoryPicker.querySelector(`label[data-category="${category}"]`);
  return label ? label.querySelector('.category-demand-bar') : null;
}

function renderCategoryDemand(demand) {
  // demand: { [category]: smoothedOnlineWorkerCount }
  const counts = Object.values(demand).filter((n) => Number.isFinite(n));
  const max = counts.length ? Math.max(...counts, 1) : 1;
  for (const input of el.categoryPicker.querySelectorAll('input[type=checkbox]')) {
    const bar = demandBarFor(input.value);
    if (!bar) continue;
    const count = Number.isFinite(demand[input.value]) ? demand[input.value] : 0;
    // Scarcity = demand: fewer online workers means a taller bar.
    const scarcity = 1 - count / max;
    bar.style.width = `${Math.round(scarcity * 100)}%`;
    bar.title = `${count} worker${count === 1 ? '' : 's'} online now`;
  }
}

function clearCategoryDemand() {
  for (const bar of el.categoryPicker.querySelectorAll('.category-demand-bar')) {
    bar.style.width = '0%';
    bar.removeAttribute('title');
  }
}

async function refreshCategoryDemand() {
  try {
    const res = await fetch(`${BACKEND_URL}/categories/demand`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderCategoryDemand(data.demand || {});
  } catch (err) {
    // Backend unreachable or malformed: hide the heatmap rather than
    // leaving stale or broken bars in the picker.
    clearCategoryDemand();
  }
}

function startCategoryDemandPolling() {
  if (demandRefreshHandle) return;
  refreshCategoryDemand();
  demandRefreshHandle = setInterval(refreshCategoryDemand, DEMAND_REFRESH_MS);
}

startCategoryDemandPolling();

// --- Wallet connect (extension) or quick start (local, non-custodial) -----

// A user clicking both connect options in quick succession could otherwise
// let whichever resolves last silently overwrite the other's in-flight
// state.activeWallet/state.address — guard against that race by disabling
// both the instant either one starts, and only re-enabling on failure.
function setConnectButtonsBusy(busy) {
  el.btnConnect.disabled = busy;
  el.btnQuickStart.disabled = busy;
}

el.btnConnect.addEventListener('click', async () => {
  setConnectButtonsBusy(true);
  try {
    await kit.openModal({
      onWalletSelected: async (option) => {
        kit.setWallet(option.id);
        const { address } = await kit.getAddress();
        el.backup.classList.add('hidden'); // backup/reveal only applies to the local quick-start wallet
        await activateWallet(kit, address, option.id);
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
    log('Using a local, browser-held quick-start wallet (non-custodial — the key never leaves this browser).');
    showBackupPanel();
    await activateWallet(localWallet, address);
  } catch (err) {
    setConnectButtonsBusy(false);
    log(`Quick start failed: ${err.message}`);
  }
});

function showBackupPanel() {
  el.backup.classList.remove('hidden');
  el.backupSecret.value = '••••••••••••••••••••••••••••••••••••••••••••••••••';
  el.backupSecret.type = 'password';
  el.backupCopyStatus.textContent = '';
}

el.btnRevealSecret.addEventListener('click', () => {
  const revealed = el.backupSecret.type === 'password';
  if (revealed) el.backupSecret.value = getLocalWalletSecret() || '';
  el.backupSecret.type = revealed ? 'text' : 'password';
  el.btnRevealSecret.textContent = revealed ? 'Hide' : 'Reveal';
});

el.btnCopySecret.addEventListener('click', async () => {
  const secret = getLocalWalletSecret();
  if (!secret) return;
  try {
    await navigator.clipboard.writeText(secret);
    el.backupCopyStatus.textContent = 'Copied to clipboard — store it somewhere safe, then clear your clipboard.';
  } catch (err) {
    el.backupCopyStatus.textContent = `Could not copy automatically (${err.message}) — reveal and copy it manually.`;
  }
});

// --- Notification digest preference (pending backend) ---
//
// POST /workers/:address/digest does not exist in arbiter-backend yet (see the
// README's "Notification digest" section), so this is a coming-soon toggle: it
// tries the call and says plainly when the backend can't take it.
el.digestSelect.addEventListener('change', async () => {
  const digest = el.digestSelect.value;
  if (!state.address) {
    el.digestStatus.textContent = 'Connect first — digest preference is not saved (coming soon).';
    return;
  }
  try {
    const token = await ensureSession();
    const res = await fetch(`${BACKEND_URL}/workers/${state.address}/digest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, digest }),
    });
    if ([404, 405, 501].includes(res.status)) {
      el.digestStatus.textContent = 'Digest is coming soon — the backend does not support it yet, so nothing was saved.';
    } else if (!res.ok) {
      el.digestStatus.textContent = `Could not save digest preference (HTTP ${res.status}).`;
    } else {
      el.digestStatus.textContent = `Digest preference saved: ${digest}.`;
    }
  } catch (err) {
    el.digestStatus.textContent = `Could not save digest preference: ${err.message}`;
  }
});

// --- Social recovery (client-side Shamir split, no backend involvement) ---
//
// The quick-start secret is split into N shares entirely in this browser.
// Arbiter's backend never sees the secret or any share: distribution is the
// user's own (contacts, a second device, a password manager). Reconstructing
// from any k shares reproduces the original Keypair/address, so the README's
// non-custodial framing is unchanged — there is no server-side capability to
// rebuild a u

async function activateWallet(wallet, address) {
  state.activeWallet = wallet;
  state.address = address;
  log(`Connected wallet ${address}`);
  el.workerAddress.textContent = address;
  await routeAfterConnect();
  setConnectButtonsBusy(false);
}

async function hasUsdcTrustline(address) {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
  const account = await res.json();
  return (account.balances || []).some((balance) => balance.asset_code === USDC_ASSET_CODE);
}

async function routeAfterConnect() {
  try {
    const ready = await hasUsdcTrustline(state.address);
    showPanel(ready ? 'online' : 'onboard');
  } catch (error) {
    log(`Trustline check failed (${error.message}) — assuming onboarding is needed`);
    showPanel('onboard');
  }
}

el.btnOnboard.addEventListener('click', async () => {
  el.btnOnboard.disabled = true;
  try {
    const build = await fetch(`${BACKEND_URL}/sponsor/onboard/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: state.address }),
    });
    if (!build.ok) throw new Error(`build failed: ${build.status}`);
    const { xdr } = await build.json();
    const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, { address: state.address, networkPassphrase: WalletNetwork.TESTNET });
    const submit = await fetch(`${BACKEND_URL}/sponsor/onboard/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xdr: signedTxXdr }),
    });
    if (!submit.ok) throw new Error(`submit failed: ${submit.status}`);
    showPanel('online');
  } catch (error) {
    log(`Onboarding failed: ${error.message}`);
  } finally {
    el.btnOnboard.disabled = false;
  }
});

el.btnToggle.addEventListener('click', async () => {
  if (state.online) return goOffline();
  el.btnToggle.disabled = true;
  try { await goOnline(); } catch (error) { log(`Could not go online: ${error.message}`); } finally { el.btnToggle.disabled = false; }
});

// Dispatch remains session-authenticated. Never reconnect to this stream using
// only an address: the backend requires this proof-of-control token.
async function ensureSession() {
  if (state.sessionToken && Date.now() < state.sessionExpiresAt - 60_000) return state.sessionToken;
  const challenge = await fetch(`${BACKEND_URL}/workers/${state.address}/session/challenge`, { method: 'POST' });
  if (!challenge.ok) throw new Error('failed to get session challenge');
  const { xdr } = await challenge.json();
  const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, { address: state.address, networkPassphrase: WalletNetwork.TESTNET });
  const session = await fetch(`${BACKEND_URL}/workers/${state.address}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  if (!session.ok) throw new Error('failed to establish session');
  const { token, expiresAt } = await session.json();
  state.sessionToken = token;
  state.sessionExpiresAt = expiresAt;
  return token;
}

async function goOnline() {
  const token = await ensureSession();
  const categories = selectedCategories();
  const query = new URLSearchParams({ worker: state.address, token });
  if (categories.length) query.set('categories', categories.join(','));
  const source = new EventSource(`${BACKEND_URL}/app/events?${query.toString()}`);
  state.eventSource = source;
  source.addEventListener('connected', () => {
    state.online = true;
    el.workerStatus.textContent = categories.length ? `online — ${categories.join(', ')}` : 'online — all topics';
    el.btnToggle.textContent = 'Go offline';
  });
  source.addEventListener('question', (event) => onQuestionReceived(JSON.parse(event.data)));
  source.onerror = () => goOffline();
}

function goOffline() {
  state.eventSource?.close();
  state.eventSource = null;
  state.online = false;
  el.workerStatus.textContent = 'offline';
  el.btnToggle.textContent = 'Go online';
  el.question.classList.add('hidden');
  stopCountdown();
}

function draftKey(questionId) { return `${ANSWER_DRAFT_PREFIX}${questionId}`; }
function readDraft(questionId) { try { return localStorage.getItem(draftKey(questionId)) || ''; } catch { return ''; } }
function saveDraft(questionId, value) { try { value ? localStorage.setItem(draftKey(questionId), value) : localStorage.removeItem(draftKey(questionId)); } catch { /* best-effort */ } }
function clearDraft(questionId) {
  try { localStorage.removeItem(draftKey(questionId)); } catch { /* best-effort */ }
  if (state.lastDraft?.questionId === questionId) state.lastDraft = null;
  updateRestoreControl();
}
function updateAnswerCount() {
  const length = el.answerInput.value.length;
  el.answerCount.textContent = `${length} / ${MAX_ANSWER_LENGTH}`;
  el.answerCount.classList.toggle('answer-count-limit', length >= MAX_ANSWER_LENGTH * 0.9);
}
function updateRestoreControl() {
  const available = state.currentQuestion && state.lastDraft?.questionId === state.currentQuestion.questionId && !el.answerInput.value;
  el.btnRestoreDraft.classList.toggle('hidden', !available);
}

el.answerInput.addEventListener('input', () => {
  const questionId = state.currentQuestion?.questionId;
  if (questionId) {
    saveDraft(questionId, el.answerInput.value);
    state.lastDraft = el.answerInput.value ? { questionId, value: el.answerInput.value } : null;
  }
  updateAnswerCount();
  updateRestoreControl();
});
el.btnRestoreDraft.addEventListener('click', () => {
  if (state.lastDraft?.questionId !== state.currentQuestion?.questionId) return;
  el.answerInput.value = state.lastDraft.value;
  saveDraft(state.currentQuestion.questionId, el.answerInput.value);
  updateAnswerCount(); updateRestoreControl(); el.answerInput.focus();
});

function onQuestionReceived({ questionId, question, expiresInMs }) {
  const previous = state.currentQuestion;
  if (previous && previous.questionId !== questionId && el.answerInput.value) {
    state.lastDraft = { questionId: previous.questionId, value: el.answerInput.value };
    saveDraft(previous.questionId, el.answerInput.value);
  }
  state.currentQuestion = { questionId, deadlineAt: Date.now() + expiresInMs };
  renderFencedCode(el.questionText, question);
  const saved = readDraft(questionId);
  el.answerInput.value = saved;
  state.lastDraft = saved ? { questionId, value: saved } : null;
  el.answerInput.disabled = false;
  el.btnAnswer.disabled = false;
  el.question.classList.remove('hidden');
  updateAnswerCount(); updateRestoreControl(); startCountdown(expiresInMs);
}

function startCountdown(totalMs) {
  stopCountdown();
  const start = Date.now();
  state.countdownHandle = setInterval(() => {
    const remaining = Math.max(0, 1 - (Date.now() - start) / totalMs);
    el.timerBar.style.width = `${remaining * 100}%`;
    if (remaining <= 0) {
      stopCountdown({ expired: true });
      el.answerInput.disabled = true;
      el.btnAnswer.disabled = true;
      log('Question window expired');
    }
  }, 100);
}
function stopCountdown({ expired = false } = {}) {
  if (state.countdownHandle) clearInterval(state.countdownHandle);
  state.countdownHandle = null;
  if (expired && state.currentQuestion) clearDraft(state.currentQuestion.questionId);
}

el.answerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = state.currentQuestion;
  const answer = el.answerInput.value.trim();
  if (!question || !answer) return;
  el.btnAnswer.disabled = true; el.answerInput.disabled = true;
  try {
    const response = await fetch(`${BACKEND_URL}/app/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: question.questionId, workerId: state.address, answer, token: state.sessionToken }),
    });
    if (!response.ok) throw new Error(`answer rejected (${response.status})`);
    clearDraft(question.questionId);
    el.answerInput.value = ''; updateAnswerCount(); log('Answer submitted.');
  } catch (error) {
    log(`Answer submission failed: ${error.message}`);
    el.btnAnswer.disabled = false; el.answerInput.disabled = false;
  }
});
