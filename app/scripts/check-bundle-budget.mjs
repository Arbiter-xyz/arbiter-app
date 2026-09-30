// Bundle-size budget gate (issue #105). Run after `vite build`.
// Fails (exit 1) if any emitted JS/CSS chunk in dist/assets exceeds its budget.
// Sizes are raw (minified, uncompressed) bytes.
//
// Budgets (KB, override via env for a one-off run):
//   BUDGET_JS_KB  per-chunk JS limit  (default 1500, just above the ~1.4MB baseline)
//   BUDGET_CSS_KB per-chunk CSS limit (default 100)
// Tighten these as the stellar-sdk code-splitting follow-up lands.
import { readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const dir = join(root, 'dist', 'assets');
const budgets = {
  '.js': Number(process.env.BUDGET_JS_KB ?? 1500) * 1024,
  '.css': Number(process.env.BUDGET_CSS_KB ?? 100) * 1024,
};

let files;
try {
  files = readdirSync(dir);
} catch {
  console.error(`No build output at ${dir}; run "npm run build" first.`);
  process.exit(1);
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
let failed = false;
for (const name of files.sort()) {
  const limit = budgets[extname(name)];
  if (limit === undefined) continue;
  const size = statSync(join(dir, name)).size;
  const over = size > limit;
  failed ||= over;
  console.log(`${over ? 'FAIL' : 'ok  '} ${name}  ${kb(size)} / ${kb(limit)}`);
}

if (failed) {
  console.error('\nBundle-size budget exceeded. Shrink the chunk or, if intentional, raise the budget in app/scripts/check-bundle-budget.mjs.');
  process.exit(1);
}
console.log('\nBundle-size budget OK.');
