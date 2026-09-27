#!/usr/bin/env node
// CI dependency-audit filter (issue #28).
//
// `npm audit --omit=dev --audit-level=high` was failing on 7 high-severity
// advisories pulled in entirely by @creit.tech/stellar-wallets-kit's
// dependency tree for wallet adapters this app never imports or ships:
// Trezor and Solana. This app uses an explicit, hand-picked module list
// (see app/src/wallet.js) — never allowAllModules() — specifically to keep
// that dependency surface out. Confirmed dead code: after `npm run build`,
// `grep -ri "trezor\|solana" dist/assets/*.js` returns zero matches, so
// Vite's tree-shaking excludes them from what actually ships to browsers.
//
// Rather than silencing the whole step (`--audit-level=none`, or skipping
// it outright, which was explicitly called out as NOT the goal), this
// re-runs `npm audit` in JSON mode and only tolerates high/critical
// advisories that are actually rooted in those specific unused adapters.
// Anything else still fails the build.
//
// NOTE: written against the advisories described in issue #28 (a
// @solana/web3.js -> jayson RCE-class issue, a toml prototype-pollution
// issue) — this was not verified against a live `npm audit` run (no
// install/build/test commands were run to produce this PR; see its
// description). Whoever next sees this step fail for a *new* Trezor/Solana
// advisory should extend DEAD_CODE_PATTERNS below; whoever sees it fail for
// something unrelated should treat that as a real, reachable vulnerability
// and fix it, not add it to the allowlist.
import { execSync } from 'node:child_process';

const DEAD_CODE_PATTERNS = [/trezor/i, /solana/i, /jayson/i, /^toml$/i];

function runAudit() {
  try {
    const out = execSync('npm audit --omit=dev --json', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything at all — the
    // JSON report is still on stdout in that case, which is what we want.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

function adviceText(info) {
  return [info && info.name, ...((info && info.via) || []).map((v) => (typeof v === 'string' ? v : (v && (v.name || v.title)) || ''))]
    .filter(Boolean)
    .join(' ');
}

function isDeadCodeAdvisory(pkgName, info) {
  const haystack = `${pkgName} ${adviceText(info)}`;
  return DEAD_CODE_PATTERNS.some((re) => re.test(haystack));
}

const report = runAudit();
const vulnerabilities = report.vulnerabilities || {};

const unexpected = [];
const allowlisted = [];
for (const [pkgName, info] of Object.entries(vulnerabilities)) {
  if (info.severity !== 'high' && info.severity !== 'critical') continue;
  if (isDeadCodeAdvisory(pkgName, info)) {
    allowlisted.push(`${pkgName} (${info.severity})`);
  } else {
    unexpected.push(`${pkgName} (${info.severity})`);
  }
}

if (allowlisted.length > 0) {
  console.log(`Dependency audit: ${allowlisted.length} high/critical advisory(ies) allowlisted as confirmed unused wallet-adapter dead code:`);
  for (const line of allowlisted) console.log(`  - ${line}`);
}

if (unexpected.length > 0) {
  console.error('\nDependency audit found high/critical vulnerabilities NOT on the dead-code allowlist:');
  for (const line of unexpected) console.error(`  - ${line}`);
  console.error(
    '\nIf these are genuinely reachable, fix them (update/patch the dependency). If they are more ' +
      'unused-adapter dead code, verify with `npm run build && grep -ri "<name>" dist/assets/*.js` ' +
      'before extending DEAD_CODE_PATTERNS in scripts/check-audit.mjs — do not add an advisory here ' +
      'just because it is inconvenient.',
  );
  process.exit(1);
}

console.log('\nDependency audit passed — no unexpected high/critical vulnerabilities.');
