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
import { initI18n, t } from './i18n.js';
import { initA11y } from './a11y.js';
import { StrKey } from '@stellar/stellar-sdk';
import { buildStakeXdr, buildWithdrawXdr, buildWithdrawToXdr } from './contractCalls.js';
import { stroopsFromUsdcInput } from './units.js';
import { initBankWithdraw } from './anchor.js';
import { renderFencedCode } from './codeBlocks.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const USDC_ASSET_CODE = import.meta.env.VITE_USDC_ASSET_CODE || 'USDC';
// Mirrors the backend's MAX_ANSWER_LENGTH default (backend/src/server.js) —
// caught here so a too-long answer gets a clear message instead of round-
// tripping to the backend only to have the specific reason discarded
// (issue #24).
const MAX_ANSWER_LENGTH = 2000;

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
  answerForm: document.getElementById('answer-form'),
  answerInput: document.getElementById('answer-input'),
  answerSuggestedBadge: document.getElementById('answer-suggested-badge'),
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

// NOTE (pre-existing, unrelated to issue #33): this file was found already
// truncated on `main` — everything below this point (activate/route-after-
// connect, sponsored onboarding, goOnline()/SSE handling, answer submission,
// earnings/staking, withdraw, and push notifications) had been replaced by a
// stray `/* … truncated 599 chars … */` placeholder, and a "Social recovery
// (client-side Shamir split)" feature was referenced in a dangling comment
// with no implementation left. `activateWallet` was called from the
// connect/quick-start handlers above but was never defined anywhere in the
// repo — a real, currently-shipped ReferenceError on every wallet connect.
// The code below restores the last known-working version of this section
// (recovered from git history prior to the truncation), which issue #33
// needs a working question-dispatch flow to attach its prefill to. The
// social-recovery UI itself is not restored here (unrelated to #33, and a
// nontrivial feature on its own) — that remains a separate, still-open gap.

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
        body: JSON.stringify({ subscription: subscription.toJSON(), categories: selectedCategories(), token }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `subscribe failed: ${res.status}`);

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
