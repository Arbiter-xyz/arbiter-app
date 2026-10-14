// Wallet-free fiat / API-key checkout UI (issues #148, #207).
//
// Backend contract (billing.js):
//   POST /billing/checkout  { email, amount, amountUsdc } -> { url }
//   GET  /billing/account   (Bearer / X-Api-Key)          -> { accountId, creditBalance, creditBalanceStroops }
//
// Security invariant: the raw API key returned once via Stripe's success_url
// query string is held only in module memory for the current page view and
// immediately scrubbed from location.search via history.replaceState(). It is
// never written to localStorage or sessionStorage, so navigating away or
// reloading cannot recover it from this UI.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export function initApiKeyPanel(root = document) {
  const form = root.getElementById('apikey-checkout-form');
  const emailInput = root.getElementById('apikey-email');
  const amountInput = root.getElementById('apikey-amount');
  const btnCheckout = root.getElementById('btn-apikey-checkout');
  const checkoutStatus = root.getElementById('apikey-checkout-status');

  const revealBox = root.getElementById('apikey-reveal');
  const revealInput = root.getElementById('apikey-reveal-input');
  const btnCopy = root.getElementById('btn-copy-apikey');
  const copyStatus = root.getElementById('apikey-copy-status');

  const accountBox = root.getElementById('apikey-account');
  const balanceEl = root.getElementById('apikey-balance');
  const btnTopUp = root.getElementById('btn-apikey-topup');
  const accountStatus = root.getElementById('apikey-account-status');

  if (!form || !emailInput || !amountInput || !btnCheckout || !checkoutStatus) {
    return null;
  }

  // Kept only in closure memory for the current view — never persisted.
  let activeApiKey = null;

  async function loadAccountBalance(apiKey) {
    if (!apiKey || !accountBox || !balanceEl || !accountStatus) return;
    accountBox.classList.remove('hidden');
    accountStatus.textContent = 'Loading account balance…';
    try {
      const res = await fetch(`${BACKEND_URL}/billing/account`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Api-Key': apiKey,
        },
      });
      if (res.status === 202 || res.status === 404) {
        balanceEl.textContent = 'Pending…';
        accountStatus.textContent =
          'Payment received — webhook is still finalizing your credit balance. Try again in a moment.';
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `backend returned ${res.status}`);
      }
      const data = await res.json();
      const rawBalance = data.creditBalance ?? data.balance ?? '0.00';
      balanceEl.textContent = String(rawBalance).includes('USDC') ? String(rawBalance) : `${rawBalance} USDC`;
      accountStatus.textContent = '';
    } catch (err) {
      accountStatus.textContent = `Could not load account balance: ${err.message}`;
    }
  }

  function scrubReturnParams(params) {
    const keysToRemove = ['api_key', 'apiKey', 'checkout', 'session_id', 'error'];
    let mutated = false;
    for (const k of keysToRemove) {
      if (params.has(k)) {
        params.delete(k);
        mutated = true;
      }
    }
    if (mutated && typeof history !== 'undefined' && typeof history.replaceState === 'function') {
      const qs = params.toString();
      const nextUrl = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash || ''}`;
      history.replaceState(null, '', nextUrl);
    }
  }

  function handleReturnQuery() {
    if (typeof location === 'undefined') return;
    const params = new URLSearchParams(location.search);
    const returnedKey = params.get('api_key') || params.get('apiKey');
    const checkoutState = params.get('checkout');
    const errorMsg = params.get('error');
    const sessionId = params.get('session_id');

    scrubReturnParams(params);

    if (errorMsg || checkoutState === 'cancel' || checkoutState === 'cancelled' || checkoutState === 'failed') {
      checkoutStatus.textContent =
        errorMsg || 'Checkout was cancelled or card payment was declined — no API key was issued.';
      return;
    }

    if (returnedKey) {
      activeApiKey = returnedKey;
      if (revealBox && revealInput) {
        revealInput.value = returnedKey;
        revealBox.classList.remove('hidden');
      }
      checkoutStatus.textContent = 'Payment confirmed. Copy your API key below before leaving this page.';
      loadAccountBalance(returnedKey);
      return;
    }

    if (checkoutState === 'success' || checkoutState === 'pending' || sessionId) {
      checkoutStatus.textContent =
        'Payment submitted — waiting for Stripe webhook confirmation to provision your API key.';
    }
  }

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const email = emailInput.value.trim();
    const amount = Number(amountInput.value);
    if (!email || !email.includes('@')) {
      checkoutStatus.textContent = 'Enter a valid email address to continue.';
      return;
    }
    if (!Number.isFinite(amount) || amount < 1) {
      checkoutStatus.textContent = 'Enter a top-up amount of at least 1 USDC.';
      return;
    }

    btnCheckout.disabled = true;
    checkoutStatus.textContent = 'Starting checkout…';
    try {
      const returnBase = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : undefined;
      const res = await fetch(`${BACKEND_URL}/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeApiKey ? { Authorization: `Bearer ${activeApiKey}`, 'X-Api-Key': activeApiKey } : {}),
        },
        body: JSON.stringify({
          email,
          amount,
          amountUsdc: amount,
          successUrl: returnBase,
          cancelUrl: returnBase ? `${returnBase}?checkout=cancelled` : undefined,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `checkout failed (${res.status})`);
      }
      const { url } = await res.json();
      if (!url) throw new Error('checkout response did not include a redirect URL');
      checkoutStatus.textContent = 'Redirecting to Stripe Checkout…';
      if (typeof location !== 'undefined') {
        location.assign(url);
      }
    } catch (err) {
      checkoutStatus.textContent = `Could not start checkout: ${err.message}`;
    } finally {
      btnCheckout.disabled = false;
    }
  });

  if (btnCopy && revealInput && copyStatus) {
    btnCopy.addEventListener('click', async () => {
      const key = revealInput.value;
      if (!key) return;
      try {
        await navigator.clipboard.writeText(key);
        copyStatus.textContent = 'Copied to clipboard — store it somewhere safe.';
      } catch {
        revealInput.select();
        copyStatus.textContent = 'Clipboard permission denied — press Ctrl+C / Cmd+C to copy the selected key.';
      }
    });
  }

  if (btnTopUp) {
    btnTopUp.addEventListener('click', () => {
      amountInput.focus();
      form.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      if (accountStatus) {
        accountStatus.textContent = 'Enter a top-up amount above and click Continue to checkout.';
      }
    });
  }

  handleReturnQuery();
  return { loadAccountBalance };
}

initApiKeyPanel();
