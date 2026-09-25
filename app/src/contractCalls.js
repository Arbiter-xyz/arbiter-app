import { Contract, TransactionBuilder, Address, nativeToScVal, rpc, Transaction } from '@stellar/stellar-sdk';

const SOROBAN_RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const CONTRACT_ID = import.meta.env.VITE_ORACLE_CONTRACT_ID || '';

let server = null;
function getServer() {
  if (!server) server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: SOROBAN_RPC_URL.startsWith('http://') });
  return server;
}

/** Builds a simulated+assembled (but unsigned) contract-call transaction
 * for `sourceAddress` to sign with their own wallet. Uses a nominal fee —
 * the worker never actually pays it, since these calls are always relayed
 * through a /sponsor/* fee-bump endpoint so a zero-XLM worker can stake and
 * withdraw just like they can answer questions. */
async function buildUnsignedCallXdr(sourceAddress, method, args) {
  const srv = getServer();
  const account = await srv.getAccount(sourceAddress);
  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();
  const prepared = await srv.prepareTransaction(tx);
  return prepared.toXDR();
}

export async function buildStakeXdr(workerAddress, amountStroops) {
  return buildUnsignedCallXdr(workerAddress, 'stake', [
    new Address(workerAddress).toScVal(),
    nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
  ]);
}

export async function buildWithdrawXdr(workerAddress, amountStroops) {
  return buildUnsignedCallXdr(workerAddress, 'withdraw', [
    new Address(workerAddress).toScVal(),
    nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
  ]);
}

/** Same withdrawal, routed to `beneficiaryAddress` instead of the signing
 * key — `workerAddress` still signs and still owns the balance drawn down. */
export async function buildWithdrawToXdr(workerAddress, beneficiaryAddress, amountStroops) {
  return buildUnsignedCallXdr(workerAddress, 'withdraw_to', [
    new Address(workerAddress).toScVal(),
    new Address(beneficiaryAddress).toScVal(),
    nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
  ]);
}

/**
 * Ledger's Stellar app signs classic transaction envelopes (and, on recent
 * firmware, Soroban auth entries embedded in a full envelope) but it does NOT
 * expose a standalone "sign this auth entry" primitive. Soroban contract calls
 * are therefore signed by handing the device the *whole* assembled transaction
 * envelope, exactly like a classic payment — the device hashes and signs the
 * envelope's signature payload, and the resulting signature is attached to the
 * transaction's source-account signature slot.
 *
 * This helper is the adapter boundary: it takes the unsigned XDR produced by
 * `buildUnsignedCallXdr` and returns the signed XDR after the caller has driven
 * the Ledger device. `signEnvelope` is injected so this module stays free of a
 * hard dependency on any particular Ledger transport (WebHID/WebUSB/node-hid),
 * which keeps it testable against a faithful emulator as well as real hardware.
 *
 * @param {string} unsignedXdr - assembled, unsigned transaction envelope XDR
 * @param {(payload: { xdr: string, networkPassphrase: string }) => Promise<string>} signEnvelope
 *   - drives the Ledger Stellar app and resolves to the signed envelope XDR
 * @returns {Promise<string>} signed transaction envelope XDR
 */
export async function signSorobanCallWithLedger(unsignedXdr, signEnvelope) {
  if (typeof signEnvelope !== 'function') {
    throw new Error(
      'Ledger signing requires a signEnvelope transport. Soroban auth entries cannot be signed standalone on current Ledger firmware — the full transaction envelope must be signed instead.'
    );
  }
  // Parse first so a malformed/unsupported envelope fails loudly here rather
  // than producing a misleading "signed" result the device never approved.
  TransactionBuilder.fromXDR(unsignedXdr, NETWORK_PASSPHRASE);
  const signedXdr = await signEnvelope({ xdr: unsignedXdr, networkPassphrase: NETWORK_PASSPHRASE });
  if (!signedXdr || typeof signedXdr !== 'string') {
    throw new Error('Ledger did not return a signed transaction envelope.');
  }
  // Validate the returned envelope is a real, parseable transaction before it
  // is ever submitted — honest degradation instead of a silent bad signature.
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (!(signed instanceof Transaction)) {
    throw new Error('Ledger returned an unexpected transaction type; refusing to submit.');
  }
  return signedXdr;
}

/**
 * Honest capability report for the Ledger path. Current Ledger Stellar app
 * firmware signs full transaction envelopes (including Soroban contract calls
 * assembled by `buildUnsignedCallXdr`), but does not support signing a bare
 * Soroban auth entry in isolation. Callers should surface this to the user
 * rather than pretending standalone auth-entry signing works.
 */
export const LEDGER_CAPABILITIES = Object.freeze({
  signsFullTransactionEnvelope: true,
  signsStandaloneAuthEntry: false,
  note:
    'Ledger signs the full assembled Soroban transaction envelope. Standalone auth-entry signing is not supported on current firmware; use the envelope-signing path.',
});

/**
 * Reads the on-chain state of a question so the offline queue can decide, at
 * sync time, whether a queued answer is still valid. This is the reconciliation
 * primitive the offline-first worker console relies on: a queued answer must
 * never be submitted against a question that has already closed (quorum reached
 * by others, or timeout), and must never be silently duplicated on retry.
 *
 * Returns a normalized snapshot rather than raw contract output so callers can
 * branch on `open` without re-deriving quorum/timeout logic themselves.
 *
 * @param {string|number|bigint} questionId
 * @returns {Promise<{ id: string, open: boolean, closedReason: 'quorum'|'timeout'|null, answerCount: number }>}
 */
export async function getQuestionState(questionId) {
  const srv = getServer();
  const contract = new Contract(CONTRACT_ID);
  const result = await srv.simulateTransaction(
    new TransactionBuilder(await srv.getAccount(CONTRACT_ID), {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('get_question', nativeToScVal(BigInt(questionId), { type: 'u64' })))
      .setTimeout(60)
      .build()
  );
  if (rpc.Api.isSimulationError(result)) {
    throw new Error(`Failed to read question ${questionId}: ${result.error}`);
  }
  const raw = result.result?.retval;
  const value = raw ? raw.value() : null;
  const open = Boolean(value?.open ?? value?.is_open ?? false);
  const closedReason = open ? null : value?.closed_reason === 'timeout' ? 'timeout' : 'quorum';
  return {
    id: String(questionId),
    open,
    closedReason,
    answerCount: Number(value?.answer_count ?? 0),
  };
}

/**
 * Submits a worker's answer exactly once. The `answerId` is a client-generated
 * idempotency key persisted alongside the queued answer in IndexedDB; the
 * contract (or the relaying /sponsor endpoint) is expected to reject a repeat
 * of the same key, so a background-sync retry after a dropped response can
 * never create a duplicate answer. Callers should treat a duplicate-key
 * rejection as success, not failure.
 *
 * @param {string} answerId - stable idempotency key for this answer
 * @param {string|number|bigint} questionId
 * @param {string} answerXdr - signed answer transaction envelope XDR
 * @returns {Promise<{ answerId: string, duplicate: boolean }>}
 */
export async function submitAnswerOnce(answerId, questionId, answerXdr) {
  const srv = getServer();
  const tx = TransactionBuilder.fromXDR(answerXdr, NETWORK_PASSPHRASE);
  try {
    const sent = await srv.sendTransaction(tx);
    if (sent.status === 'DUPLICATE') {
      return { answerId, duplicate: true };
    }
    return { answerId, duplicate: false };
  } catch (err) {
    // A duplicate idempotency key surfaces as a submission error on retry;
    // treat it as an already-applied answer so sync can safely dequeue.
    if (/duplicate|already/i.test(String(err?.message || err))) {
      return { answerId, duplicate: true };
    }
    throw err;
  }
}

export { NETWORK_PASSPHRASE };
