const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const TOKEN_KEY = 'arbiter-admin-token';

function truncateAddress(id) {
  if (!id || id.length <= 16 || !id.startsWith('G')) return id || '—';
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

function formatRatio(ratio) {
  return ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(1)}%`;
}

// Every table below renders data that traces back to caller-controlled
// input somewhere upstream — a non-address workerId (no auth required,
// see workerAuth.js::requiresAuth), or the fully self-reported fields
// POST /anchor/report accepts from any session holder (status/tier/
// amount/assetCode, rendered in the KYC/Payouts views below). This is the
// admin console, holding a privileged bearer token in localStorage — the
// one page where an innerHTML-based stored XSS would matter most. Built
// with createElement/textContent throughout instead.
function td(text, { className, title } = {}) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  if (title !== undefined) cell.title = title;
  cell.textContent = text;
  return cell;
}

function row(cells) {
  const tr = document.createElement('tr');
  tr.append(...cells);
  return tr;
}

function emptyRow(colspan, text) {
  const cell = document.createElement('td');
  cell.colSpan = colspan;
  cell.className = 'muted small';
  cell.textContent = text;
  return row([cell]);
}

function replaceRows(tbody, rows) {
  tbody.replaceChildren(...rows);
}

// `options` follows fetch()'s own shape (method/headers/body) — passing none
// preserves every existing GET-only call site's behavior exactly.
async function fetchAdmin(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    showLogin('That token was rejected — try again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let message = `backend returned ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch {
      // body wasn't JSON (or was empty) — fall back to the generic message.
    }
    throw new Error(message);
  }
  return res.json();
}

function showLogin(message = '') {
  document.getElementById('panel-login').classList.remove('hidden');
  document.getElementById('admin-shell').classList.add('hidden');
  document.getElementById('admin-login-status').textContent = message;
}

function showShell() {
  document.getElementById('panel-login').classList.add('hidden');
  document.getElementById('admin-shell').classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Per-view renderers. Each is loaded lazily the first time its nav item
// is selected, so opening the console doesn't fire five requests at once.
// ---------------------------------------------------------------------

const loaded = new Set();

async function renderOverview() {
  const [{ resolvedCount, totalFeeRevenue }, treasury, workers, payers] = await Promise.all([
    fetchAdmin('/admin/fees'),
    fetchAdmin('/admin/treasury'),
    fetchAdmin('/admin/workers'),
    fetchAdmin('/admin/payers'),
  ]);
  document.getElementById('ov-fees').textContent = `${totalFeeRevenue} USDC (${resolvedCount})`;
  document.getElementById('ov-treasury-usdc').textContent = treasury.configured ? `${treasury.usdcBalance}` : 'not configured';
  document.getElementById('ov-treasury-xlm').textContent = treasury.configured ? `${treasury.xlmBalance}` : 'not configured';
  document.getElementById('ov-workers').textContent = workers.workers.length;
  document.getElementById('ov-payers').textContent = payers.payers.length;
}

async function renderTransactions() {
  const tbody = document.getElementById('tx-body');
  const { transactions } = await fetchAdmin('/admin/transactions?limit=100');
  if (transactions.length === 0) {
    replaceRows(tbody, [emptyRow(6, 'No transactions yet.')]);
    return;
  }
  replaceRows(
    tbody,
    transactions.map((t) => {
      const badge = document.createElement('span');
      badge.className = `badge badge-${t.status === 'settled' ? 'resolved' : 'pending'}`;
      badge.textContent = t.status || '—';
      const statusCell = document.createElement('td');
      statusCell.appendChild(badge);

      return row([
        td(truncateAddress(String(t.questionId)), { title: t.questionId }),
        td(truncateAddress(t.payer), { title: t.payer || '' }),
        td(`${t.amountStroops ? (Number(t.amountStroops) / 1e7).toFixed(2) : '—'} USDC`),
        statusCell,
        td(t.outcome || '—'),
        td(t.createdAt ? new Date(t.createdAt).toLocaleString() : '—', { className: 'muted small' }),
      ]);
    }),
  );
}

async function renderWorkers() {
  const tbody = document.getElementById('workers-body');
  const { workers } = await fetchAdmin('/admin/workers');
  if (workers.length === 0) {
    replaceRows(tbody, [emptyRow(6, 'No workers recorded yet.')]);
    return;
  }
  replaceRows(
    tbody,
    workers.map((w) =>
      row([
        td(truncateAddress(w.workerId), { title: w.workerId }),
        td(formatRatio(w.matchRatio)),
        td(w.totalAnswers),
        td(w.established ? 'yes' : 'no'),
        td(`${w.stake} USDC`),
        td(`${w.owed} USDC`),
      ]),
    ),
  );
}

async function renderPayers() {
  const tbody = document.getElementById('payers-body');
  const { payers } = await fetchAdmin('/admin/payers');
  if (payers.length === 0) {
    replaceRows(tbody, [emptyRow(5, 'No payers recorded yet.')]);
    return;
  }
  replaceRows(
    tbody,
    payers.map((p) =>
      row([
        td(truncateAddress(p.payerAddress), { title: p.payerAddress }),
        td(`${p.totalSpend} USDC`),
        td(p.totalTracked),
        td(p.settled),
        td(formatRatio(p.successRate)),
      ]),
    ),
  );
}

async function renderFees() {
  const { resolvedCount, totalFeeRevenue } = await fetchAdmin('/admin/fees');
  document.getElementById('fees-count').textContent = resolvedCount;
  document.getElementById('fees-total').textContent = totalFeeRevenue;
}

async function renderTreasury() {
  const panel = document.getElementById('treasury-panel');
  const treasury = await fetchAdmin('/admin/treasury');
  if (!treasury.configured) {
    panel.innerHTML = '<p class="muted small">PLATFORM_ADDRESS is not configured on the backend.</p>';
    return;
  }
  panel.innerHTML = `
    <p>Platform address: <span title="${treasury.platformAddress}">${truncateAddress(treasury.platformAddress)}</span></p>
    <p>USDC balance: <strong>${treasury.usdcBalance}</strong></p>
    <p>XLM balance: <strong>${treasury.xlmBalance}</strong> (network fee reserve)</p>
    <p class="muted small">Read live from Horizon — this is where resolve() sends its platform fee cut directly, so it's independently verifiable on-chain.</p>
    ${
      treasury.fiatPool
        ? `<hr />
    <p>Fiat pool address: <span title="${treasury.fiatPool.address}">${truncateAddress(treasury.fiatPool.address)}</span></p>
    <p>USDC balance: <strong>${treasury.fiatPool.usdcBalance}</strong></p>
    <p class="muted small">Backs every API-key/Stripe question (billing.js) — watch this for low-float 503s before customers hit them.</p>`
        : '<hr /><p class="muted small">Fiat pool not configured (FIAT_POOL_ADDRESS unset) — the API-key onramp is disabled.</p>'
    }
  `;
}

function renderBlockchain() {
  const panel = document.getElementById('blockchain-panel');
  panel.innerHTML = `
    <p class="muted small">Static config this backend was started with — not a live query.</p>
    <p>Backend: <span class="muted small">${BACKEND_URL}</span></p>
  `;
}

async function renderFraud() {
  const tbody = document.getElementById('fraud-body');
  const { workers } = await fetchAdmin('/admin/workers');
  const flagged = workers
    .filter((w) => w.established && w.matchRatio !== null)
    .sort((a, b) => a.matchRatio - b.matchRatio);
  if (flagged.length === 0) {
    replaceRows(tbody, [emptyRow(4, 'No established workers yet.')]);
    return;
  }
  replaceRows(
    tbody,
    flagged.map((w) =>
      row([
        td(truncateAddress(w.workerId), { title: w.workerId }),
        td(formatRatio(w.matchRatio)),
        td(w.totalAnswers),
        td(`${w.stake} USDC`),
      ]),
    ),
  );
}

async function renderKyc() {
  const tbody = document.getElementById('kyc-body');
  const { customers } = await fetchAdmin('/admin/kyc');
  if (customers.length === 0) {
    replaceRows(tbody, [emptyRow(4, 'No self-reported KYC status yet.')]);
    return;
  }
  // status/tier are fully self-reported via POST /anchor/report by any
  // session-holding caller — the single most attacker-reachable data this
  // console renders. Never interpolated into HTML.
  replaceRows(
    tbody,
    customers.map((c) =>
      row([
        td(truncateAddress(c.address), { title: c.address }),
        td(c.status || '—'),
        td(c.tier || '—'),
        td(new Date(c.reportedAt).toLocaleString(), { className: 'muted small' }),
      ]),
    ),
  );
}

async function renderPayouts() {
  const tbody = document.getElementById('payouts-body');
  const { payouts } = await fetchAdmin('/admin/payouts');
  if (payouts.length === 0) {
    replaceRows(tbody, [emptyRow(4, 'No self-reported payouts yet.')]);
    return;
  }
  // amount/assetCode/status are also fully self-reported via POST
  // /anchor/report — same reasoning as renderKyc above.
  replaceRows(
    tbody,
    payouts.map((p) =>
      row([
        td(truncateAddress(p.address), { title: p.address }),
        td(`${p.amount || '—'} ${p.assetCode || ''}`),
        td(p.status || '—'),
        td(new Date(p.reportedAt).toLocaleString(), { className: 'muted small' }),
      ]),
    ),
  );
}

// ---------------------------------------------------------------------
// Worker pool whitelists (issue #36). Whitelist-gated dispatch for private
// worker pools is assumed to be backend-owned enforcement (dispatch.js) —
// this view only manages the whitelist data itself, against an assumed
// contract (the authoritative shape is the backend agent's to set):
//   GET    /admin/worker-pools                          -> { pools: [{ id, name, whitelist: string[] }] }
//   POST   /admin/worker-pools/:poolId/whitelist         { address } -> { whitelist: string[] }
//   DELETE /admin/worker-pools/:poolId/whitelist/:address            -> { whitelist: string[] }
// ---------------------------------------------------------------------

let poolsCache = [];
let selectedPoolId = null;

// Mirrors the StrKey.isValidEd25519PublicKey check main.js already uses for
// the optional withdraw-beneficiary field — reject malformed input before
// it ever reaches the backend.
function isValidWorkerAddress(address) {
  return /^G[A-Z2-7]{55}$/.test(address);
}

async function renderPools() {
  const poolsSelect = document.getElementById('pools-select');
  const { pools } = await fetchAdmin('/admin/worker-pools');
  poolsCache = pools || [];
  poolsSelect.replaceChildren(
    ...poolsCache.map((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      return opt;
    }),
  );
  if (poolsCache.length === 0) {
    selectedPoolId = null;
    replaceRows(document.getElementById('pools-body'), [emptyRow(2, 'No worker pools configured yet.')]);
    return;
  }
  selectedPoolId = poolsCache[0].id;
  poolsSelect.value = selectedPoolId;
  renderPoolWhitelist();
}

function renderPoolWhitelist() {
  const tbody = document.getElementById('pools-body');
  const pool = poolsCache.find((p) => p.id === selectedPoolId);
  const whitelist = (pool && pool.whitelist) || [];
  if (whitelist.length === 0) {
    replaceRows(tbody, [emptyRow(2, 'No whitelisted workers in this pool yet.')]);
    return;
  }
  replaceRows(
    tbody,
    whitelist.map((address) => {
      const btnRemove = document.createElement('button');
      btnRemove.textContent = 'Remove';
      btnRemove.className = 'small';
      btnRemove.addEventListener('click', () => removeFromWhitelist(address));
      const actionCell = document.createElement('td');
      actionCell.appendChild(btnRemove);
      return row([td(address, { title: address }), actionCell]);
    }),
  );
}

document.getElementById('pools-select').addEventListener('change', (evt) => {
  selectedPoolId = evt.target.value;
  renderPoolWhitelist();
});

document.getElementById('pool-add-form').addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const status = document.getElementById('pools-status');
  const input = document.getElementById('pool-add-address');
  const address = input.value.trim();
  if (!selectedPoolId) {
    status.textContent = 'No pool selected.';
    return;
  }
  if (!isValidWorkerAddress(address)) {
    status.textContent = 'Not a valid Stellar worker address.';
    return;
  }
  const pool = poolsCache.find((p) => p.id === selectedPoolId);
  if (pool && (pool.whitelist || []).includes(address)) {
    status.textContent = 'That address is already whitelisted for this pool.';
    return;
  }
  try {
    const { whitelist } = await fetchAdmin(`/admin/worker-pools/${encodeURIComponent(selectedPoolId)}/whitelist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (pool) pool.whitelist = whitelist;
    input.value = '';
    status.textContent = 'Added.';
    renderPoolWhitelist();
  } catch (err) {
    if (err.message !== 'unauthorized') status.textContent = `Could not add address: ${err.message}`;
  }
});

async function removeFromWhitelist(address) {
  const status = document.getElementById('pools-status');
  try {
    const { whitelist } = await fetchAdmin(
      `/admin/worker-pools/${encodeURIComponent(selectedPoolId)}/whitelist/${encodeURIComponent(address)}`,
      { method: 'DELETE' },
    );
    const pool = poolsCache.find((p) => p.id === selectedPoolId);
    if (pool) pool.whitelist = whitelist;
    status.textContent = 'Removed.';
    renderPoolWhitelist();
  } catch (err) {
    if (err.message !== 'unauthorized') status.textContent = `Could not remove address: ${err.message}`;
  }
}

const VIEWS = {
  overview: renderOverview,
  transactions: renderTransactions,
  workers: renderWorkers,
  payers: renderPayers,
  pools: renderPools,
  fees: renderFees,
  treasury: renderTreasury,
  kyc: renderKyc,
  payouts: renderPayouts,
  blockchain: renderBlockchain,
  fraud: renderFraud,
};

async function selectView(name) {
  document.querySelectorAll('.admin-nav-link[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === name));
  document.querySelectorAll('.admin-view').forEach((el) => el.classList.toggle('active', el.id === `view-${name}`));

  if (!loaded.has(name)) {
    loaded.add(name);
    try {
      await VIEWS[name]();
    } catch (err) {
      if (err.message !== 'unauthorized') console.error(`failed to load ${name}:`, err);
      loaded.delete(name);
    }
  }
}

document.querySelectorAll('.admin-nav-link[data-view]').forEach((el) => {
  el.addEventListener('click', () => selectView(el.dataset.view));
});

document.getElementById('btn-admin-login').addEventListener('click', () => {
  const token = document.getElementById('admin-token-input').value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  showShell();
  selectView('overview');
});

if (localStorage.getItem(TOKEN_KEY)) {
  showShell();
  selectView('overview');
} else {
  showLogin();
}
