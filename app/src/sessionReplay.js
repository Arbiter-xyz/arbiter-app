// Opt-in session replay (PostHog) for debugging real user issues. Off by
// default: nothing loads unless VITE_SESSION_REPLAY_POSTHOG_KEY is set at
// build time, and the admin console additionally requires
// VITE_SESSION_REPLAY_ADMIN=true. See README "Session replay" for why full
// replay was chosen over error-context-only capture, and its limits.

const KEY = import.meta.env.VITE_SESSION_REPLAY_POSTHOG_KEY || '';
const HOST = import.meta.env.VITE_SESSION_REPLAY_HOST || 'https://us.i.posthog.com';
const ADMIN_ENABLED = import.meta.env.VITE_SESSION_REPLAY_ADMIN === 'true';

// Named exclusions. Every sensitive element is listed here explicitly rather
// than relying on a generic "mask all inputs" default, so adding a new
// sensitive field means adding it here (and reviewers can see it missing).
// "Blocked" elements are replaced by a placeholder box in the recording —
// no text, no attributes (e.g. the full address in a td's title), no value.
export const BLOCKED_SELECTORS = [
  // main.js — worker's raw Stellar secret key (showBackupPanel/btnRevealSecret)
  '#backup-secret',
  '#panel-backup',
  // main.js — payout address the worker types for withdrawTo
  '#withdraw-beneficiary-input',
  // admin.js — privileged bearer token entry
  '#admin-token-input',
  '#panel-login',
  // admin.js — renderKyc(): c.address, self-reported KYC status/tier
  '#view-kyc',
  '#kyc-body',
  // admin.js — renderPayouts(): p.address, amounts, status
  '#view-payouts',
  '#payouts-body',
];

// Masked elements keep layout but have their text replaced with asterisks.
export const MASKED_TEXT_SELECTORS = [
  // main.js — the connected worker's address
  '#worker-address',
  // admin.js — td() cells in other views hold payer/worker addresses and
  // transaction amounts in textContent
  '#tx-body',
  '#workers-body',
  '#payers-body',
  '#fraud-body',
  '#treasury-panel',
];

function userOptedOut() {
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
}

// Returns true when replay was started. Safe to call unconditionally; it is a
// no-op when not configured, and never throws into the caller.
export async function initSessionReplay({ page } = {}) {
  if (!KEY || userOptedOut()) return false;
  if (page === 'admin' && !ADMIN_ENABLED) return false;
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(KEY, {
      api_host: HOST,
      persistence: 'memory', // no cookies/localStorage identifiers
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_surveys: true,
      capture_performance: false,
      session_recording: {
        // Defence in depth only — the named lists above are the contract.
        maskAllInputs: true,
        blockSelector: BLOCKED_SELECTORS.join(','),
        maskTextSelector: MASKED_TEXT_SELECTORS.join(','),
        // Never record network headers/bodies: admin requests carry the
        // bearer token in Authorization.
        recordHeaders: false,
        recordBody: false,
      },
    });
    return true;
  } catch (err) {
    console.warn('session replay failed to start:', err);
    return false;
  }
}
