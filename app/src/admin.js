import { filterTransactions, distinctValues } from './txFilters.js';
import { downloadCsv } from './csv.js';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const TOKEN_KEY = 'arbiter-admin-token';
const DENSITY_KEY = 'arbiter-admin-density';

function applyDensity(compact) {
  document.getElementById('admin-shell').classList.toggle('density-compact', compact);
  const toggle = document.getElementById('density-toggle');
  toggle.classList.toggle('active', compact);
  toggle.setAttribute('aria-pressed', String(compact));
}

applyDensity(localStorage.getItem(DENSITY_KEY) === 'compact');
document.getElementById('density-toggle').addEventListener('click', () => {
  const compact = !document.getElementById('admin-shell').classList.contains('density-compact');
  localStorage.setItem(DENSITY_KEY, compact ? 'compact' : 'comfortable');
  applyDensity(compact);
});

// Low-balance thresholds for the treasury / fiat-pool figures. These are the
// numbers that page someone when they dip — the whole point of the admin
// console's overview. Kept here (not inline in the HTML) so the renderers
// below can flag them consistently.
const LOW_BALANCE_USDC = 100;
const LOW_BALANCE_XLM = 50;

function truncateAddress(id) {
  if (!id || id.length <= 16 || !id.startsWith('G')) return id || '—';
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

function formatRatio(ratio) {
  return ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(1)}%`;
}

// A balance figure that reads as "this is the number that pages someone"
// when it's low, and as a routine figure otherwise. Uses the shared token
// classes from #146 (balance / balance-low) rather than standalone values.
function balanceFigure(value, { low = false, unit = 'USDC' } = {}) {
  const el = document.createElement('span');
  el.className = low ? 'balance balance-low' : 'balance';
  el.textContent = `${value} ${unit}`;
  return el;
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

const TX_LIMIT = 100;
let loadedTransactions = [];

function readTxFilters() {
  const val = (id) => document.getElementById(id).value;
  return {
    from: val('tx-filter-from'),
    to: val('tx-filter-to'),
    minUsdc: val('tx-filter-min'),
    maxUsdc: val('tx-filter-max'),
    status: val('tx-filter-status'),
    outcome: val('tx-filter-outcome'),
  };
}

function fillSelect(id, values) {
  const select = document.getElementById(id);
  const current = select.value;
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All';
  select.replaceChildren(
    all,
    ...values.map((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      return opt;
    }),
  );
  if (values.includes(current)) select.value = current;
}

function renderTxRows() {
  const tbody = document.getElementById('tx-body');
  const summary = document.getElementById('tx-filter-summary');
  const filters = readTxFilters();
  const active = Object.values(filters).some((v) => v !== '');
  const transactions = filterTransactions(loadedTransactions, filters);

  const scope = `the most recent ${loadedTransactions.length} loaded transactions (up to ${TX_LIMIT}), not the full history`;
  summary.textContent = active
    ? `Showing ${transactions.length} of ${scope}. Older matches may exist.`
    : `Filters apply only to ${scope}.`;

  if (loadedTransactions.length === 0) {
    replaceRows(tbody, [emptyRow(6, 'No transactions yet.')]);
    return;
  }
  if (transactions.length === 0) {
    replaceRows(tbody, [emptyRow(6, `No transactions match these filters within the most recent ${loadedTransactions.length}.`)]);
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

async function renderTransactions() {
  const { transactions } = await fetchAdmin(`/admin/transactions?limit=${TX_LIMIT}`);
  loadedTransactions = transactions;
  fillSelect('tx-filter-status', distinctValues(transactions, 'status'));
  fillSelect('tx-filter-outcome', distinctValues(transactions, 'outcome'));
  renderTxRows();
}

document.getElementById('tx-filters').addEventListener('input', renderTxRows);
document.getElementById('tx-filter-reset').addEventListener('click', () => {
  document.querySelectorAll('#tx-filters input, #tx-filters select').forEach((el) => {
    el.value = '';
  });
  renderTxRows();
});

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
    panel.replaceChildren();
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = 'PLATFORM_ADDRESS is not configured on the backend.';
    panel.appendChild(note);
    return;
  }

  const nodes = [];

  const platformLine = document.createElement('p');
  platformLine.append('Platform address: ');
  const platformAddr = document.createElement('span');
  platformAddr.title = treasury.platformAddress;
  platformAddr.textContent = truncateAddress(treasury.platformAddress);
  platformLine.appendChild(platformAddr);
  nodes.push(platformLine);

  const usdcLine = document.createElement('p');
  usdcLine.append('USDC balance: ');
  usdcLine.appendChild(
    balanceFigure(treasury.usdcBalance, { low: Number(treasury.usdcBalance) < LOW_BALANCE_USDC }),
  );
  nodes.push(usdcLine);

  const xlmLine = document.createElement('p');
  xlmLine.append('XLM balance: ');
  xlmLine.appendChild(
    balanceFigure(treasury.xlmBalance, { low: Number(treasury.xlmBalance) < LOW_BALANCE_XLM, unit: 'XLM' }),
  );
  xlmLine.append(' (network fee reserve)');
  nodes.push(xlmLine);

  const horizonNote = document.createElement('p');
  horizonNote.className = 'muted small';
  horizonNote.textContent =
    "Read live from Horizon — this is where resolve() sends its platform fee cut directly, so it's independently verifiable on-chain.";
  nodes.push(horizonNote);

  nodes.push(document.createElement('hr'));

  if (treasury.fiatPool) {
    const poolLine = document.createElement('p');
    poolLine.append('Fiat pool address: ');
    const poolAddr = document.createElement('span');
    poolAddr.title = treasury.fiatPool.address;
    poolAddr.textContent = truncateAddress(treasury.fiatPool.address);
    poolLine.appendChild(poolAddr);
    nodes.push(poolLine);

    const poolUsdcLine = document.createElement('p');
    poolUsdcLine.append('USDC balance: ');
    poolUsdcLine.appendChild(
      balanceFigure(treasury.fiatPool.usdcBalance, {
        low: Number(treasury.fiatPool.usdcBalance) < LOW_BALANCE_USDC,
      }),
    );
    nodes.push(poolUsdcLine);

    const poolNote = document.createElement('p');
    poolNote.className = 'muted small';
    poolNote.textContent =
      'Backs every API-key/Stripe question (billing.js) — watch this for low-float 503s before customers hit them.';
    nodes.push(poolNote);
  } else {
    const noPool = document.createElement('p');
    noPool.className = 'muted small';
    noPool.textContent =
      'Fiat pool not configured (FIAT_POOL_ADDRESS unset) — the API-key onramp is disabled.';
    nodes.push(noPool);
  }

  panel.replaceChildren(...nodes);
}

function renderBlockchain() {
  const panel = document.getElementById('blockchain-panel');
  const note = document.createElement('p');
  note.className = 'muted small';
  note.textContent = 'Static config this backend was started with — not a live query.';
  const backendLine = document.createElement('p');
  backendLine.append('Backend: ');
  const backendVal = document.createElement('span');
  backendVal.className = 'muted small';
  backendVal.textContent = BACKEND_URL;
  backendLine.appendChild(backendVal);
  panel.replaceChildren(note, backendLine);
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
        td(truncateAddress(w.workerId), { title: w.worker

/* … truncated 2897 chars — edit only what you need near the top … */
