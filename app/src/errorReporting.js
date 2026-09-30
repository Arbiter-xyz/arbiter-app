// Opt-in client-side error reporting (Sentry). A complete no-op unless
// VITE_SENTRY_DSN is set; @sentry/browser is loaded via dynamic import so the
// default bundle does not carry it. Existing log()/console.error calls are left
// untouched; this only adds aggregation alongside them.

const DSN = import.meta.env.VITE_SENTRY_DSN;

// DOM elements whose content/interaction must never reach a report.
const SENSITIVE_SELECTORS = ['#backup-secret', '#admin-token-input'];

const PATTERNS = [
  /\b[GSCMT][A-Z2-7]{55,68}\b/g, // Stellar public/secret/contract/muxed keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, // bearer tokens
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, // JWTs
  /\b[0-9a-f]{64}\b/gi, // hex keys / hashes
];
const SENSITIVE_KEY = /secret|token|authorization|password|seed|mnemonic|private|kyc|cookie|address|pubkey/i;

export function scrubString(value) {
  return PATTERNS.reduce((s, re) => s.replace(re, '[redacted]'), String(value));
}

export function scrubValue(value, depth = 0) {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrubValue(v, depth + 1);
  }
  return out;
}

export function scrubBreadcrumb(crumb) {
  const target = String(crumb?.data?.target ?? crumb?.message ?? '');
  if (SENSITIVE_SELECTORS.some((sel) => target.includes(sel) || target.includes(sel.slice(1)))) {
    return null; // drop breadcrumbs touching the wallet secret / admin token
  }
  if (crumb?.category === 'ui.input') return null;
  return scrubValue(crumb);
}

export function scrubEvent(event) {
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.url) event.request.url = scrubString(event.request.url.split('#')[0]);
  }
  delete event.user;
  return scrubValue(event);
}

export function initErrorReporting(entry) {
  if (!DSN) return;
  import('@sentry/browser')
    .then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        sendDefaultPii: false,
        initialScope: { tags: { entry } },
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
      });
    })
    .catch(() => {}); // fail open: reporting must never break the app
}
