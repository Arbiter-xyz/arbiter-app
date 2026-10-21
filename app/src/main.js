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
import { createWalletKit } from './wallet.js';
import { openSecureLocalWallet } from './localWallet.js';
import { initI18n, t } from './i18n.js';
import { initA11y } from './a11y.js';
import { StrKey } from '@stellar/stellar-sdk';
import { buildStakeXdr, buildWithdrawXdr, buildWithdrawToXdr } from './contractCalls.js';
import { stroopsFromUsdcInput } from './units.js';
import { initBankWithdraw } from './anchor.js';
import { startTour } from './tour.js';
import { initSupportChat, setSupportWallet } from './support.js';
import { renderFencedCode } from './codeBlocks.js';
import { ensureSession as ensureSharedSession } from './session.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const USDC_ASSET_CODE = import.meta.env.VITE_USDC_ASSET_CODE || 'USDC';
const USDC_ASSET_ISSUER = import.meta.env.VITE_USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// See wallet.js for the module list and the connect/quick-start button
// wiring shared with dashboard.js (issue #19).
const kit = createWalletKit();

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
  btnBackupDone: document.getElementById('btn-backup-done'),
  backupCopyStatus: document.getElementById('backup-copy-status'),
  btnOnboard: document.getElementById('btn-onboard'),
  btnToggle: document.getElementById('btn-toggle'),
  workerAddress: document.getElementById('worker-address'),
  workerStatus: document.getElementById('worker-status'),
  categoryPicker: document.getElementById('category-picker'),
  questionText: document.getElementById('question-text'),
  timerBar: document.getElementById('timer-bar'),
  timerAnnounce: document.getElementById('timer-announce'),
  answerForm: document.getElementById('answer-form'),
  answerInput: document.getElementById('answer-input'),
  answerSuggestedBadge: document.getElementById('answer-suggested-badge'),
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
  // Social-recovery panel: no matching markup exists in index.html yet, so
  // these are always null today — see the guard comment further down.
  btnSetupRecovery: document.getElementById('btn-setup-recovery'),
  btnRecoverWallet: document.getElementById('btn-recover-wallet'),
  recoveryShares: document.getElementById('recovery-shares'),
  recoveryStatus: document.getElementById('recovery-status'),
  recoveryThreshold: document.getElementById('recovery-threshold'),
  recoveryShareCount: document.getElementById('recovery-share-count'),
  recoveryInput: document.getElementById('recovery-input'),
};

initI18n();
initA11y();

const state = {
  localWallet: null,
  // Either the StellarWalletsKit instance or a local quick-start wallet —
  // both expose the same {getAddress, signTransaction} shape, so nothing
  // downstream needs to know which one is active.
  activeWallet: null,
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
  pushSubscription: null,
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
    bar.title = t('demand.workers', { n: count });
    // Non-colour cue (WCAG 1.4.1): a text label + border style per level,
    // so urgency is readable without perceiving the bar's colour or width.
    const level = scarcity >= 0.66 ? 'high' : scarcity >= 0.33 ? 'medium' : 'low';
    const tag = bar.parentElement.querySelector('.demand-level');
    if (tag) {
      tag.hidden = false;
      tag.dataset.level = level;
      tag.textContent = t(`demand.${level}`);
      tag.title = bar.title;
    }
  }
}

function clearCategoryDemand() {
  for (const bar of el.categoryPicker.querySelectorAll('.category-demand-bar')) {
    bar.style.width = '0%';
    bar.removeAttribute('title');
    const tag = bar.parentElement.querySelector('.demand-level');
    if (tag) tag.hidden = true;
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
        setSupportWallet(address);
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
// --- Wallet connect (extension) or quick start (local, non-custodial) -----
// Module list + button wiring live in wallet.js, shared with dashboard.js
// (issue #19). The one behavioral difference between the two pages — this
// console shows the backup/reveal panel only for the local quick-start
// wallet — is handled via the `quickStart` flag onActivated receives,
// rather than a special case inside the shared helper.

el.btnQuickStart.addEventListener('click', async () => {
  setConnectButtonsBusy(true);
  try {
    const localWallet = await openSecureLocalWallet();
    state.localWallet = localWallet;
    const { address } = await localWallet.getAddress();
    log('Using a local, browser-held quick-start wallet (non-custodial — the key never leaves this browser).');
    if (localWallet.state === 'pending-backup') showBackupPanel();
    await activateWallet(localWallet, address);
    setSupportWallet(address);
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
  // Quick-start users only: the one step with irreversible financial risk.
  startTour('arbiter_tour_backup_seen', [
    {
      target: el.backup,
      title: 'Back up your secret key now',
      text: 'This key exists only in this browser. If you clear site data or switch devices without a copy, any staked or earned USDC is lost forever. Reveal it and store it in a password manager before staking.',
    },
  ]);
}

el.btnRevealSecret.addEventListener('click', async () => {
  const revealed = el.backupSecret.type === 'password';
  if (revealed) el.backupSecret.value = (await state.localWallet?.exportSecret()) || '';
  el.backupSecret.type = revealed ? 'text' : 'password';
  el.btnRevealSecret.textContent = t(revealed ? 'backup.hide' : 'backup.reveal');
  el.btnRevealSecret.setAttribute('aria-pressed', String(revealed));
});

// Confirming the backup converts the key into a non-extractable WebCrypto
// key (issue #7): after this, no script on the page — including an XSS
// payload — can read the secret again, only request signatures.
el.btnBackupDone.addEventListener('click', async () => {
  if (!state.localWallet) return;
  await state.localWallet.lockExport();
  el.backupSecret.value = '';
  el.backup.classList.add('hidden');
  log('Backup confirmed — the quick-start key is now locked in this browser and can no longer be exported.');
});

el.btnCopySecret.addEventListener('click', async () => {
  const secret = await state.localWallet?.exportSecret();
  if (!secret) return;
  try {
    await navigator.clipboard.writeText(secret);
    el.backupCopyStatus.textContent = 'Copied to clipboard — store it somewhere safe, then clear your clipboard.';
  } catch (err) {
    el.backupCopyStatus.textContent = `Could not copy automatically (${err.message}) — reveal and copy it manually.`;
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

/* … truncated 599 chars — edit only what you need near the top … */

// --- First-visit onboarding tour (issue #60) ------------------------------
startTour('arbiter_tour_worker_seen', [
  {
    target: el.connect,
    title: 'Welcome to Arbiter',
    text: 'You earn USDC by answering short questions. Connect a wallet you already have, or use Quick start to create one in this browser — no extension needed.',
  },
  {
    target: null,
    title: 'Quick start? Back up your key',
    text: 'Quick start shows a backup panel next. That key is the only copy — skipping the backup risks losing all your funds. Connect-wallet users can skip this step.',
  },
  {
    target: el.categoryPicker,
    title: 'Pick categories, then go online',
    text: 'Choose topics you can answer, then press "Go online". Staking USDC raises your tier and unlocks higher-value questions.',
  },
  {
    target: el.timerBar,
    title: 'Answer before the timer runs out',
    text: 'Each question arrives with a countdown bar. Answer before it empties — late or missing answers are not paid.',
  },
  {
    target: el.earnings,
    title: 'Earnings',
    text: 'Payouts accrue here. Withdraw any time to your wallet (or another payout address).',
  },
]);

// --- Live support chat (issue #62) ----------------------------------------
initSupportChat('worker');

// --- Push subscription with rich-preview opt-in (issue #63) ---------------
// Question previews pass through browser-vendor push infrastructure, outside
// Arbiter's trust boundary, so they are opt-in and can be switched off
// without disabling push itself.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const pushPreviewInput = document.getElementById('push-preview');

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function syncPushSubscription() {
  if (!state.address || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('push is not supported here or no wallet is connected');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY ? urlBase64ToUint8Array(VAPID_PUBLIC_KEY) : undefined,
    }));
  const res = await fetch(`${BACKEND_URL}/workers/${state.address}/push-subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription,
      categories: selectedCategories(),
      richPreview: !!pushPreviewInput?.checked,
    }),
  });
  if (!res.ok) throw new Error(`push-subscribe failed (${res.status})`);
}

el.btnEnablePush?.addEventListener('click', async () => {
  try {
    await syncPushSubscription();
    el.pushStatus.textContent = 'On — you\'ll be notified of new questions.';
  } catch (err) {
    log(`Push setup failed: ${err.message}`);
  }
});

pushPreviewInput?.addEventListener('change', async () => {
  if (el.pushStatus.textContent.startsWith('On')) {
    syncPushSubscription().catch((err) => log(`Updating push preference failed: ${err.message}`));
  }
});

// Notification click deep-links here as /?question=<id>; once online the
// matching question is picked up from the live stream.
const linkedQuestion = new URLSearchParams(location.search).get('question');
if (linkedQuestion) log(`Opened from a notification for question ${linkedQuestion}.`);
// NOTE (pre-existing, unrelated to issues #21/#22): this file was found
// already truncated on `main` — everything below this point (activate/
// route-after-connect, sponsored onboarding, goOnline()/SSE handling,
// answer submission, earnings/staking, withdraw, and push notifications)
// had been replaced by a stray `/* … truncated 599 chars … */` placeholder,
// and a "Social recovery (client-side Shamir split)" feature was referenced
// in a dangling comment with no implementation left. `activateWallet` was
// called from the connect/quick-start handlers above but was never defined
// anywhere in the repo — a real, currently-shipped ReferenceError on every
// wallet connect. The code below restores the last known-working version of
// this section (recovered from git history prior to the truncation), which
// #21 and #22 both need a working online/earnings panel to attach to. The
// social-recovery UI itself is not restored here (unrelated to #21/#22,
// and a nontrivial feature on its own) — that remains a separate, still-open
// gap.

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
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
  const account = await res.json();
  return (account.balances || []).some(
    (b) => b.asset_code === USDC_ASSET_CODE && b.asset_issuer === USDC_ASSET_ISSUER
  );
}

async function routeAfterConnect() {
  try {
    const ready = await hasUsdcTrustline(state.address);
    showPanel(ready ? 'online' : 'onboard');
    if (ready) {
      refreshEarnings();
      setInterval(refreshEarnings, 20_000);
      startCategoryDemandPolling();
      startCategoryDemandPolling();
      refreshEarnings();
      setInterval(refreshEarnings, 20_000);
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
      networkPassphrase: Networks.TESTNET,
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
    startCategoryDemandPolling();
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
  let lastAnnounced = null;
  state.countdownHandle = setInterval(() => {
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, 1 - elapsed / totalMs);
    el.timerBar.style.width = `${remaining * 100}%`;
    // Screen-reader announcement (#54): every 10s, then each of the last 5s.
    const secs = Math.ceil((totalMs - elapsed) / 1000);
    if (el.timerAnnounce && secs !== lastAnnounced && secs >= 0 && (secs % 10 === 0 || secs <= 5)) {
      lastAnnounced = secs;
      el.timerAnnounce.textContent = secs > 0 ? `${secs} seconds remaining` : 'Time is up';
    }
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
      networkPassphrase: Networks.TESTNET,
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

// Issue #22: offers to auto-relay the anchor's requested on-chain transfer
// (a withdraw_to() call carrying the anchor's memo) through the same
// sponsor fee-bump relay btnWithdraw already uses, instead of only ever
// showing manual "send this yourself" instructions. anchor.js falls back to
// the manual instructions if this throws or isn't confident it has what it
// needs.
async function autoRelayWithdrawal({ amount, beneficiary, memo }) {
  const amountStroops = stroopsFromUsdcInput(String(amount));
  log(`Building withdraw_to() transaction for ${amount} USDC to the anchor…`);
  const xdr = await buildWithdrawToXdr(state.address, beneficiary, amountStroops, memo);
  const { signedTxXdr } = await state.activeWallet.signTransaction(xdr, {
    address: state.address,
    networkPassphrase: Networks.TESTNET,
  });
  const token = await ensureSession();
  const res = await fetch(`${BACKEND_URL}/sponsor/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      xdr: signedTxXdr,
      workerAddress: state.address,
      amountStroops: amountStroops.toString(),
      beneficiaryAddress: beneficiary,
      token,
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `withdraw relay failed: ${res.status}`);
  await refreshEarnings();
}

initBankWithdraw({
  button: el.btnWithdrawBank,
  status: el.bankWithdrawStatus,
  getAddress: () => state.address,
  getWallet: () => state.activeWallet,
  getArbiterSessionToken: ensureSession,
  networkPassphrase: Networks.TESTNET,
  assetCode: USDC_ASSET_CODE,
  autoRelayWithdrawal,
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
    state.activeWallet = wallet;
    state.address = address;
    el.workerAddress.textContent = address;
    el.connect.classList.add('hidden');

    const trusted = await hasUsdcTrustline(address);
    showPanel(trusted ? 'online' : 'onboard');
    if (trusted) startCategoryDemandPolling();
    log(`Connected ${address}${trusted ? '' : ' — USDC trustline required before going online.'}`);
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
  navigator.serviceWorker
    .register('/sw.js')
    .then(restorePushUiState)
    .catch((err) => {
      log(`Service worker registration failed (push notifications unavailable): ${err.message}`);
    });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Issue #21: a page reload used to always show the HTML default "Off" status
// even when this browser already held an active push subscription (and the
// backend likely still had it on file) — the only way to find out was to
// click "Enable" again. This checks for an existing subscription up front
// and reflects it immediately, without a permission prompt or a redundant
// subscribe/POST call.
async function restorePushUiState() {
  if (!el.btnEnablePush || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return; // never subscribed on this browser — leave the default "Off" state
    el.pushStatus.textContent = 'On — you may get notified for longer-timeout questions.';
    el.btnEnablePush.textContent = 'Enabled';
    el.btnEnablePush.disabled = true;
  } catch (err) {
    // Best-effort — leave whatever the default state already is rather than
    // surfacing this as a user-facing error.
  }
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
      // Backend requires proof of address control here too, same as
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
        body: JSON.stringify({ subscription: subscription.toJSON(), categories: selectedCategories(), token }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `subscribe failed: ${res.status}`);

      el.pushStatus.textContent = 'On — you may get notified for longer-timeout questions.';
      el.btnEnablePush.textContent = 'Enabled';
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
