import { getAccount, getNetwork, getBalance, withdraw } from './api.js';
import { formatAmount } from './format.js';
import { showToast } from './toast.js';

const WITHDRAW_MIN = 0.01;

// Upper bound on the amount we'll auto-relay to an anchor's collection
// account. The amount comes straight from the anchor's SEP-24 response, so
// a compromised or misconfigured anchor could otherwise get a worker to
// sign a transfer far larger than the UI implied. Anything above this is
// treated as untrusted and falls back to the manual-instructions display.
const MAX_AUTO_RELAY_AMOUNT = 100000;

// How long a cached anchor config is trusted before we re-fetch it. The
// config pins the anchor's webAuthEndpoint and transferServer, so a
// long-lived tab that cached it once could otherwise keep opening the
// withdrawal popup against an endpoint the backend has since changed
// (e.g. an anchor migration or a rotated/compromised endpoint). Re-fetching
// bounds that staleness window without re-hitting the backend on every
// click.
const ANCHOR_CONFIG_TTL_MS = 5 * 60 * 1000;

// How many times reportToArbiter retries a failed /anchor/report POST before
// giving up. A dropped report means admin.js's renderKyc/renderPayouts views
// silently miss this withdrawal, so a couple of retries with backoff is worth
// the extra requests — but it stays bounded so a persistently-down backend
// can't wedge the withdraw flow.
const REPORT_MAX_ATTEMPTS = 3;
const REPORT_RETRY_BASE_MS = 500;

async function getAnchorConfig() {
  const res = await fetch(`${BACKEND_URL}/anchor/config`);
  if (res.status === 503) return NO_ANCHOR; // no anchor configured on this backend
  if (!res.ok) throw new Error(`failed to load anchor config (${res.status})`);
  return res.json();
}

async function sep10Auth(anchorConfig, address, wallet, networkPassphrase) {
  const challengeUrl = new URL(anchorConfig.webAuthEndpoint);
  challengeUrl.searchParams.set('account', address);
  const challengeRes = await fetch(challengeUrl);
  if (!challengeRes.ok) throw new Error(`anchor rejected the SEP-10 challenge request (${challengeRes.status})`);
  const { transaction } = await challengeRes.json();

  const { signedTxXdr } = await wallet.signTransaction(transaction, { address, networkPassphrase });

  const verifyRes = await fetch(anchorConfig.webAuthEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedTxXdr }),
  });
  if (!verifyRes.ok) throw new Error(`anchor rejected the signed SEP-10 challenge (${verifyRes.status})`);
  const { token } = await verifyRes.json();
  return token;
}

async function startInteractiveWithdraw(anchorConfig, jwt, address, assetCode) {
  const res = await fetch(`${anchorConfig.transferServer}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ asset_code: assetCode, account: address }),
  });
  if (!res.ok) throw new Error(`anchor rejected the withdraw request (${res.status})`);
  return res.json(); // { type: 'interactive_customer_info_needed', url, id }
}

// SEP-24 statuses that end the flow — either payment-ready or unrecoverable.
// Polling past one of these only ends in a misleading generic timeout.
const TERMINAL_STATUSES = new Set([
  'pending_user_transfer_start',
  'completed',
  'error',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
]);

export async function pollTransaction(anchorConfig, jwt, id, onUpdate) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const url = new URL(`${anchorConfig.transferServer}/transaction`);
    url.searchParams.set('id', id);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    // A 4xx (other than rate limiting) won't fix itself — e.g. an expired
    // SEP-10 JWT. Fail now instead of silently retrying for five minutes.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new Error(`anchor rejected the transaction poll (${res.status})`);
    }
    if (res.ok) {
      const { transaction } = await res.json();
      if (transaction.status !== lastStatus) {
        lastStatus = transaction.status;
        onUpdate(transaction);
      }
      if (TERMINAL_STATUSES.has(transaction.status)) {
        return transaction;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return value;
}

function validateWithdraw(amount, balance) {
  if (amount === null) {
    return 'Enter a valid amount.';
  }
  if (amount < WITHDRAW_MIN) {
    return `Minimum withdrawal is ${formatAmount(WITHDRAW_MIN)}.`;
  }
  if (amount > balance) {
    return 'Amount exceeds available balance.';
  }
  return null;
}

export async function initBankWithdraw(root) {
  if (!root) {
    return;
  }

  const form = root.querySelector('[data-withdraw-form]');
  const input = root.querySelector('[data-withdraw-amount]');
  const submit = root.querySelector('[data-withdraw-submit]');
  const balanceEl = root.querySelector('[data-withdraw-balance]');

  if (!form || !input || !submit) {
    return;
  }

  const account = getAccount();
  const network = getNetwork();

      if (['error', 'refunded', 'expired', 'no_market', 'too_small', 'too_large'].includes(transaction.status)) {
        status.textContent = `The anchor could not complete this withdrawal (${transaction.status}).`;
        return;
      }

  if (balanceEl) {
    balanceEl.textContent = formatAmount(balance);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const amount = parseAmount(input.value);
    const error = validateWithdraw(amount, balance);
    if (error) {
      showToast(error, 'error');
      return;
    }

    submit.disabled = true;
    try {
      await withdraw(account, network, amount);
      balance -= amount;
      if (balanceEl) {
        balanceEl.textContent = formatAmount(balance);
      }
      input.value = '';
      showToast('Withdrawal submitted.', 'success');
    } catch (err) {
      showToast('Withdrawal failed. Please try again.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
}
