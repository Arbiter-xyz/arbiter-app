import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount,
  parseDay,
  filterTransactions,
  distinctValues,
} from '../src/txFilters.js';

test('parseDay computes local start-of-day and end-of-day timestamps and rejects invalid dates (#243)', () => {
  const start = parseDay('2026-05-10', false);
  const end = parseDay('2026-05-10', true);
  assert.equal(start, new Date(2026, 4, 10, 0, 0, 0, 0).getTime());
  assert.equal(end, new Date(2026, 4, 10, 23, 59, 59, 999).getTime());
  assert.equal(end - start, 86_400_000 - 1);

  assert.equal(parseDay('', false), null);
  assert.equal(parseDay(null, true), null);
  assert.equal(parseDay('2026-02-31', false), null, 'calendar rollover date must be rejected');
  assert.equal(parseDay('2026-13-01', true), null);
  assert.equal(parseDay('not-a-date', false), null);
});

test('parseAmount converts valid USDC strings to stroops and returns null on malformed inputs (#243)', () => {
  assert.equal(parseAmount('1.5'), 15_000_000n);
  assert.equal(parseAmount('0'), 0n);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('invalid'), null);
});

test('filterTransactions enforces inclusive date/amount boundaries and distinctValues sorts unique keys (#243)', () => {
  const dayStartIso = new Date(2026, 4, 10, 0, 0, 0, 0).toISOString();
  const dayEndIso = new Date(2026, 4, 10, 23, 59, 59, 999).toISOString();
  const nextDayIso = new Date(2026, 4, 11, 0, 0, 0, 0).toISOString();

  const rows = [
    { id: 'tx1', status: 'settled', outcome: 'resolved', createdAt: dayStartIso, amountStroops: '10000000' },
    { id: 'tx2', status: 'settled', outcome: 'refunded', createdAt: dayEndIso, amountStroops: '25000000' },
    { id: 'tx3', status: 'pending', outcome: null, createdAt: nextDayIso, amountStroops: '50000000' },
  ];

  const onMay10 = filterTransactions(rows, { from: '2026-05-10', to: '2026-05-10' });
  assert.deepEqual(
    onMay10.map((r) => r.id),
    ['tx1', 'tx2'],
  );

  const inRange = filterTransactions(rows, { minUsdc: '1.0', maxUsdc: '2.5' });
  assert.deepEqual(
    inRange.map((r) => r.id),
    ['tx1', 'tx2'],
  );

  const byStatusAndOutcome = filterTransactions(rows, { status: 'settled', outcome: 'resolved' });
  assert.deepEqual(
    byStatusAndOutcome.map((r) => r.id),
    ['tx1'],
  );

  assert.deepEqual(distinctValues(rows, 'status'), ['pending', 'settled']);
  assert.deepEqual(distinctValues(rows, 'outcome'), ['refunded', 'resolved']);
});
