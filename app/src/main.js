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

// --- Social recovery (client-side Shamir split, no backend involvement) ---
//
// The quick-start secret is split into N shares entirely in this browser.
// Arbiter's backend never sees the secret or any share: distribution is the
// user's own (contacts, a second device, a password manager). Reconstructing
// from any k shares reproduces the original Keypair/address, so the README's
// non-custodial framing is unchanged — there is no server-side capability to
// rebuild a user's key.
//
// NOTE (pre-existing, unrelated to issue #39): this file was found already
// truncated on `main` — everything from the Shamir-split implementation
// through the rest of the worker console (activateWallet(), goOnline()/SSE
// handling, answer submission, staking, on-chain withdraw, and push-
// notification wiring) was missing, replaced by a stray placeholder comment
// (`/* … truncated 599 chars … */`). That's a real, currently-shipped bug:
// `activateWallet` is called from the connect/quick-start handlers above but
// was not defined anywhere in the repo, so connecting a wallet threw a
// ReferenceError. Restoring the full original feature set (recovery UI,
// goOnline/SSE, answer submission, staking, withdraw, push) is out of scope
// for this issue — only `activateWallet()` is restored here, minimally, and
// only because issue #39's trustline check has no caller without it. The
// social-recovery UI, online/SSE flow, and earnings panel wiring remain
// pre-existing gaps for a separate fix.

/** Checks whether `address` already holds a trustline to the *real*,
 * contract-configured USDC — both asset_code and asset_issuer must match.
 * Fixes issue #39: a same-coded, different-issuer "USDC" lookalike trustline
 * used to pass this check (asset_code only), routing a worker who can't
 * actually receive real USDC payouts straight to the online panel. */
async function hasUsdcTrustline(address) {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
  const account = await res.json();
  return (account.balances || []).some(
    (b) => b.asset_code === USDC_ASSET_CODE && b.asset_issuer === USDC_ASSET_ISSUER
  );
}

/** Wires up a freshly connected/created wallet: records it as the active
 * signer, shows the worker's address, and routes to the sponsored-onboarding
 * panel or straight to the online panel depending on whether a real USDC
 * trustline already exists. */
async function activateWallet(wallet, address) {
  try {
    state.activeWallet = wallet;
    state.address = address;
    el.workerAddress.textContent = address;
    el.connect.classList.add('hidden');

    const trusted = await hasUsdcTrustline(address);
    showPanel(trusted ? 'online' : 'onboard');
    if (trusted) startCategoryDemandPolling();
    log(`Connected ${address}${trusted ? '' : ' — USDC trustline required before going online.'}`);
  } finally {
    setConnectButtonsBusy(false);
  }
}
