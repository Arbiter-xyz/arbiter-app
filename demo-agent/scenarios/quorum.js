import { Keypair } from '@stellar/stellar-sdk';
import { explorerTxLink } from '../lib/stellar.js';
import { askAndSettle, startWorker } from '../lib/demo.js';

export const description = 'Bring N workers online in-process (SCENARIO_WORKERS, default 3), ask one question, show the quorum result';

export async function run() {
  if (!process.env.DEMO_PAYER_SECRET) throw new Error('DEMO_PAYER_SECRET is not set');
  const payer = Keypair.fromSecret(process.env.DEMO_PAYER_SECRET);
  const count = Number(process.env.SCENARIO_WORKERS || 3);
  const stamp = Date.now();

  const workers = await Promise.all(
    Array.from({ length: count }, (_, i) => startWorker({ workerId: `scenario-worker-${stamp}-${i + 1}`, answer: 'Paris' })),
  );
  try {
    const { challenge, job } = await askAndSettle(payer, { question: 'What is the capital of France?' });
    console.log(`Price ${challenge.amount} USDC (surge ${challenge.surgeMultiplier ?? 1}x)`);
    if (job.outcome === 'resolved') {
      console.log(`✓ RESOLVED "${job.answer}" by ${job.matchingWorkers.length}/${count} workers: ${explorerTxLink(job.payoutTx)}`);
    } else {
      console.log(`⚠ outcome=${job.outcome}: ${job.reason}`);
    }
  } finally {
    workers.forEach((w) => w.stop());
  }
}
