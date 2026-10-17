import test from 'node:test';
import assert from 'node:assert/strict';
import { questionStatus, filterQuestions } from '../src/questionFilter.js';

test('questionStatus derives in-progress, resolved, and refunded states (#242)', () => {
  assert.equal(questionStatus({ status: 'holding' }), 'in-progress');
  assert.equal(questionStatus({ status: 'awaiting_workers' }), 'in-progress');
  assert.equal(questionStatus({ status: 'settled', outcome: 'resolved' }), 'resolved');
  assert.equal(questionStatus({ status: 'settled', outcome: 'refunded' }), 'refunded');
  assert.equal(questionStatus({ status: 'settled', outcome: 'cancelled' }), 'refunded');
});

test('filterQuestions filters by derived status and case-insensitive query across question and questionId (#242)', () => {
  const sample = [
    { questionId: 'Q-101', question: 'What is the Stellar ledger close time?', status: 'awaiting_workers' },
    { questionId: 'Q-202', question: 'Did Soroban mainnet launch in 2024?', status: 'settled', outcome: 'resolved' },
    { questionId: 'Q-303', question: 'Unanswered edge case', status: 'settled', outcome: 'refunded' },
  ];

  assert.equal(filterQuestions(sample).length, 3);
  assert.deepEqual(
    filterQuestions(sample, { status: 'in-progress' }).map((q) => q.questionId),
    ['Q-101'],
  );
  assert.deepEqual(
    filterQuestions(sample, { status: 'resolved' }).map((q) => q.questionId),
    ['Q-202'],
  );
  assert.deepEqual(
    filterQuestions(sample, { status: 'refunded' }).map((q) => q.questionId),
    ['Q-303'],
  );
  assert.deepEqual(
    filterQuestions(sample, { query: '  SOROBAN ' }).map((q) => q.questionId),
    ['Q-202'],
  );
  assert.deepEqual(
    filterQuestions(sample, { query: 'q-303' }).map((q) => q.questionId),
    ['Q-303'],
  );
  assert.deepEqual(
    filterQuestions(sample, { query: 'soroban', status: 'in-progress' }),
    [],
  );
});
