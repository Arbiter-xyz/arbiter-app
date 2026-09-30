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
// Mirrors the backend's MAX_ANSWER_LENGTH default (backend/src/server.js) —
// caught here so a too-long answer gets a clear message instead of round-
// tripping to the backend only to have the specific reason discarded
// (issue #24).
const MAX_ANSWER_LENGTH = 2000;

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
// rebuild a user's key.

const RECOVERY_SHARE_PREFIX = 'arbiter-recovery-share-v1';

// GF(256) arithmetic with the AES polynomial 0x11b, used for Shamir splitting.
function gfMul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function gfInv(a) {
  if (a === 0) throw new Error('cannot invert zero');
  let r = 1;
  for (let i = 0; i < 254; i++) r = gfMul(r, a);
  return r;
}

function gfDiv(a, b) {
  return gfMul(a, gfInv(b));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// Split `secret` (Uint8Array) into `n` shares, any `k` of which reconstruct it.
// Each share is { x, y } where y is one byte per secret byte.
function splitSecret(secret, k, n) {
  if (k < 2 || k > n) throw new Error('threshold must be between 2 and the number of shares');
  const shares = [];
  for (let i = 0; i < n; i++) shares.push({ x: i + 1, y: new Uint8Array(secret.length) });
  for (let byteIndex = 0; byteIndex < secret.length; byteIndex++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[byteIndex];
    const rest = randomBytes(k - 1);
    for (let j = 1; j < k; j++) coeffs[j] = rest[j - 1];
    for (const share of shares) {
      let acc = 0;
      for (let j = k - 1; j >= 0; j--) acc = gfMul(acc, share.x) ^ coeffs[j];
      share.y[byteIndex] = acc;
    }
  }
  return shares;
}

// Lagrange interpolation at x=0 over GF(256) to recover the secret bytes.
function combineShares(shares) {
  if (shares.length < 2) throw new Error('need at least two shares');
  const length = shares[0].y.length;
  const secret = new Uint8Array(length);
  for (let byteIndex = 0; byteIndex < length; byteIndex++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = gfMul(num, shares[j].x);
        den = gfMul(den, shares[i].x ^ shares[j].x);
      }
      acc ^= gfMul(shares[i].y[byteIndex], gfDiv(num, den));
    }
    secret[byteIndex] = acc;
  }
  return secret;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeShare(share, k, n) {
  return `${RECOVERY_SHARE_PREFIX}:${k}-of-${n}:${share.x}:${bytesToBase64(share.y)}`;
}

function decodeShare(text) {
  const parts = text.trim().split(':');
  if (parts.length !== 4 || parts[0] !== RECOVERY_SHARE_PREFIX) {
    throw new Error('not a valid Arbiter recovery share');
  }
  const [k, n] = parts[1].split('-of-').map(Number);
  return { k, n, x: Number(parts[2]), y: base64ToBytes(parts[3]) };
}

function secretToBytes(secret) {
  return new TextEncoder().encode(secret);
}

function bytesToSecret(bytes) {
  return new TextDecoder().decode(bytes);
}

function renderRecoveryShares(shares, k, n) {
  el.recoveryShares.innerHTML = '';
  shares.forEach((share, index) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `Share ${index + 1} of ${n} — give this to one trustee:`;
    const code = document.createElement('code');
    code.textContent = encodeShare(share, k, n);
    li.append(label, code);
    el.recoveryShares.append(li);
  });
}

// NOTE (pre-existing, unrelated to this PR's issues): index.html has no
// recovery-panel markup, so el.btnSetupRecovery/el.btnRecoverWallet are
// always null. A prior commit (60a4998, "fix: #74 Social recovery flow")
// wired these listeners unconditionally, which threw at module load
// (`Cannot read properties of null (reading 'addEventListener')`) and
// crashed this entire script for every visitor — no wallet connect, no
// onboarding, nothing worked. Guarded the same way `el.btnEnablePush` is
// guarded below, so a missing element degrades gracefully instead of
// taking down the whole page. Restoring the actual recovery UI is out of
// scope here (issue #74's concern, not this PR's).
if (el.btnSetupRecovery) {
  el.btnSetupRecovery.addEventListener('click', () => {
    const secret = getLocalWalletSecret();
    if (!secret) {
      el.recoveryStatus.textContent = 'No quick-start wallet found in this browser.';
      return;
    }
    const k = Number(el.recoveryThreshold.value);
    const n = Number(el.recoveryShareCount.value);
    if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || k > n) {
      el.recoveryStatus.textContent = 'Choose a threshold between 2 and the number of shares.';
      return;
    }
    try {
      const shares = splitSecret(secretToBytes(secret), k, n);
      renderRecoveryShares(shares, k, n);
      el.recoveryStatus.textContent = `Split into ${n} shares — any ${k} reconstruct the wallet. Nothing was sent to the network.`;
    } catch (err) {
      el.recoveryStatus.textContent = `Could not split the secret: ${err.message}`;
    }
  });
}

if (el.btnRecoverWallet) {
  el.btnRecoverWallet.addEventListener('click', async () => {
    const lines = el.recoveryInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) {
      el.recoveryStatus.textContent = 'Paste at least two shares, one per line.';
      return;
    }
    try {
      const shares = lines.map(decodeShare);
      const secret = bytesToSecret(combineShares(shares));
      const { Keypair } = await import('@stellar/stellar-sdk');
      const keypair = Keypair.fromSecret(secret);
      el.recoveryStatus.textContent = `Recovered wallet ${keypair.publicKey()} — import this secret into your wallet to use it.`;
      log(`Recovered quick-start wallet ${keypair.publicKey()} from ${shares.length} shares.`);
    } catch (err) {
      el.recoveryStatus.textContent = `Recovery failed: ${err.message}`;
    }
  });
}

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

  if (answer.length > MAX_ANSWER_LENGTH) {
    log(`Answer is too long (${answer.length}/${MAX_ANSWER_LENGTH} characters) — shorten it and resubmit.`);
    return;
  }

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
      // The question may still be open — re-enable so a worker who follows
      // that exact instruction can retype and resubmit against it, instead
      // of the form staying stuck disabled until the question expires or a
      // new one arrives (issue #24). The 409 (already-closed) branch below
      // deliberately does NOT do this — there's nothing to retry there.
      el.btnAnswer.disabled = false;
      el.answerInput.disabled = false;
    } else if (res.status === 409) {
      log('Answer rejected — question already closed, expired, or already answered');
    } else if (!res.ok) {
      // Surface the backend's actual reason (e.g. "answer must be at most
      // 2000 characters") instead of a generic "unexpected status N" —
      // same pattern the onboard/stake/withdraw handlers already use.
      throw new Error((await res.json()).error || `unexpected status ${res.status}`);
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

