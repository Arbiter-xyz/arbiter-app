// One-shot sandbox question, polled through to settlement. No payer
// secret, no wallet, no chain — the same /oracle/sandbox → GET
// /oracle/:jobId → status === 'settled' contract as ask.js's pollJob.
//
// Usage: node sandbox-demo.js "What is 6 x 7?"
import { env, sleep } from './lib/stellar.js';

const question = process.argv.slice(2).join(' ') || 'What is 6 x 7?';
const timeoutMs = Number(process.env.SANDBOX_TIMEOUT_MS || 60_000);

const res = await fetch(`${env.backendUrl}/oracle/sandbox`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question }),
});
if (!res.ok) throw new Error(`sandbox request failed (${res.status}): ${await res.text()}`);
const { jobId } = await res.json();
console.log(`→ asked "${question}" (job ${jobId})`);

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const job = await (await fetch(`${env.backendUrl}/oracle/${jobId}`)).json();
  if (job.status === 'settled') {
    console.log(job.outcome === 'resolved' ? `✓ RESOLVED — answer: "${job.answer}"` : `✓ ${job.outcome} — ${job.reason}`);
    process.exit(0);
  }
  await sleep(1000);
}
console.error(`job ${jobId} did not settle within ${timeoutMs}ms`);
process.exit(1);
