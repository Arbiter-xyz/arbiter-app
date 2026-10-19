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
  modules: [new FreighterModule(), new LobstrModule(), new xBullModule(), new HanaModule(), new AlbedoModule(), new HotWalletModule(), new LedgerModule()],
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
  alertSound: document.getElementById('alert-sound'),
  alertVolume: document.getElementById('alert-volume'),
  alertVibrate: document.getElementById('alert-vibrate'),
  btnAlertTest: document.getElementById('btn-alert-test'),
  dndEnabled: document.getElementById('dnd-enabled'),
  dndStart: document.getElementById('dnd-start'),
  dndEnd: document.getElementById('dnd-end'),
  btnDndSave: document.getElementById('btn-dnd-save'),
  dndStatus: document.getElementById('dnd-status'),
  activityGrid: document.getElementById('activity-grid'),
  activityStatus: document.getElementById('activity-status'),
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
  pushSubscription: null,
};

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
      startCategoryDemandPolling();
    }
  } catch (err) {
    log(`Trustline check failed (${err.message}) — assuming onboarding is needed`);
    showPanel('onboard');
  }
}

// --- Sponsored onboarding (zero XLM required) ------------------------------

el.btnOnboard.addEventListener('click', async () => {
  el.btnOnboard.disabled = true;
  try {
    log('Building sponsored onboarding transaction…');
    const buildRes = await fetch(`${BACKEND_URL}/sponsor/onboard/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: state.address }),
    });
    if (!buildRes.ok) throw new Error((await buildRes.json()).error || `build failed: ${buildRes.status}`);
    const { xdr } = await buildRes.json();

    log('Signing onboarding transaction with your wallet…');
    const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, {
      address: state.address,
      networkPassphrase: WalletNetwork.TESTNET,
    });

    log('Submitting sponsored onboarding transaction…');
    const submitRes = await fetch(`${BACKEND_URL}/sponsor/onboard/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xdr: signedTxXdr }),
    });
    if (!submitRes.ok) throw new Error((await submitRes.json()).error || `submit failed: ${submitRes.status}`);
    const { hash } = await submitRes.json();

    log(`Onboarded — account created and USDC trustline opened (tx ${hash}), zero XLM spent by you.`);
    showPanel('online');
    refreshEarnings();
  } catch (err) {
    log(`Onboarding failed: ${err.message}`);
  } finally {
    el.btnOnboard.disabled = false;
  }
});

// --- Go online / offline ----------------------------------------------------

el.btnToggle.addEventListener('click', async () => {
  if (state.online) {
    goOffline();
    return;
  }
  el.btnToggle.disabled = true;
  try {
    await goOnline();
  } catch (err) {
    log(`Could not go online: ${err.message}`);
  } finally {
    el.btnToggle.disabled = false;
  }
});

/** Proves control of this address once (a single signTransaction prompt,
 * same primitive already used for onboarding/staking — never signMessage,
 * whose conventions vary across wallets), then reuses the resulting bearer
 * session for both the SSE connection and every answer submission until it
 * expires. This exists because the backend now REQUIRES it for any
 * real-address workerId — see workerAuth.js. */
async function ensureSession() {
  if (state.sessionToken && Date.now() < state.sessionExpiresAt - 60_000) return state.sessionToken;

  log('Proving control of your address (one signature)…');
  const challengeRes = await fetch(`${BACKEND_URL}/workers/${state.address}/session/challenge`, { method: 'POST' });
  if (!challengeRes.ok) throw new Error((await challengeRes.json()).error || 'failed to get session challenge');
  const { xdr } = await challengeRes.json();

  const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, {
    address: state.address,
    networkPassphrase: WalletNetwork.TESTNET,
  });

  const sessionRes = await fetch(`${BACKEND_URL}/workers/${state.address}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  if (!sessionRes.ok) throw new Error((await sessionRes.json()).error || 'failed to establish session');
  const { token, expiresAt } = await sessionRes.json();
  state.sessionToken = token;
  state.sessionExpiresAt = expiresAt;
  log('Session established — you can answer questions as yourself, and only yourself.');
  return token;
}

async function goOnline() {
  const token = await ensureSession();
  const categories = selectedCategories();
  const qs = new URLSearchParams({ worker: state.address, token });
  if (categories.length) qs.set('categories', categories.join(','));

  const es = new EventSource(`${BACKEND_URL}/app/events?${qs.toString()}`);
  state.eventSource = es;

  es.addEventListener('connected', () => {
    state.online = true;
    el.workerStatus.textContent = categories.length ? `online — ${categories.join(', ')}` : 'online — all topics';
    el.btnToggle.textContent = 'Go offline';
    log(`Connected to dispatch channel${categories.length ? ` for [${categories.join(', ')}]` : ''}`);
  });

  es.addEventListener('question', (evt) => {
    const data = JSON.parse(evt.data);
    onQuestionReceived(data);
  });

  es.onerror = () => {
    log('Dispatch channel error/disconnected');
    goOffline();
  };
}

function goOffline() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.online = false;
  el.workerStatus.textContent = 'offline';
  el.btnToggle.textContent = 'Go online';
  el.question.classList.add('hidden');
  stopCountdown();
  log('Disconnected from dispatch channel');
}

// --- Question / answer flow --------------------------------------------------

function onQuestionReceived({ questionId, question, expiresInMs }) {
  state.currentQuestion = { questionId, deadlineAt: Date.now() + expiresInMs };
  el.questionText.textContent = question;
  el.answerInput.value = '';
  el.answerInput.disabled = false;
  el.btnAnswer.disabled = false;
  el.question.classList.remove('hidden');
  log(`New question dispatched: "${question}"`);
  startCountdown(expiresInMs);
  alertNewQuestion({ questionId, question });
}

function startCountdown(totalMs) {
  stopCountdown();
  const start = Date.now();
  state.countdownHandle = setInterval(() => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, 1 - elapsed / totalMs);
    el.timerBar.style.width = `${remaining * 100}%`;
    if (remaining <= 0) {
      stopCountdown();
      el.answerInput.disabled = true;
      el.btnAnswer.disabled = true;
      log('Question window expired');
    }
  }, 100);
}

function stopCountdown() {
  if (state.countdownHandle) {
    clearInterval(state.countdownHandle);
    state.countdownHandle = null;
  }
}

el.answerForm.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const q = state.currentQuestion;
  const answer = el.answerInput.value.trim();
  if (!q || !answer) return;

  el.btnAnswer.disabled = true;
  el.answerInput.disabled = true;
  try {
    const res = await fetch(`${BACKEND_URL}/app/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.questionId, workerId: state.address, answer, token: state.sessionToken }),
    });
    if (res.status === 401) {
      log('Session expired or invalid — go offline and back online to re-authenticate.');
    } else if (res.status === 409) {
      log('Answer rejected — question already closed, expired, or already answered');
    } else if (!res.ok) {
      throw new Error(`unexpected status ${res.status}`);
    } else {
      log(`Answer submitted: "${answer}"`);
    }
  } catch (err) {
    log(`Answer submission failed: ${err.message}`);
    el.btnAnswer.disabled = false;
    el.answerInput.disabled = false;
  }
});

// --- Earnings & staking -------------------------------------------------
// Matching answers are CREDITED on-chain (accrued-balance settlement), not
// paid out per-question — withdraw() collects everything in one shot at
// the worker's own discretion. Staking is an optional credibility bond
// (losing answers forfeit a slice of it); never required to participate.

async function refreshEarnings() {
  if (!state.address) return;
  try {
    const [owedRes, stakeRes, repRes] = await Promise.all([
      fetch(`${BACKEND_URL}/workers/${state.address}/owed`),
      fetch(`${BACKEND_URL}/workers/${state.address}/stake`),
      fetch(`${BACKEND_URL}/workers/${state.address}/reputation`),
    ]);
    if (owedRes.ok) el.owedAmount.textContent = `${(await owedRes.json()).owed} USDC`;
    if (stakeRes.ok) el.stakeAmount.textContent = `${(await stakeRes.json()).stake} USDC`;
    if (repRes.ok) renderTrackRecord(await repRes.json());
    refreshActivityHeatmap();
  } catch (err) {
    log(`Could not refresh earnings/stake: ${err.message}`);
  }
}

function renderTrackRecord({ matched, total, matchRatio }) {
  if (total === 0) {
    el.trackRecordSummary.textContent = 'No answers yet — this fills in once you start answering.';
    return;
  }
  const pct = Math.round(matchRatio * 100);
  el.trackRecordSummary.textContent = `${matched}/${total} answers matched consensus (${pct}%)`;
}

el.btnWithdraw.addEventListener('click', async () => {
  el.btnWithdraw.disabled = true;
  try {
    // Optional — leave blank to withdraw to your own address (the common
    // case). Fill it in to route the payout elsewhere (an exchange deposit
    // address, a cold wallet) without ever holding the funds at the signing
    // key first.
    const beneficiary = el.withdrawBeneficiaryInput.value.trim();
    if (beneficiary && !StrKey.isValidEd25519PublicKey(beneficiary)) {
      throw new Error('payout address is not a valid Stellar public key');
    }

    const owedRes = await fetch(`${BACKEND_URL}/workers/${state.address}/owed`);
    if (!owedRes.ok) throw new Error(`could not look up accrued balance: ${owedRes.status}`);
    const { owedStroops } = await owedRes.json();
    if (BigInt(owedStroops) <= 0n) throw new Error('nothing accrued to withdraw yet');

    log('Building withdraw transaction…');
    const xdr = beneficiary
      ? await buildWithdrawToXdr(state.address, beneficiary, owedStroops)
      : await buildWithdrawXdr(state.address, owedStroops);
    const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, {
      address: state.address,
      networkPassphrase: WalletNetwork.TESTNET,
    });
    const res = await fetch(`${BACKEND_URL}/sponsor/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        xdr: signedTxXdr,
        workerAddress: state.address,
        amountStroops: owedStroops,
        ...(beneficiary ? { beneficiaryAddress: beneficiary } : {}),
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `withdraw failed: ${res.status}`);
    const { hash } = await res.json();
    log(beneficiary ? `Withdrew accrued earnings to ${beneficiary} (tx ${hash})` : `Withdrew accrued earnings (tx ${hash})`);
    await refreshEarnings();
  } catch (err) {
    log(`Withdraw failed: ${err.message}`);
  } finally {
    el.btnWithdraw.disabled = false;
  }
});

initBankWithdraw({
  button: el.btnWithdrawBank,
  status: el.bankWithdrawStatus,
  getAddress: () => state.address,
  getWallet: () => state.activeWallet,
  getArbiterSessionToken: ensureSession,
  networkPassphrase: WalletNetwork.TESTNET,
  assetCode: USDC_ASSET_CODE,
});

el.stakeForm.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  el.btnStake.disabled = true;
  try {
    const amountStroops = stroopsFromUsdcInput(el.stakeInput.value);
    log(`Building stake transaction for ${el.stakeInput.value} USDC…`);
    const xdr = await buildStakeXdr(state.address, amountStroops);
    const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, {
      address: state.address,
      networkPassphrase: WalletNetwork.TESTNET,
    });
    const res = await fetch(`${BACKEND_URL}/sponsor/stake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xdr: signedTxXdr, workerAddress: state.address, amountStroops: amountStroops.toString() }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `stake failed: ${res.status}`);
    const { hash } = await res.json();
    log(`Staked (tx ${hash})`);
    el.stakeInput.value = '';
    await refreshEarnings();
  } catch (err) {
    log(`Stake failed: ${err.message}`);
  } finally {
    el.btnStake.disabled = false;
  }
});

// --- Push notifications ---------------------------------------------------
// Supplements the SSE tab connection for workers who want to be notified of
// longer-timeout questions without babysitting the page. Never required —
// the console works identically without it, just tab-open-only.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    log(`Service worker registration failed (push notifications unavailable): ${err.message}`);
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

if (el.btnEnablePush) {
  el.btnEnablePush.addEventListener('click', async () => {
    if (!state.address) return;
    el.btnEnablePush.disabled = true;
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('push notifications are not supported in this browser');
      }

      const keyRes = await fetch(`${BACKEND_URL}/push/vapid-public-key`);
      if (!keyRes.ok) throw new Error('this server has not configured push notifications');
      const { publicKey } = await keyRes.json();

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('notification permission was not granted');

      // Backend now requires proof of address control here too, same as
      // answering a question — a subscription silently redirects this
      // worker's notifications, so it can't be left open to anyone who
      // just knows the address.
      const token = await ensureSession();

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch(`${BACKEND_URL}/workers/${state.address}/push-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), categories: selectedCategories(), dnd: dndPayload(), token }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `subscribe failed: ${res.status}`);

      state.pushSubscription = subscription;
      el.pushStatus.textContent = 'On — you may get notified for longer-timeout questions.';
      log('Push notifications enabled.');
    } catch (err) {
      log(`Could not enable push notifications: ${err.message}`);
      el.pushStatus.textContent = `Off — ${err.message}`;
    } finally {
      el.btnEnablePush.disabled = false;
    }
  });
}

// --- New-question alerts: sound / vibration (issue #64) -----------------
// Opt-in only: the default is silent so nobody answering back-to-back
// express-tier questions gets an unexpected beep. Persisted with the same
// localStorage pattern localWallet.js uses, under its own key.

const ALERT_PREFS_KEY = 'arbiter.alertPrefs';
const VIBRATION_PATTERNS = { short: [150], long: [300, 100, 300] };
const SOUND_TONES = { beep: [880], chime: [660, 990] };
let audioCtx = null;

function loadJson(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') };
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked (private mode etc.) — preference just won't persist
  }
}

const alertPrefs = loadJson(ALERT_PREFS_KEY, { sound: 'off', volume: 0.5, vibrate: 'off' });
el.alertSound.value = alertPrefs.sound;
el.alertVolume.value = String(alertPrefs.volume);
el.alertVibrate.value = alertPrefs.vibrate;

for (const input of [el.alertSound, el.alertVolume, el.alertVibrate]) {
  input.addEventListener('change', () => {
    alertPrefs.sound = el.alertSound.value;
    alertPrefs.volume = Number(el.alertVolume.value);
    alertPrefs.vibrate = el.alertVibrate.value;
    saveJson(ALERT_PREFS_KEY, alertPrefs);
  });
}

function playAlertSound() {
  const tones = SOUND_TONES[alertPrefs.sound];
  if (!tones) return;
  try {
    audioCtx ||= new AudioContext();
    let t = audioCtx.currentTime;
    for (const freq of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(alertPrefs.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
      t += 0.22;
    }
  } catch {
    // autoplay blocked or Web Audio unsupported — silently skip
  }
}

function vibrateAlert() {
  const pattern = VIBRATION_PATTERNS[alertPrefs.vibrate];
  if (pattern && 'vibrate' in navigator) navigator.vibrate(pattern);
}

el.btnAlertTest.addEventListener('click', () => {
  playAlertSound();
  vibrateAlert();
});

// --- Desktop notifications for a backgrounded tab (issue #65) ---------------
// Reuses whatever permission the push flow already obtained — never asks on
// its own. Uses the same `question-<id>` tag sw.js gives push notifications,
// so if both fire for one question the browser replaces rather than stacks.

function showDesktopNotification({ questionId, question }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    const n = new Notification('Arbiter — new question', { body: question, tag: `question-${questionId}` });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // some mobile browsers only allow notifications via the service worker
  }
}

function alertNewQuestion(q) {
  if (inDndWindow()) return;
  playAlertSound();
  vibrateAlert();
  showDesktopNotification(q);
}

// --- Do-not-disturb hours (issue #66) ----------------------------------------
// Entered in local time, sent to the backend as UTC "HH:MM" because it has
// no notion of a worker's timezone. The same window also silences the
// in-tab alerts above. Saving re-sends the existing push subscription so
// the window stays editable after the initial subscribe.

const DND_PREFS_KEY = 'arbiter.dndPrefs';
const dndPrefs = loadJson(DND_PREFS_KEY, { enabled: false, start: '00:00', end: '07:00' });
el.dndEnabled.checked = dndPrefs.enabled;
el.dndStart.value = dndPrefs.start;
el.dndEnd.value = dndPrefs.end;

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function localToUtc(hhmm) {
  const mins = (((minutesOf(hhmm) + new Date().getTimezoneOffset()) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function dndPayload() {
  if (!dndPrefs.enabled) return null;
  return { startUtc: localToUtc(dndPrefs.start), endUtc: localToUtc(dndPrefs.end) };
}

function inDndWindow() {
  if (!dndPrefs.enabled) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = minutesOf(dndPrefs.start);
  const end = minutesOf(dndPrefs.end);
  // A window like 22:00 → 07:00 wraps past midnight.
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

el.btnDndSave.addEventListener('click', async () => {
  dndPrefs.enabled = el.dndEnabled.checked;
  dndPrefs.start = el.dndStart.value || '00:00';
  dndPrefs.end = el.dndEnd.value || '07:00';
  saveJson(DND_PREFS_KEY, dndPrefs);
  el.dndStatus.textContent = 'Saved in this browser.';

  if (!state.pushSubscription || !state.address) return;
  el.btnDndSave.disabled = true;
  try {
    const token = await ensureSession();
    const res = await fetch(`${BACKEND_URL}/workers/${state.address}/push-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: state.pushSubscription.toJSON(), categories: selectedCategories(), dnd: dndPayload(), token }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `update failed: ${res.status}`);
    el.dndStatus.textContent = 'Saved — push notifications respect this window.';
  } catch (err) {
    el.dndStatus.textContent = `Saved locally, but the push subscription was not updated: ${err.message}`;
  } finally {
    el.btnDndSave.disabled = false;
  }
});

// --- Earnings activity heatmap (issue #67) -----------------------------------
// GitHub-contributions style: one cell per day, columns are weeks. Needs
// GET /workers/:address/activity?days=N returning
// { days: [{ date: 'YYYY-MM-DD', answers, matched }] } from per-answer
// timestamps — cumulative rep: counters can't produce it. Days the backend
// doesn't list are rendered as zero, never interpolated.

const ACTIVITY_WEEKS = 26;

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderActivityHeatmap(days) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const max = Math.max(1, ...days.map((d) => d.answers || 0));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() - (ACTIVITY_WEEKS - 1) * 7); // align to a Sunday

  const cells = [];
  const today = new Date();
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = isoDate(d);
    const entry = byDate.get(key);
    const answers = entry ? entry.answers || 0 : 0;
    const cell = document.createElement('div');
    cell.className = 'activity-cell';
    cell.dataset.level = answers === 0 ? '0' : String(Math.min(4, Math.ceil((answers / max) * 4)));
    cell.title = `${key}: ${answers} answer${answers === 1 ? '' : 's'}${entry ? `, ${entry.matched || 0} matched` : ''}`;
    cells.push(cell);
  }
  el.activityGrid.replaceChildren(...cells);
  const total = days.reduce((sum, d) => sum + (d.answers || 0), 0);
  el.activityStatus.textContent = `${total} answer${total === 1 ? '' : 's'} in the last ${ACTIVITY_WEEKS} weeks`;
}

async function refreshActivityHeatmap() {
  try {
    const res = await fetch(`${BACKEND_URL}/workers/${state.address}/activity?days=${ACTIVITY_WEEKS * 7}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { days } = await res.json();
    renderActivityHeatmap(Array.isArray(days) ? days : []);
  } catch {
    el.activityGrid.replaceChildren();
    el.activityStatus.textContent = 'Activity history is not available from this server yet.';
  }
}
