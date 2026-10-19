/**
 * Fiat rails — drives SEP-10 auth and the SEP-24 interactive withdraw flow
 * directly against whichever anchor the backend is configured with (see
 * backend/src/anchorClient.js). This has to happen in the browser: the
 * anchor's JWT is gated by the account holder signing a SEP-10 challenge
 * themselves, so the backend has no authority to do this on a user's
 * behalf.
 *
 * Scope note: this gets a user from "click Withdraw to bank" through the
 * anchor's hosted KYC/deposit-details UI and back to "here is the exact
 * destination account, memo, and amount the anchor wants." It deliberately
 * stops there rather than auto-sending that payment — a memo-carrying
 * transfer to a per-anchor collection account is real, hard-to-undo money
 * movement, and different anchors have different memo requirements. Wiring
 * that into the existing withdraw_to() fee-bump relay (sponsor.js) is a
 * real next step, not something to guess at without testing against a live
 * anchor's actual behavior end to end.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Upper bound on the amount we'll auto-relay to an anchor's collection
// account. The amount comes straight from the anchor's SEP-24 response, so
// a compromised or misconfigured anchor could otherwise get a worker to
// sign a transfer far larger than the UI implied. Anything above this is
// treated as untrusted and falls back to the manual-instructions display.
const MAX_AUTO_RELAY_AMOUNT = 100000;

// How long a cached anchor config is trusted before we re-fetch it. The
// config pins the anchor's webAuthEndpoint and transferServerSep24, so a
// long-lived tab that cached it once could otherwise keep opening the
// withdrawal popup against an endpoint the backend has since changed
// (e.g. an anchor migration or a rotated/compromised endpoint). Re-fetching
// bounds that staleness window without re-hitting the backend on every
// click.
const ANCHOR_CONFIG_TTL_MS = 5 * 60 * 1000;

// Sentinel returned by getAnchorConfig() when the backend explicitly reports
// that no anchor is configured (503). Distinct from a thrown error so callers
// can tell "definitively unconfigured" apart from "couldn't reach the backend
// right now" — the latter must not be cached as if it were the former.
const NO_ANCHOR = Symbol('no-anchor-configured');

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
  const res = await fetch(`${anchorConfig.transferServerSep24}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ asset_code: assetCode, account: address }),
  });
  if (!res.ok) throw new Error(`anchor rejected the withdraw request (${res.status})`);
  return res.json(); // { type: 'interactive_customer_info_needed', url, id }
}

async function pollTransaction(anchorConfig, jwt, id, onUpdate) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const url = new URL(`${anchorConfig.transferServerSep24}/transaction`);
    url.searchParams.set('id', id);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    if (res.ok) {
      const { transaction } = await res.json();
      if (transaction.status !== lastStatus) {
        lastStatus = transaction.status;
        onUpdate(transaction);
      }
      if (['pending_user_transfer_start', 'completed', 'error', 'refunded'].includes(transaction.status)) {
        return transaction;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('timed out waiting for the anchor to reach a payment-ready state');
}

async function reportToArbiter({ address, arbiterSessionToken, transaction }) {
  await fetch(`${BACKEND_URL}/anchor/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      token: arbiterSessionToken,
      kind: 'withdrawal',
      status: transaction.status,
      amount: transaction.amount_in || null,
      assetCode: transaction.amount_in_asset || null,
      anchorTransactionId: transaction.id,
    }),
  }).catch(() => {}); // best-effort — the admin console cache is a convenience, not the source of truth
}

/**
 * Wires up a "Withdraw to bank" button. Hides it entirely if the backend
 * has no anchor configured. `deps` needs: button element, status element,
 * getAddress()/getWallet() (same shape main.js already uses for the
 * on-chain withdraw button), getArbiterSessionToken() (from ensureSession()
 * — reused here purely to authenticate the /anchor/report call, not the
 * anchor itself), networkPassphrase, and assetCode.
 *
 * `autoRelayWithdrawal` (issue #22, optional): `({ amount, beneficiary, memo }) =>
 * Promise<void>` — when provided, builds/signs/relays the on-chain
 * withdraw_to() transfer to the anchor's collection account automatically
 * (through the existing sponsor fee-bump relay) once the worker explicitly
 * confirms, instead of only ever showing static "send this yourself"
 * instructions. If it's omitted, or throws, or the anchor's response is
 * missing/malformed data this can't confidently act on, this falls back to
 * the manual-instructions display — the safer default.
 */
export function initBankWithdraw({ button, status, getAddress, getWallet, getArbiterSessionToken, networkPassphrase, assetCode, autoRelayWithdrawal }) {
  let anchorConfigPromise = null;
  let anchorConfigFetchedAt = 0;

  // Re-fetch the anchor config once the cached copy is older than
  // ANCHOR_CONFIG_TTL_MS, so a long-lived tab can't keep opening the
  // withdrawal popup against a stale endpoint after the backend's anchor
  // config has changed. Concurrent callers share the in-flight promise.
  //
  // Only a definitive "no anchor configured" (NO_ANCHOR) is cached for the
  // full TTL. A transient failure (500, network error) is NOT cached — the
  // promise is cleared so the next call retries, rather than pinning the
  // session into a permanent "unconfigured" state.
  async function ensureAnchorConfig() {
    const isStale = !anchorConfigPromise || Date.now() - anchorConfigFetchedAt > ANCHOR_CONFIG_TTL_MS;
    if (isStale) {
      anchorConfigFetchedAt = Date.now();
      anchorConfigPromise = getAnchorConfig().catch((err) => {
        // Don't cache a failed fetch — let the next call retry.
        anchorConfigPromise = null;
        anchorConfigFetchedAt = 0;
        throw err;
      });
    }
    return anchorConfigPromise;
  }

  ensureAnchorConfig()
    .then((cfg) => {
      if (cfg && cfg !== NO_ANCHOR) button.classList.remove('hidden');
    })
    .catch(() => {}); // no anchor configured, or unreachable — button stays hidden either way

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '';
    try {
      const anchorConfig = await ensureAnchorConfig();
      if (!anchorConfig || anchorConfig === NO_ANCHOR) throw new Error('no fiat anchor is configured on this backend');

      const address = getAddress();
      const wallet = getWallet();

      status.textContent = 'Authenticating with the anchor (one signature)…';
      const jwt = await sep10Auth(anchorConfig, address, wallet, networkPassphrase);

      status.textContent = 'Opening the anchor\'s wi

/* … truncated 1208 chars — edit only what you need near the top … */
