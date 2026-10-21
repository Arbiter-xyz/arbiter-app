import 'dotenv/config';
import { readdir } from 'node:fs/promises';

/** Runs a named storyline from scenarios/<name>.js in one process:
 *   node run-scenario.js quorum
 * With no name, lists what's available. Each scenario exports
 * `description` and an async `run()`. */
const dir = new URL('./scenarios/', import.meta.url);
const names = (await readdir(dir)).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
const name = process.argv[2];

if (!name || !names.includes(name)) {
  if (name) console.error(`Unknown scenario "${name}".`);
  console.log('Usage: node run-scenario.js <name>\n\nScenarios:');
  for (const n of names) {
    try {
      const scenario = await import(new URL(`${n}.js`, dir));
      console.log(`  ${n.padEnd(16)} ${scenario.description}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${n.padEnd(16)} [unavailable: ${message}]`);
    }
  }
  process.exit(name ? 1 : 0);
}

const scenario = await import(new URL(`${name}.js`, dir));
console.log(`▶ ${name}: ${scenario.description}\n`);

// Issue #285: if a scenario's run() never settles (a hung fetch, a worker
// that never comes online, etc.) this script used to just hang forever
// with no feedback — bad for a CI-adjacent script. SCENARIO_TIMEOUT_MS
// lets that be overridden per-run; 0 disables the timeout entirely.
const timeoutMs = Number(process.env.SCENARIO_TIMEOUT_MS ?? 5 * 60_000);

async function runWithTimeout() {
  if (!timeoutMs) return scenario.run();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`scenario "${name}" timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([scenario.run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  await runWithTimeout();
  process.exit(0);
} catch (err) {
  console.error(`\nscenario "${name}" failed:`, err.message);
  process.exit(1);
}
