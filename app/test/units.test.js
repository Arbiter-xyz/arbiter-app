import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stroopsFromUsdcInput,
  usdcFromStroops,
  formatUsdc,
  toggleUsdcDisplayPrecision,
} from '../src/units.js';

function withMockLocalStorage(fn) {
  const prev = globalThis.localStorage;
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  try {
    return fn();
  } finally {
    globalThis.localStorage = prev;
  }
}

test('stroopsFromUsdcInput and usdcFromStroops convert 7-decimal USDC amounts accurately (#241)', () => {
  assert.equal(stroopsFromUsdcInput('0'), 0n);
  assert.equal(stroopsFromUsdcInput('1'), 10_000_000n);
  assert.equal(stroopsFromUsdcInput('  1.5  '), 15_000_000n);
  assert.equal(stroopsFromUsdcInput('0.0000001'), 1n);
  assert.equal(stroopsFromUsdcInput('123456.7890123'), 1_234_567_890_123n);

  assert.equal(usdcFromStroops(0n), '0.0000000');
  assert.equal(usdcFromStroops(1n), '0.0000001');
  assert.equal(usdcFromStroops(15_000_000n), '1.5000000');
  assert.equal(usdcFromStroops('1234567890123'), '123456.7890123');

  for (const invalid of ['', '   ', '-1', '1.12345678', '1.', '.5', 'abc', '1e7']) {
    assert.throws(() => stroopsFromUsdcInput(invalid), /enter a positive amount with up to 7 decimal places/);
  }
});

test('formatUsdc and toggleUsdcDisplayPrecision respect 2- vs 7-decimal display mode (#241)', () => {
  withMockLocalStorage(() => {
    assert.equal(formatUsdc('1.2345678'), '1.23 USDC');
    assert.equal(formatUsdc('not-a-number'), '— USDC');
    assert.equal(toggleUsdcDisplayPrecision(), '7');
    assert.equal(formatUsdc('1.2345678'), '1.2345678 USDC');
    assert.equal(toggleUsdcDisplayPrecision(), '2');
    assert.equal(formatUsdc('1.2345678'), '1.23 USDC');
  });
});
