import {
  StellarWalletsKit,
  WalletNetwork,
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
//
// Each adapter is loaded via a per-wallet dynamic import() so that selecting
// one wallet only pulls in that wallet's SDK — the other adapters' (and their
// transitive dependency trees') chunks are never fetched. This is what keeps
// the wallet-kit bundle from collapsing into a single ~735KB chunk.
const WALLET_MODULES = {
  freighter: () => import('@creit.tech/stellar-wallets-kit/modules/freighter').then((m) => new m.FreighterModule()),
  lobstr: () => import('@creit.tech/stellar-wallets-kit/modules/lobstr').then((m) => new m.LobstrModule()),
  xbull: () => import('@creit.tech/stellar-wallets-kit/modules/xbull').then((m) => new m.xBullModule()),
  hana: () => import('@creit.tech/stellar-wallets-kit/modules/hana').then((m) => new m.HanaModule()),
  albedo: () => import('@creit.tech/stellar-wallets-kit/modules/albedo').then((m) => new m.AlbedoModule()),
  hotwallet: () => import('@creit.tech/stellar-wallets-kit/modules/hotwallet').then((m) => new m.HotWalletModule()),
};

// The kit is constructed lazily, once, with only the adapters the user has
// actually selected. Until then no adapter SDK is loaded at all.
let kit = null;
let kitModules = null;

async function getKit(selectedIds) {
  const ids = selectedIds && selectedIds.length ? selectedIds : Object.keys(WALLET_MODULES);
  const modules = await Promise.all(ids.map((id) => WALLET_MODULES[id]()));
  // Rebuild the kit whenever the active adapter set changes so we never keep
  // a stale module list around.
  const signature = ids.join(',');
  if (!kit || kitModules !== signature) {
    kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      modules,
    });
    kitModules = signature;
  }
  return kit;
}

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
    if (r