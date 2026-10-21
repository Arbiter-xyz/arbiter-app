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
try {
  await scenario.run();
  process.exit(0);
} catch (err) {
  console.error(`\nscenario "${name}" failed:`, err.message);
  process.exit(1);
}
