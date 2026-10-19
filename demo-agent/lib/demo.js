import { Agent } from 'undici';
import { env, submitPaymentDirect, sleep } from './stellar.js';

/** Shared building blocks for in-process demo scenarios (see
 * run-scenario.js). Signing/submission stays in stellar.js — this only
 * wraps the HTTP side of the oracle and worker protocols. */

export async function postOracle(body, headers = {}) {
  const res = await fetch(`${env.backendUrl}/oracle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

export async function pollJob(jobId, { intervalMs = 2000, timeoutMs = 120_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${env.backendUrl}/oracle/${jobId}`);
    const job = await res.json();
    if (job.status === 'settled') return job;
    await sleep(intervalMs);
  }
  throw new Error(`job ${jobId} did not settle within ${timeoutMs}ms`);
}

/** Full 402 → pay → 202 → poll flow; returns the challenge and settled job. */
export async function askAndSettle(payer, { question, tier = 'standard', category } = {}) {
  const challenge = await postOracle({ question, tier, category });
  if (challenge.status !== 402) throw new Error(`expected 402, got ${challenge.status}: ${JSON.stringify(challenge.body)}`);
  const paymentTx = await submitPaymentDirect(payer, challenge.body.questionId, challenge.body.amountStroops);
  const fulfil = await postOracle({ question }, { 'X-Payment-Tx': paymentTx, 'X-Question-Id': challenge.body.questionId });
  if (fulfil.status !== 202) throw new Error(`expected 202, got ${fulfil.status}: ${JSON.stringify(fulfil.body)}`);
  return { challenge: challenge.body, paymentTx, job: await pollJob(fulfil.body.jobId) };
}

/** Parses `event:`/`data:` frames out of a streamed SSE body. */
export async function* sseFrames(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawFrame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      yield parseFrame(rawFrame);
    }
  }
}

function parseFrame(rawFrame) {
  let event = 'message';
  const dataLines = [];
  for (const line of rawFrame.split('\n')) {
    if (line.startsWith(':')) continue; // keep-alive comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join('\n') };
}

/** Minimal in-process worker (plain test-string id, no session auth).
 * Resolves once the dispatch channel is live; call stop() to disconnect.
 * Each worker gets its own Agent for the same reason worker-sim.js does. */
export async function startWorker({ workerId, answer = '42', categories = [] }) {
  const controller = new AbortController();
  const dispatcher = new Agent();
  const qs = new URLSearchParams({ worker: workerId });
  if (categories.length) qs.set('categories', categories.join(','));

  const response = await fetch(`${env.backendUrl}/app/events?${qs}`, { dispatcher, signal: controller.signal });
  if (!response.ok) throw new Error(`[${workerId}] SSE connect failed: ${response.status}`);

  let resolveLive;
  const live = new Promise((r) => (resolveLive = r));
  (async () => {
    for await (const frame of sseFrames(response)) {
      if (frame.event === 'connected') {
        console.log(`  [${workerId}] online`);
        resolveLive();
      } else if (frame.event === 'question') {
        const { questionId } = JSON.parse(frame.data);
        const res = await fetch(`${env.backendUrl}/app/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId, workerId, answer }),
        });
        console.log(`  [${workerId}] answered "${answer}" for ${questionId} (${res.status})`);
      }
    }
  })().catch((err) => {
    if (err.name !== 'AbortError') console.error(`  [${workerId}] worker error:`, err.message);
  });

  await live;
  return {
    workerId,
    stop() {
      controller.abort();
      dispatcher.close().catch(() => {});
      console.log(`  [${workerId}] disconnected`);
    },
  };
}
