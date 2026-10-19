// Single source of truth for secret-bearing input ids (issue #198), shared by
// errorReporting.js's SENSITIVE_SELECTORS and sessionReplay.js's
// BLOCKED_SELECTORS so the two redaction lists can't drift apart. Any new
// field holding a secret or the admin token — on any page — goes here.
export const SENSITIVE_FIELD_IDS = [
  // main.js — worker's raw Stellar secret key
  'backup-secret',
  // main.js — payout address the worker types for withdrawTo
  'withdraw-beneficiary-input',
  // admin.js — privileged bearer token entry
  'admin-token-input',
  // demo.js — second admin-token entry on demo.html (same ADMIN_TOKEN)
  'demo-token',
];
