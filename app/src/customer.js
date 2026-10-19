// API-key/fiat customer account page (issues #30, #37).
//
// #30 hadn't landed on `main` when this was picked up, so this file stands
// up the minimal page/login shell itself, per that issue's own text
// ("the two are expected to merge cleanly either order"): a "paste your API
// key" gate structurally identical to admin.js's showLogin()/showShell()/
// token-in-localStorage pattern, plus the account-balance view and a "top
// up" affordance against the existing POST /billing/checkout endpoint.
//
// #37 is the webhook registration/management section below. Wired against
// arbiter-backend's real contracts (issue #201):
//   GET    /webhooks                       -> { webhooks: [{ id, url, ... }] }
//   POST   /webhooks { url, description }  -> 201 { id, url, secret, ... }
//   DELETE /webhooks/:id
//   POST   /billing/checkout { successUrl, cancelUrl } -> { checkoutUrl }
// Auth: `Authorization: Bearer ak_live_…` (the API key itself), same scheme
// as the admin console's bearer token.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const KEY_STORAGE = 'arbiter-customer-api-key';

const el = {
  login: document.getElementById('panel-login'),
  account: document.getElementById('panel-account'),
  keyInput: document.getElementById('customer-key-input'),
  btnLogin: document.getElementById('btn-customer-login'),
  loginStatus: document.getElementById('customer-login-status'),
  btnLogout: document.getElementById('btn-customer-logout'),
  accountId: document.getElementById('account-id'),
  creditBalance: document.getElementById('credit-balance'),
  creditBalanceStroops: document.getElementById('credit-balance-stroops'),
  btnTopUp: document.getElementById('btn-top-up'),
  webhookInput: document.getElementById('webhook-url-input'),
  btnWebhookSave: document.getElementById('btn-webhook-save'),
  btnWebhookDelete: document.getElementById('btn-webhook-delete'),
  webhookStatus: document.getElementById('webhook-status'),
  log: document.getElementById('log'),
};

function log(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.log.prepend(li);
}

function showLogin(message = '') {
  el.login.classList.remove('hidden');
  el.account.classList.add('hidden');
  el.loginStatus.textContent = message;
}

function showAccount() {
  el.login.classList.add('hidden');
  el.account.classList.remove('hidden');
}

async function fetchCustomer(path, options = {}) {
  const key = localStorage.getItem(KEY_STORAGE);
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem(KEY_STORAGE);
    showLogin('That API key was rejected — try again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `backend returned ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function loadAccount() {
  try {
    const account = await fetchCustomer('/billing/account');
    el.accountId.textContent = account.accountId;
    el.creditBalance.textContent = `${account.creditBalance} USDC`;
    el.creditBalanceStroops.textContent = `${account.creditBalanceStroops} stroops`;
    showAccount();
    await loadWebhook();
  } catch (err) {
    if (err.message !== 'unauthorized') log(`Could not load account: ${err.message}`);
  }
}

// The backend keeps a list of webhooks per account; this page manages the
// most recent one, so remember its id for DELETE /webhooks/:id.
let currentWebhookId = null;

async function loadWebhook() {
  try {
    const { webhooks = [] } = await fetchCustomer('/webhooks');
    const current = webhooks[webhooks.length - 1];
    currentWebhookId = current?.id ?? null;
    const url = current?.url;
    el.webhookInput.value = url || '';
    el.webhookStatus.textContent = url ? `Currently registered: ${url}` : 'No webhook registered yet.';
  } catch (err) {
    if (err.message !== 'unauthorized') el.webhookStatus.textContent = `Could not load webhook: ${err.message}`;
  }
}

// Same allowed-origin-style caution billing.js's isAllowedRedirectUrl()
// already applies to successUrl/cancelUrl — don't silently accept a URL the
// backend will just reject. Client-side, we can only check shape: https-only,
// well-formed.
function isPlausibleWebhookUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

el.btnLogin.addEventListener('click', async () => {
  const key = el.keyInput.value.trim();
  if (!key) return;
  localStorage.setItem(KEY_STORAGE, key);
  el.loginStatus.textContent = '';
  await loadAccount();
});

el.btnLogout.addEventListener('click', () => {
  localStorage.removeItem(KEY_STORAGE);
  el.keyInput.value = '';
  showLogin();
});

el.btnTopUp.addEventListener('click', async () => {
  el.btnTopUp.disabled = true;
  try {
    const here = window.location.href.split(/[?#]/)[0];
    const { checkoutUrl } = await fetchCustomer('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ successUrl: `${here}?checkout=success`, cancelUrl: `${here}?checkout=cancel` }),
    });
    if (!checkoutUrl) throw new Error('checkout session had no redirect url');
    window.location.href = checkoutUrl;
  } catch (err) {
    if (err.message !== 'unauthorized') log(`Could not start checkout: ${err.message}`);
  } finally {
    el.btnTopUp.disabled = false;
  }
});

el.btnWebhookSave.addEventListener('click', async () => {
  const url = el.webhookInput.value.trim();
  if (!isPlausibleWebhookUrl(url)) {
    el.webhookStatus.textContent = 'Enter a valid https:// webhook URL before saving.';
    return;
  }
  el.btnWebhookSave.disabled = true;
  try {
    const previousId = currentWebhookId;
    const created = await fetchCustomer('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, description: 'Settlement webhook (customer page)' }),
    });
    currentWebhookId = created.id;
    // Replace rather than accumulate: drop the one this page was showing.
    if (previousId) await fetchCustomer(`/webhooks/${encodeURIComponent(previousId)}`, { method: 'DELETE' });
    el.webhookStatus.textContent = created.secret
      ? `Saved — Arbiter will call ${url} on settlement. Signing secret (shown once): ${created.secret}`
      : `Saved — Arbiter will call ${url} on settlement.`;
    log('Webhook saved.');
  } catch (err) {
    if (err.message !== 'unauthorized') el.webhookStatus.textContent = `Could not save webhook: ${err.message}`;
  } finally {
    el.btnWebhookSave.disabled = false;
  }
});

el.btnWebhookDelete.addEventListener('click', async () => {
  if (!currentWebhookId) {
    el.webhookStatus.textContent = 'No webhook registered yet.';
    return;
  }
  el.btnWebhookDelete.disabled = true;
  try {
    await fetchCustomer(`/webhooks/${encodeURIComponent(currentWebhookId)}`, { method: 'DELETE' });
    currentWebhookId = null;
    el.webhookInput.value = '';
    el.webhookStatus.textContent = 'Webhook removed.';
    log('Webhook removed.');
  } catch (err) {
    if (err.message !== 'unauthorized') el.webhookStatus.textContent = `Could not remove webhook: ${err.message}`;
  } finally {
    el.btnWebhookDelete.disabled = false;
  }
});

if (localStorage.getItem(KEY_STORAGE)) {
  loadAccount();
} else {
  showLogin();
}
