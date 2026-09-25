import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  LobstrModule,
  xBullModule,
  HanaModule,
  AlbedoModule,
  HotWalletModule,
} from '@creit.tech/stellar-wallets-kit';
import { createOrLoadLocalWallet, getLocalWalletSecret } from './localWallet.js';
import { StrKey } from '@stellar/stellar-sdk';
import { buildStakeXdr, buildWithdrawXdr, buildWithdrawToXdr } from './contractCalls.js';
import { stroopsFromUsdcInput } from './units.js';
import { initBankWithdraw } from './anchor.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const USDC_ASSET_CODE = import.meta.env.VITE_USDC_ASSET_CODE || 'USDC';

// Hand-picked, not allowAllModules(): explicit about which wallets we
// support (matching the original spec's list) rather than automatically
// inheriting whatever the kit adds in a future version — including
// hardware-wallet adapters (Trezor/Ledger) that pull in a large, more
// security-sensitive dependency tree we have no use for. See the README
// for the concrete CVE this sidesteps.
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [new FreighterModule(), new LobstrModule(), new xBullModule(), new HanaModule(), new AlbedoModule(), new HotWalletModule()],
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
  btnAnswer: document.getElementById('btn-answer'),
  owedAmount: document.getElementById('owed-amount'),
  stakeAmount: document.getElementById('stake-amount'),
  trackRecordSummary: document.getElementById('track-record-summary'),
  btnEnablePush: document.getElementById('btn-enable-push'),
  pushStatus: document.getElementById('push-status'),
  btnWithdraw: document.getElementById('btn-withdraw'),
  btnWithdrawBank: document.getElementById('btn-withdraw-bank'),
  bankWithdrawStatus: document.getElementById('bank-withdraw-status'),
  withdrawBeneficiaryInput: document.getElementById('withdraw-beneficiary-input'),
  stakeForm: document.getElementById('stake-form'),
  stakeInput: document.getElementById('stake-input'),
  btnStake: document.getElementById('btn-stake'),
  log: document.getElementById('log'),
};

const state = {
  // Either the StellarWalletsKit instance or a local quick-start wallet —
  // both expose the same {getAddress, signTransaction} shape, so nothing
  // downstream needs to know which one is active.
  activeWallet: null,
  address: null,
  online: false,
  eventSource: null,
  currentQuestion: null,
  countdownHandle: null,
  sessionToken: null,
  sessionExpiresAt: 0,
};

// --- Offline-first answer queue (IndexedDB + service worker background sync) --
//
// In-flight answers are persisted locally the moment the worker starts
// composing them, so a connectivity drop mid-quorum never silently loses
// work. The service worker (app/public/sw.js) drains the queue via the
// Background Sync API; this module owns the IndexedDB store and the
// reconciliation rules that make retries safe:
//
//   * exactly-once submission — every queued answer carries a stable
//     client-generated idempotency key, and the backend dedupes on it, so a
//     sync retry can never create a second answer for the same question.
//   * closed-while-offline — before submitting, we re-check the question's
//     status; if it is no longer accepting answers the queued item is
//     discarded (never submitted against a stale/closed question) and the
//     worker is told why.
const ANSWER_DB_NAME = 'quorum-worker';
const ANSWER_DB_VERSION = 1;
const ANSWER_STORE = 'pending-answers';
const SYNC_TAG = 'sync-pending-answers';

function openAnswerDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ANSWER_DB_NAME, ANSWER_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ANSWER_STORE)) {
        db.createObjectStore(ANSWER_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withAnswerStore(mode, fn) {
  const db = await openAnswerDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ANSWER_STORE, mode);
      const store = tx.objectStore(ANSWER_STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function putPendingAnswer(record) {
  return withAnswerStore('readwrite', (store) => store.put(record));
}

function deletePendingAnswer(id) {
  return withAnswerStore('readwrite', (store) => store.delete(id));
}

function listPendingAnswers() {
  return withAnswerStore('readonly', (store) => {
    const req = store.getAll();
    return { __req: req };
  });
}

// Stable per-answer idempotency key: the same composed answer always maps to
// the same key, so a retried sync is a no-op on the backend rather than a
// duplicate submission.
function makeIdempotencyKey(questionId, address) {
  return `${questionId}:${address}:${crypto.randomUUID()}`;
}

async function requestBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.sync) await reg.sync.register(SYNC_TAG);
  } catch (err) {
    log(`Background sync unavailable (${err.message}) — will retry on reconnect.`);
  }
}

// Reconcile a single queued answer against the live question state. Returns
// 'submitted' | 'discarded' | 'retry'.
async function reconcilePendingAnswer(record) {
  let question;
  try {
    const res = await fetch(`${BACKEND_URL}/questions/${record.questionId}`);
    if (!res.ok) return 'retry';
    question = await res.json();
  } catch {
    return 'retry'; // still offline — leave it queued
  }

  // Question closed while we were offline (quorum reached by others, or
  // timeout): discard the stale answer rather than submitting it.
  if (!question || question.status !== 'open') {
    await deletePendingAnswer(record.id);
    log(`Question closed before your answer could be sent — discarded your queued answer for "${record.questionText || record.questionId}".`);
    return 'discarded';
  }

  try {
    const res = await fetch(`${BACKEND_URL}/questions/${record.questionId}/answers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': record.idempotencyKey,
      },
      body: JSON.stringify({ answer: record.answer, address: record.address }),
    });
    // 409 means the backend already recorded this idempotency key — the
    // answer was submitted exactly once, so treat it as success.
    if (res.ok || res.status === 409) {
      await deletePendingAnswer(record.id);
      log(`Queued answer submitted for "${record.questionText || record.questionId}".`);
      return 'submitted';
    }
    return 'retry';
  } catch {
    return 'retry';
  }
}

async function flushPendingAnswers() {
  const pending = (await listPendingAnswers()) || [];
  for (const record of pending) {
    await reconcilePendingAnswer(record);
  }
}

// The service worker asks the page to drain the queue (it can't touch the
// page's IndexedDB handle directly).
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'flush-pending-answers') flushPendingAnswers();
});

window.addEventListener('online', () => {
  state.online = true;
  flushPendingAnswers();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => log(`Service worker registration failed: ${err.message}`));
}

function log(message) {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.textContent = `[${time}] ${message}`;
  el.log.prepend(li);
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
        await activateWallet(kit, address);
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
  if (res.status === 404) return false; // account doesn't exist on-chain at all yet
  if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
  const account = await res.json();
  return (account.balances || []).some((b) => b.asset_code === USDC_ASSET_CODE);
}

async function routeAfterConnect() {
  try {
    const ready = await hasUsdcTrustline(state.address);
    showPanel(ready ? 'online' : 'onboard');
    if (ready) {
      refreshEarnings();
      setInterval(refreshEarnings, 20_000);
    }
  } catch (err) {
    log(`Trustline check failed (${err.message}) — assuming onboarding is needed`);
    showPanel('onboard');
  }
}

// --- Sponsored onboarding (zero XLM required) ----------------------------

/* … truncated 14347 chars — edit only what you need near the top … */
