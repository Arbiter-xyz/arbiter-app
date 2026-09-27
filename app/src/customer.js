// API-key/fiat customer account page (issue #30).
//
// Every other identity in this app has a real page (workers: index.html,
// wallet-based payers: dashboard.html, operators: admin.html); API-key/fiat
// customers only had GET /billing/account, a bare JSON endpoint. This page
// gives them a login gate — structurally identical to admin.js's
// showLogin()/showShell()/token-in-localStorage pattern, but storing the API
// key instead of an admin token — a live account-balance view, and a "top
// up" affordance against the existing POST /billing/checkout endpoint.
//
// Auth header: this repo has no backend/ directory (backend/src/billing.js
// and apiKeyAuth.js live in a separate repo), so the exact header
// resolveApiKey() expects can't be confirmed here. This assumes
// `X-Api-Key: <key>` (distinct from the admin console's `Authorization:
// Bearer <adminToken>`), documented so it's easy to swap for whatever the
// backend actually expects.

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
  accountStatus: document.getElementById('account-status'),
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
    headers: { 'X-Api-Key': key, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem(KEY_STORAGE);
    showLogin('That API key was rejected — try again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `backend returned ${res.status}`);
  return res.json();
}

async function loadAccount() {
  try {
    const account = await fetchCustomer('/billing/account');
    el.accountId.textContent = account.accountId;
    el.creditBalance.textContent = `${account.creditBalance} USDC`;
    el.creditBalanceStroops.textContent = `${account.creditBalanceStroops} stroops`;
    showAccount();
  } catch (err) {
    if (err.message !== 'unauthorized') log(`Could not load account: ${err.message}`);
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
  el.accountStatus.textContent = '';
  try {
    const { url } = await fetchCustomer('/billing/checkout', { method: 'POST' });
    if (!url) throw new Error('checkout session had no redirect url');
    window.location.href = url;
  } catch (err) {
    if (err.message !== 'unauthorized') {
      el.accountStatus.textContent = `Could not start checkout: ${err.message}`;
      log(`Could not start checkout: ${err.message}`);
    }
  } finally {
    el.btnTopUp.disabled = false;
  }
});

if (localStorage.getItem(KEY_STORAGE)) {
  loadAccount();
} else {
  showLogin();
}
