import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderMarkdown } from '../src/markdown.js';
import { renderRow, renderActivityItem, workerProfileUrl } from '../src/leaderboard.js';
import * as leadermock from '../src/Leadermock.js';
import { applyOnboardingVariant, ONBOARDING_EXPERIMENT } from '../src/abTest.js';
import {
  enqueueOfflineAnswer,
  flushOfflineAnswerQueue,
  registerAnswerQueueSync,
  getQueuedAnswers,
  ANSWER_SYNC_TAG,
} from '../src/answerQueue.js';
import { handleAsk, checkRateLimit, formatReply } from '../../demo-agent/sandbox-ask.js';
import * as botModule from '../../demo-agent/bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeMockDom() {
  function createEl(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      innerHTML: '',
      title: '',
      href: '',
      children: [],
      attributes: new Map(),
      append(...nodes) {
        for (const n of nodes) {
          if (typeof n === 'string') {
            this.textContent += n;
          } else if (n) {
            this.children.push(n);
            this.textContent += n.textContent || '';
          }
        }
      },
      appendChild(child) {
        this.children.push(child);
        this.textContent += child.textContent || '';
        return child;
      },
      setAttribute(k, v) {
        this.attributes.set(k, String(v));
      },
      getAttribute(k) {
        return this.attributes.get(k) ?? null;
      },
      querySelector(sel) {
        if (sel === 'p') return this.pEl;
        if (sel === '#btn-onboard') return this.btnEl;
        return null;
      },
    };
    return el;
  }
  return { createEl };
}

test('renderMarkdown preserves literal markdown characters inside code spans (#220, #221)', () => {
  const target = { innerHTML: '' };
  const html = renderMarkdown(target, 'Use `*a*` and `**b**` in **bold** and *italic*\nnext line');
  assert.equal(
    html,
    'Use <code>*a*</code> and <code>**b**</code> in <strong>bold</strong> and <em>italic</em><br>next line'
  );
  assert.equal(target.innerHTML, html);
});

test('leaderboard renderRow and renderActivityItem format USDC amounts without throwing (#230, #235, #219)', () => {
  const { createEl } = makeMockDom();
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => createEl(tag),
  };

  try {
    const tr = renderRow(
      {
        workerId: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ23456723456723456723456723456',
        matched: 9,
        totalAnswers: 10,
        matchRatio: 0.9,
        stake: 125.5,
      },
      1
    );
    assert.equal(tr.children.length, 5);
    assert.match(tr.children[4].textContent, /125\.50\s*USDC/);
    assert.equal(
      workerProfileUrl('GABC'),
      '/worker.html?id=GABC'
    );

    const li = renderActivityItem({
      outcome: 'resolved',
      category: 'crypto',
      tier: 'standard',
      amount: 0.25,
    });
    assert.match(li.textContent, /0\.25\s*USDC/);

    // Leadermock re-exports canonical leaderboard functions (#219).
    assert.equal(leadermock.renderRow, renderRow);
    assert.equal(leadermock.renderActivityItem, renderActivityItem);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('abTest applyOnboardingVariant assigns and applies onboarding variant (#218)', () => {
  const { createEl } = makeMockDom();
  const panel = createEl('section');
  panel.pEl = createEl('p');
  panel.btnEl = createEl('button');
  const logs = [];

  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === 'panel-onboard' ? panel : null),
  };
  try {
    const variant = applyOnboardingVariant('GWORKER123', (msg) => logs.push(msg));
    assert.ok(Object.keys(ONBOARDING_EXPERIMENT.variants).includes(variant));
    assert.equal(panel.getAttribute('data-ab-variant'), variant);
    assert.equal(logs.length, 1);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('answerQueue enqueues offline answers, registers Background Sync, and flushes on FLUSH_ANSWER_QUEUE (#234, #239, #240)', async () => {
  const storeMap = new Map();
  const storage = {
    getItem: (k) => storeMap.get(k) ?? null,
    setItem: (k, v) => storeMap.set(k, v),
  };
  const registeredTags = [];
  const listeners = new Map();
  const serviceWorker = {
    ready: Promise.resolve({
      sync: {
        register: async (tag) => {
          registeredTags.push(tag);
        },
      },
    }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };

  await enqueueOfflineAnswer(
    {
      questionId: 'q-101',
      workerId: 'GWORKER1',
      answer: 'Paris',
      deadlineAt: Date.now() + 60_000,
    },
    { storage, serviceWorker }
  );

  assert.deepEqual(registeredTags, [ANSWER_SYNC_TAG]);
  assert.equal(getQueuedAnswers(storage).length, 1);

  const submitted = [];
  const cleanup = registerAnswerQueueSync({
    submitAnswer: async (item) => {
      submitted.push(item);
      return true;
    },
    storage,
    serviceWorker,
    win: { addEventListener() {}, removeEventListener() {} },
  });

  let acked = false;
  await listeners.get('message')({
    data: { type: 'FLUSH_ANSWER_QUEUE' },
    ports: [{ postMessage: (msg) => { acked = Boolean(msg?.ok); } }],
  });

  assert.equal(acked, true);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].questionId, 'q-101');
  assert.equal(getQueuedAnswers(storage).length, 0);
  cleanup();

  // Verify sw.js contains explicit SCAFFOLDING ONLY disclosure (#240).
  const swSource = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');
  assert.match(swSource, /SCAFFOLDING ONLY/);
});

test('demo-agent sandbox-ask.js and bot.js export valid ESM symbols (#231, #232, #236, #237)', () => {
  assert.equal(typeof handleAsk, 'function');
  assert.equal(typeof checkRateLimit, 'function');
  assert.equal(typeof botModule.handleAsk, 'function');
  assert.equal(formatReply({ answer: '42' }), '42');
  const limit = checkRateLimit('test-user-wave12');
  assert.equal(limit.allowed, true);
});
