import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  truncateAddress,
  formatRatio,
  workerProfileUrl,
  workerOgImageUrl,
} from '../src/format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('format.js exports truncateAddress, formatRatio, workerProfileUrl, and workerOgImageUrl (#246)', () => {
  const addr = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
  assert.equal(truncateAddress(addr), 'GBRPYH…C7OX2H');
  assert.equal(truncateAddress(null), '—');
  assert.equal(truncateAddress('short-id'), 'short-id');

  assert.equal(formatRatio(null), '—');
  assert.equal(formatRatio(undefined), '—');
  assert.equal(formatRatio(0.875), '87.5%');

  assert.equal(workerProfileUrl(addr), `/worker.html?address=${encodeURIComponent(addr)}`);
  assert.equal(
    workerOgImageUrl('https://api.arbiter.example', addr),
    `https://api.arbiter.example/og/workers/${encodeURIComponent(addr)}.png`,
  );
  assert.equal(
    workerOgImageUrl('http://localhost:4000', 'worker/with space'),
    'http://localhost:4000/og/workers/worker%2Fwith%20space.png',
  );
});

test('admin.js defines SVG_NS and balanceFigure used by renderMatchRatioChart and renderTreasury (#244, #245)', () => {
  const adminSrc = readFileSync(join(__dirname, '../src/admin.js'), 'utf8');
  assert.match(adminSrc, /const\s+SVG_NS\s*=\s*['"]http:\/\/www\.w3\.org\/2000\/svg['"]/);
  assert.match(adminSrc, /function\s+balanceFigure\s*\(\s*value\s*,\s*\{\s*low\s*=\s*false\s*,\s*unit\s*=\s*['"]USDC['"]\s*\}\s*=\s*\{\}\s*\)/);
});
