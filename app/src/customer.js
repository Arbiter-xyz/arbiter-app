import { usdcFromStroops } from './units.js';

// API customer dashboard (issue #31, extending the base account/balance
// page + API-key login gate from issue #30). Neither app/customer.html nor
// this file existed anywhere in the repo before this PR — see this PR's
// description for why the "extends #30" base had to be built here too.
//
// Auth model mirrors admin.js's bearer-token pattern (paste once, stored in
// localStorage, sent as `Authorization: Bearer <key>`), the closest existing
// precedent in this codebase for a privileged, token-gated console. The
// authoritative auth contract is the backend agent's to set.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const KEY_STORAGE = 'arbiter-customer-api-key';

const el = {
  panelLogin: document.getElementById('panel-login'),
  shell: document.getElementById('customer-shell'),
  keyInput: document.getElementById('customer-key-input'),
  btnLogin: document.getElementById('btn-customer-login'),
  loginStatus: document.getElementById('customer-login-status'),
  btnLogout: document.getElementById('btn-customer-logout'),
  accountId: document.getElementById('customer-account-id'),
  balance: document.getElementById('customer-balance'),
  spendStatus: document.getElementById('spend-status'),
  spendList: document.getElementById('spend-list'),
  successStatus: document.getElementById('success-status'),
  successStats: document.getElementById('success-stats'),
  successResolved: document.getElementById('success-resolved'),
  successRefunded: document.getElementById('success-refunded'),
  successRate: document.getElementById('success-rate'),
  categoryStatus: document.getElementById('category-status'),
  categoryTable: document.getElementById('category-table'),
  categoryBody: document.getElementById('category-body'),
};

async function fetchCustomer(path) {
  const key = localStorage.getItem(KEY_STORAGE);
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) {
    localStorage.removeItem(KEY_STORAGE);
    showLogin('That API key was rejected — try again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return res.json();
}

function showLogin(message = '') {
  el.panelLogin.classList.remove('hidden');
  el.shell.classList.add('hidden');
  el.loginStatus.textContent = message;
}

function showShell() {
  el.panelLogin.classList.add('hidden');
  el.shell.classList.remove('hidden');
}

// --- Base account/balance (issue #30) --------------------------------------

async function loadAccount() {
  const { accountId, creditBalanceStroops } = await fetchCustomer('/billing/account');
  el.accountId.textContent = accountId;
  el.balance.textContent = `${usdcFromStroops(creditBalanceStroops)} USDC`;
}

// --- Spend over time, success rate, per-category breakdown (issue #31) -----
// Assumed endpoint (documented in this PR's description; the authoritative
// shape is the backend agent's to set):
//   GET /billing/account/stats -> {
//     spendOverTime: [{ date: 'YYYY-MM-DD', amountStroops: string }],
//     successRate: { resolved: number, refunded: number, total: number },
//     byCategory: [{ category: string, count: number, spendStroops: string }],
//   }

async function loadStats() {
  let stats;
  try {
    stats = await fetchCustomer('/billing/account/stats');
  } catch (err) {
    if (err.message === 'unauthorized') return;
    const message = `Could not load usage stats: ${err.message}`;
    el.spendStatus.textContent = message;
    el.successStatus.textContent = message;
    el.categoryStatus.textContent = message;
    return;
  }
  renderSpendOverTime(stats.spendOverTime || []);
  renderSuccessRate(stats.successRate || null);
  renderCategoryBreakdown(stats.byCategory || []);
}

// Hand-rolled, dependency-free bar list — not the place for a charting
// library (see the project's existing preference for plain DOM rendering
// throughout app/src/*.js).
function renderSpendOverTime(points) {
  el.spendList.innerHTML = '';
  if (points.length === 0) {
    el.spendStatus.textContent = 'No spend recorded yet.';
    return;
  }
  el.spendStatus.textContent = '';
  const max = Math.max(...points.map((p) => Number(usdcFromStroops(p.amountStroops))), 0.0000001);
  for (const point of points) {
    const amount = Number(usdcFromStroops(point.amountStroops));
    const li = document.createElement('li');
    li.className = 'spend-row';

    const label = document.createElement('span');
    label.className = 'spend-date muted small';
    label.textContent = point.date;

    const track = document.createElement('span');
    track.className = 'spend-track';
    const bar = document.createElement('span');
    bar.className = 'spend-bar';
    bar.style.width = `${Math.max(2, Math.round((amount / max) * 100))}%`;
    track.appendChild(bar);

    const value = document.createElement('span');
    value.className = 'spend-value muted small';
    value.textContent = `${amount.toFixed(2)} USDC`;

    li.append(label, track, value);
    el.spendList.appendChild(li);
  }
}

function renderSuccessRate(successRate) {
  if (!successRate || successRate.total === 0) {
    el.successStatus.textContent = 'No resolved or refunded questions yet.';
    el.successStats.style.display = 'none';
    return;
  }
  el.successStatus.textContent = '';
  el.successStats.style.display = '';
  el.successResolved.textContent = String(successRate.resolved);
  el.successRefunded.textContent = String(successRate.refunded);
  const rate = successRate.total > 0 ? successRate.resolved / successRate.total : null;
  el.successRate.textContent = rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function renderCategoryBreakdown(categories) {
  el.categoryBody.innerHTML = '';
  if (categories.length === 0) {
    el.categoryStatus.textContent = 'No categorized spend yet.';
    el.categoryTable.style.display = 'none';
    return;
  }
  el.categoryStatus.textContent = '';
  el.categoryTable.style.display = '';
  for (const c of categories) {
    const tr = document.createElement('tr');
    const tdCategory = document.createElement('td');
    tdCategory.textContent = c.category;
    const tdCount = document.createElement('td');
    tdCount.textContent = String(c.count);
    const tdSpend = document.createElement('td');
    tdSpend.textContent = `${usdcFromStroops(c.spendStroops)} USDC`;
    tr.append(tdCategory, tdCount, tdSpend);
    el.categoryBody.appendChild(tr);
  }
}

async function loadAll() {
  try {
    await loadAccount();
  } catch (err) {
    if (err.message !== 'unauthorized') el.balance.textContent = `Error: ${err.message}`;
    return;
  }
  await loadStats();
}

el.btnLogin.addEventListener('click', () => {
  const key = el.keyInput.value.trim();
  if (!key) return;
  localStorage.setItem(KEY_STORAGE, key);
  showShell();
  loadAll();
});

el.btnLogout.addEventListener('click', () => {
  localStorage.removeItem(KEY_STORAGE);
  showLogin();
});

if (localStorage.getItem(KEY_STORAGE)) {
  showShell();
  loadAll();
} else {
  showLogin();
}
