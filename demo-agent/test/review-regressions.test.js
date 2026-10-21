import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { getGlobalDispatcher } from 'undici';
import { fetchSse, sseAgent } from '../lib/sse-dispatcher.js';

after(async () => {
  await sseAgent.close();
});

test('scenario listing continues when a scenario module cannot load', async () => {
  const scenarioDir = new URL('../scenarios/', import.meta.url);
  const scenarioPath = new URL(`broken-${process.pid}.js`, scenarioDir);

  try {
    await writeFile(scenarioPath, 'export const = ;\n');
    const result = spawnSync(process.execPath, ['run-scenario.js'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: node run-scenario\.js <name>/);
    assert.match(result.stdout, /quorum/);
    assert.match(result.stderr, /broken-\d+.*unavailable:/);
  } finally {
    await rm(scenarioPath, { force: true });
  }
});

test('SSE requests use a dispatcher isolated from the global fetch pool', async () => {
  const originalFetch = globalThis.fetch;
  let requestOptions;
  globalThis.fetch = async (_url, options) => {
    requestOptions = options;
    return new Response(null);
  };

  try {
    await fetchSse('http://localhost/events');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.strictEqual(requestOptions.dispatcher, sseAgent);
  assert.notStrictEqual(requestOptions.dispatcher, getGlobalDispatcher());
});
