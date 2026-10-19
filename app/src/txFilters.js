import { stroopsFromUsdcInput } from './units.js';

// Client-side filters for the admin Transactions view. GET
// /admin/transactions only takes `limit` today, so these run over the
// already-loaded window (most recent 100 rows), not the full history.
// Server-side filtering is a backend follow-up.

function parseAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  try {
    return stroopsFromUsdcInput(value);
  } catch {
    return null; // ignore malformed bounds rather than hiding every row
  }
}

// <input type="date"> yields "YYYY-MM-DD"; interpret as a local calendar
// day so "to" is inclusive of the whole day.
function parseDay(value, endOfDay) {
  if (!value) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return null;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
}

/**
 * @param {Array<object>} transactions rows from /admin/transactions
 * @param {{from?: string, to?: string, minUsdc?: string, maxUsdc?: string, status?: string, outcome?: string}} filters
 */
export function filterTransactions(transactions, filters = {}) {
  const from = parseDay(filters.from, false);
  const to = parseDay(filters.to, true);
  const min = parseAmount(filters.minUsdc);
  const max = parseAmount(filters.maxUsdc);
  const { status, outcome } = filters;

  return transactions.filter((t) => {
    if (status && (t.status || '') !== status) return false;
    if (outcome && (t.outcome || '') !== outcome) return false;

    if (from !== null || to !== null) {
      const created = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
      if (Number.isNaN(created)) return false;
      if (from !== null && created < from) return false;
      if (to !== null && created > to) return false;
    }

    if (min !== null || max !== null) {
      let amount;
      try {
        amount = BigInt(t.amountStroops);
      } catch {
        return false;
      }
      if (min !== null && amount < min) return false;
      if (max !== null && amount > max) return false;
    }
    return true;
  });
}

/** Distinct non-empty values of `key` across rows, sorted — feeds the dropdowns. */
export function distinctValues(transactions, key) {
  return [...new Set(transactions.map((t) => t[key]).filter(Boolean).map(String))].sort();
}
