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
