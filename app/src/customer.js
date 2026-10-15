// API-key/fiat customer account page (issues #30, #37, #194, #201, #217).
//
// Authenticates against arbiter-backend using `Authorization: Bearer <apiKey>`
// (matching `backend/src/apiKeyAuth.js::extractApiKey`), manages webhooks via
// the backend's `/webhooks` endpoints (`GET /webhooks`, `POST /webhooks`,
// `DELETE /webhooks/:id`), and initiates top-up checkout via
// `POST /billing/checkout` with `{ successUrl, cancelUrl }` returning
// `{ checkoutUrl }`.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const KEY_STORAGE = 'arbiter-customer-api-key';

let activeWebhookId = null;

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
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(options.headers || {}),
    },
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

async function loadWebhook() {
  try {
    const data = await fetchCustomer('/webhooks');
    const webhooks = Array.isArray(data?.webhooks) ? data.webhooks : [];
    const current = webhooks[0] || null;
    activeWebhookId = current?.id ?? null;
    const url = current?.url || '';
    el.webhookInput.value = url;
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
  if (el.btnLogin.disabled) return;
  const key = el.keyInput.value.trim();
  if (!key) return;
  el.btnLogin.disabled = true;
  localStorage.setItem(KEY_STORAGE, key);
  el.loginStatus.textContent = '';
  try {
    await loadAccount();
  } finally {
    el.btnLogin.disabled = false;
  }
});

el.btnLogout.addEventListener('click', () => {
  localStorage.removeItem(KEY_STORAGE);
  activeWebhookId = null;
  el.keyInput.value = '';
  showLogin();
});

el.btnTopUp.addEventListener('click', async () => {
  el.btnTopUp.disabled = true;
  try {
    const returnUrl = window.location.href;
    const data = await fetchCustomer('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        successUrl: returnUrl,
        cancelUrl: returnUrl,
      }),
    });
    const redirectUrl = data?.checkoutUrl || data?.url;
    if (!redirectUrl) throw new Error('checkout session had no redirect url');
    window.location.href = redirectUrl;
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
    if (activeWebhookId) {
      await fetchCustomer(`/webhooks/${encodeURIComponent(activeWebhookId)}`, {
        method: 'DELETE',
      }).catch(() => {});
      activeWebhookId = null;
    }
    const created = await fetchCustomer('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        description: 'Customer settlement webhook',
      }),
    });
    activeWebhookId = created?.id ?? created?.webhook?.id ?? null;
    el.webhookStatus.textContent = `Saved — Arbiter will call ${url} on settlement.`;
    log('Webhook saved.');
  } catch (err) {
    if (err.message !== 'unauthorized') el.webhookStatus.textContent = `Could not save webhook: ${err.message}`;
  } finally {
    el.btnWebhookSave.disabled = false;
  }
});

el.btnWebhookDelete.addEventListener('click', async () => {
  el.btnWebhookDelete.disabled = true;
  try {
    if (!activeWebhookId) {
      await loadWebhook();
    }
    if (!activeWebhookId) {
      el.webhookStatus.textContent = 'No webhook registered to remove.';
      return;
    }
    await fetchCustomer(`/webhooks/${encodeURIComponent(activeWebhookId)}`, {
      method: 'DELETE',
    });
    activeWebhookId = null;
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

