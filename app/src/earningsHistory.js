// Frontend-only tax record. This is intentionally browser-local: without a
// server ledger it cannot claim to reconstruct activity from other devices.
const STORAGE_KEY = 'arbiter:local-earnings-history:v1';

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function save(records) { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
function csv(records) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return ['Date,Type,Amount (USDC),Question reference,Transaction reference', ...records.map((record) => [record.date, record.type, record.amount, record.question, record.transaction].map(escape).join(','))].join('\n');
}

const form = document.getElementById('earnings-history-form');
const exportButton = document.getElementById('btn-export-earnings');
const total = document.getElementById('earnings-history-total');

function renderTotal() {
  const records = load();
  const value = records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  total.textContent = `${records.length} local record${records.length === 1 ? '' : 's'} · ${value.toFixed(2)} USDC`;
}

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const amount = Number(data.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) return;
  const records = load();
  records.push({
    date: data.get('date') || new Date().toISOString().slice(0, 10),
    type: data.get('type'), amount: amount.toFixed(7),
    question: data.get('question') || '', transaction: data.get('transaction') || '',
  });
  save(records); form.reset(); renderTotal();
});

exportButton?.addEventListener('click', () => {
  const blob = new Blob([csv(load())], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `arbiter-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

renderTotal();
