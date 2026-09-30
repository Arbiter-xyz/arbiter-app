import { Keypair } from '@stellar/stellar-sdk';
import {
  env,
  submitPaymentDirect,
  callRefundTimeoutPermissionless,
  explorerTxLink,
  getLatestLedgerSequence,
  sleep,
} from '../lib/stellar.js';
import { postOracle } from '../lib/demo.js';

export const description = 'Pay for a question the backend never hears about, then force refund_timeout() as a third party';

export async function run() {
  if (!process.env.DEMO_PAYER_SECRET) throw new Error('DEMO_PAYER_SECRET is not set');
  const payer = Keypair.fromSecret(process.env.DEMO_PAYER_SECRET);

  const challenge = await postOracle({ question: 'This question is deliberately never fulfilled.', tier: 'express' });
  if (challenge.status !== 402) throw new Error(`expected 402, got ${challenge.status}`);

  const hash = await submitPaymentDirect(payer, challenge.body.questionId, challenge.body.amountStroops);
  console.log(`Payment landed (backend deliberately not notified): ${explorerTxLink(hash)}`);

  const deadline = (await getLatestLedgerSequence()) + env.timeoutLedgers;
  let current;
  do {
    await sleep(10_000);
    current = await getLatestLedgerSequence();
    process.stdout.write(`ledger ${current}/${deadline}\r`);
  } while (current < deadline);

  console.log('\nDeadline reached. Calling refund_timeout() as an unrelated third party…');
  const refundHash = await callRefundTimeoutPermissionless(challenge.body.questionId);
  console.log(`✓ refund_timeout() succeeded with no admin or payer signature: ${explorerTxLink(refundHash)}`);
}
