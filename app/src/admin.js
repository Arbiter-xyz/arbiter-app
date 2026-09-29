import { initSessionReplay } from './sessionReplay.js';

initSessionReplay({ page: 'admin' });

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const TOKEN_KEY = 'arbiter-admin-token';
const LAYOUT_KEY = 'arbiter-admin-layout';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Views each role may open. A role missing from this map (or no role system
// on the backend at all) keeps today's single-token full access.
const ROLE_VIEWS = {
  readonly: ['overview', 'transactions', 'workers', 'payers', 'blockchain', 'fraud'],
};
let allowedViews = null; // null = unrestricted

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

async function fetchAdmin(path) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    showLogin('That token was rejected — try again.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
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
  const canFees = canView('fees');
  const canTreasury = canView('treasury');
  const [fees, treasury, workers, payers] = await Promise.all([
    canFees ? fetchAdmin('/admin/fees') : null,
    canTreasury ? fetchAdmin('/admin/treasury') : null,
    fetchAdmin('/admin/workers'),
    fetchAdmin('/admin/payers'),
  ]);
  document.getElementById('ov-fees').textContent = fees ? `${fees.totalFeeRevenue} USDC (${fees.resolvedCount})` : 'restricted';
  document.getElementById('ov-treasury-usdc').textContent = !treasury ? 'restricted' : treasury.configured ? `${treasury.usdcBalance}` : 'not configured';
  document.getElementById('ov-treasury-xlm').textContent = !treasury ? 'restricted' : treasury.configured ? `${treasury.xlmBalance}` : 'not configured';
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

// Inline-SVG histogram of established workers' match ratios (10 buckets of
// 10%). Colors come only from CSS classes backed by the --chart-* custom
// properties in style.css, so the chart follows the light/dark theme.
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderMatchRatioChart(container, ratios, flagBelow = 0.5) {
  const buckets = new Array(10).fill(0);
  ratios.forEach((r) => buckets[Math.min(9, Math.floor(r * 10))]++);
  const max = Math.max(1, ...buckets);
  const W = 400;
  const H = 140;
  const pad = { top: 10, bottom: 20, left: 24 };
  const plotH = H - pad.top - pad.bottom;
  const bw = (W - pad.left) / 10;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Worker match-ratio distribution' });
  svg.append(svgEl('line', { class: 'grid', x1: pad.left, x2: W, y1: pad.top + plotH, y2: pad.top + plotH }));
  svg.append(svgEl('line', { class: 'grid', x1: pad.left, x2: W, y1: pad.top, y2: pad.top }));
  const maxLabel = svgEl('text', { x: pad.left - 4, y: pad.top + 4, 'text-anchor': 'end' });
  maxLabel.textContent = max;
  svg.append(maxLabel);

  buckets.forEach((count, i) => {
    const h = (count / max) * plotH;
    const x = pad.left + i * bw + 2;
    const bar = svgEl('rect', {
      class: (i + 1) / 10 <= flagBelow ? 'bar flag' : 'bar',
      x,
      y: pad.top + plotH - h,
      width: bw - 4,
      height: h,
    });
    const tip = svgEl('title', {});
    tip.textContent = `${i * 10}–${(i + 1) * 10}%: ${count} worker(s)`;
    bar.append(tip);
    svg.append(bar);
    if (i % 2 === 0) {
      const label = svgEl('text', { x: x + (bw - 4) / 2, y: H - 6, 'text-anchor': 'middle' });
      label.textContent = `${i * 10}%`;
      svg.append(label);
    }
  });
  container.replaceChildren(svg);
}

async function renderFraud() {
  const tbody = document.getElementById('fraud-body');
  const { workers } = await fetchAdmin('/admin/workers');
  renderMatchRatioChart(
    document.getElementById('fraud-chart'),
    workers.filter((w) => w.established && w.matchRatio !== null).map((w) => w.matchRatio),
  );
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

async function renderAuditLog() {
  const tbody = document.getElementById('audit-body');
  let entries;
  try {
    ({ entries } = await fetchAdmin('/admin/audit'));
  } catch (err) {
    if (err.message === 'unauthorized') throw err;
    replaceRows(tbody, [emptyRow(5, 'Audit log unavailable — this backend does not expose GET /admin/audit yet.')]);
    return;
  }
  if (!entries || entries.length === 0) {
    replaceRows(tbody, [emptyRow(5, 'No admin actions recorded yet.')]);
    return;
  }
  // Same textContent-only rendering as every other view — never innerHTML.
  replaceRows(
    tbody,
    entries.map((e) =>
      row([
        td(e.at ? new Date(e.at).toLocaleString() : '—', { className: 'muted small' }),
        td(e.actor || '—'),
        td(e.action || '—'),
        td(truncateAddress(e.target), { title: e.target || '' }),
        td(e.detail === undefined ? '—' : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)),
      ]),
    ),
  );
}

const VIEWS = {
  overview: renderOverview,
  transactions: renderTransactions,
  workers: renderWorkers,
  payers: renderPayers,
  fees: renderFees,
  treasury: renderTreasury,
  kyc: renderKyc,
  payouts: renderPayouts,
  blockchain: renderBlockchain,
  fraud: renderFraud,
  audit: renderAuditLog,
};

function canView(name) {
  return allowedViews === null || allowedViews.includes(name);
}

// ---------------------------------------------------------------------
// Role-based access. GET /admin/whoami returning { role } narrows the nav;
// a backend without it (404) keeps single-token full access unchanged.
// ---------------------------------------------------------------------

async function loadRole() {
  const token = localStorage.getItem(TOKEN_KEY);
  let role = null;
  try {
    const res = await fetch(`${BACKEND_URL}/admin/whoami`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) ({ role } = await res.json());
  } catch {
    // no role system reachable — fall through to full access
  }
  allowedViews = role && ROLE_VIEWS[role] ? ROLE_VIEWS[role] : null;
  const label = document.getElementById('admin-role');
  label.textContent = role ? `Role: ${role}` : '';
  label.classList.toggle('hidden', !role);
}

// ---------------------------------------------------------------------
// Layout preference: per-group order and hidden views, in localStorage.
// No saved preference = the static default order from admin.html.
// ---------------------------------------------------------------------

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    return { order: saved?.order || [], hidden: saved?.hidden || [] };
  } catch {
    return { order: [], hidden: [] };
  }
}

function saveLayout(layout) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

function navLinks() {
  return [...document.querySelectorAll('.admin-nav-link[data-view]')];
}

function applyLayout() {
  const { order, hidden } = loadLayout();
  document.querySelectorAll('.admin-nav-group').forEach((group) => {
    const links = [...group.querySelectorAll('.admin-nav-link[data-view]')];
    const rank = (el) => {
      const i = order.indexOf(el.dataset.view);
      return i === -1 ? order.length + links.indexOf(el) : i;
    };
    links.sort((a, b) => rank(a) - rank(b));
    const anchor = group.querySelector('a.admin-nav-link');
    links.forEach((el) => group.insertBefore(el, anchor));
  });
  navLinks().forEach((el) => {
    el.classList.toggle('hidden', !canView(el.dataset.view) || hidden.includes(el.dataset.view));
  });
}

function renderCustomizePanel() {
  const panel = document.getElementById('admin-customize-panel');
  const layout = loadLayout();
  const links = navLinks().filter((el) => canView(el.dataset.view));
  const rows = links.map((el) => {
    const view = el.dataset.view;
    const wrap = document.createElement('div');
    wrap.className = 'admin-customize-row';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !layout.hidden.includes(view);
    box.addEventListener('change', () => {
      layout.hidden = box.checked ? layout.hidden.filter((v) => v !== view) : [...layout.hidden, view];
      saveLayout(layout);
      applyLayout();
    });
    label.append(box, ` ${el.textContent}`);
    const move = (dir) => {
      const current = navLinks().map((l) => l.dataset.view);
      const siblings = [...el.parentElement.querySelectorAll('.admin-nav-link[data-view]')].map((l) => l.dataset.view);
      const i = siblings.indexOf(view);
      const j = i + dir;
      if (j < 0 || j >= siblings.length) return;
      [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
      layout.order = [...siblings, ...current.filter((v) => !siblings.includes(v))];
      saveLayout(layout);
      applyLayout();
      renderCustomizePanel();
    };
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.addEventListener('click', () => move(-1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.addEventListener('click', () => move(1));
    wrap.append(label, up, down);
    return wrap;
  });
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'admin-nav-customize';
  reset.textContent = 'Reset to default';
  reset.addEventListener('click', () => {
    localStorage.removeItem(LAYOUT_KEY);
    window.location.reload();
  });
  panel.replaceChildren(...rows, reset);
}

document.getElementById('btn-admin-customize').addEventListener('click', (e) => {
  const panel = document.getElementById('admin-customize-panel');
  const open = panel.classList.toggle('hidden') === false;
  e.currentTarget.setAttribute('aria-expanded', String(open));
  if (open) renderCustomizePanel();
});

function firstVisibleView() {
  return navLinks().find((el) => !el.classList.contains('hidden'))?.dataset.view || 'overview';
}

async function enterConsole() {
  showShell();
  await loadRole();
  applyLayout();
  selectView(canView('overview') && !loadLayout().hidden.includes('overview') ? 'overview' : firstVisibleView());
}

async function selectView(name) {
  // Fail closed: a role without access never triggers the view's fetches.
  if (!canView(name)) return;
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
  enterConsole();
});

if (localStorage.getItem(TOKEN_KEY)) {
  enterConsole();
} else {
  showLogin();
}
