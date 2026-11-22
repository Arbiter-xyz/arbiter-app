// Wallet-free, fiat/API-key checkout UI for #panel-apikey (issue #148/#149).
//
// Mirrors customer.js's billing-checkout pattern (POST /billing/checkout ->
// redirect url), but this panel runs *before* a key exists: it collects an
// email + top-up amount, kicks off a Stripe-style checkout session, and once
// the backend confirms payment, reveals the newly issued API key exactly
// once (there is no "show key again" by design — see the warning copy
// already in index.html).

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

const el = {
  checkoutForm: document.getElementById('apikey-checkout-form'),
  email: document.getElementById('apikey-email'),
  amount: document.getElementById('apikey-amount'),
  btnCheckout: document.getElementById('btn-apikey-checkout'),
  checkoutStatus: document.getElementById('apikey-checkout-status'),

  reveal: document.getElementById('apikey-reveal'),
  revealInput: document.getElementById('apikey-reveal-input'),
  btnCopy: document.getElementById('btn-copy-apikey'),
  copyStatus: document.getElementById('apikey-copy-status'),

  account: document.getElementById('apikey-account'),
  balance: document.getElementById('apikey-balance'),
  btnTopUp: document.getElementById('btn-apikey-topup'),
  accountStatus: document.getElementById('apikey-account-status'),
};

function setCheckoutStatus(message) {
  el.checkoutStatus.textContent = message;
}

// If the checkout redirect returns here with a session id, poll the backend
// for the resulting API key rather than assuming it's already mintable from
// the URL — the key is only ever handed over once, server-side.
async function maybeResumeFromRedirect() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('apikey_session');
  if (!sessionId) return;

  setCheckoutStatus('Finishing checkout…');
  try {
    const res = await fetch(`${BACKEND_URL}/billing/checkout/${sessionId}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `checkout lookup failed: ${res.status}`);
    const { apiKey, creditBalance } = await res.json();
    if (apiKey) revealApiKey(apiKey);
    if (typeof creditBalance === 'number') showAccount(creditBalance);
    setCheckoutStatus('');
  } catch (err) {
    setCheckoutStatus(`Could not finish checkout: ${err.message}`);
  }
}

function revealApiKey(apiKey) {
  el.revealInput.value = apiKey;
  el.reveal.classList.remove('hidden');
}

function showAccount(creditBalance) {
  el.balance.textContent = `${creditBalance} USDC`;
  el.account.classList.remove('hidden');
}

el.checkoutForm.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  el.btnCheckout.disabled = true;
  setCheckoutStatus('Starting checkout…');
  try {
    const email = el.email.value.trim();
    const amount = Number(el.amount.value);
    if (!email) throw new Error('email is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('top-up amount must be a positive number');

    const res = await fetch(`${BACKEND_URL}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amountUsdc: amount,
        successUrl: `${window.location.origin}${window.location.pathname}?apikey_session={CHECKOUT_SESSION_ID}`,
        cancelUrl: window.location.href,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `checkout failed: ${res.status}`);
    const { url } = await res.json();
    if (!url) throw new Error('checkout session had no redirect url');
    window.location.href = url;
  } catch (err) {
    setCheckoutStatus(`Could not start checkout: ${err.message}`);
  } finally {
    el.btnCheckout.disabled = false;
  }
});

el.btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.revealInput.value);
    el.copyStatus.textContent = 'Copied.';
  } catch (err) {
    el.copyStatus.textContent = `Could not copy: ${err.message}`;
  }
});

el.btnTopUp.addEventListener('click', async () => {
  el.btnTopUp.disabled = true;
  el.accountStatus.textContent = '';
  try {
    const res = await fetch(`${BACKEND_URL}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `checkout failed: ${res.status}`);
    const { url } = await res.json();
    if (!url) throw new Error('checkout session had no redirect url');
    window.location.href = url;
  } catch (err) {
    el.accountStatus.textContent = `Could not start top-up: ${err.message}`;
  } finally {
    el.btnTopUp.disabled = false;
  }
});

maybeResumeFromRedirect();
