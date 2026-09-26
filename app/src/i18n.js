/**
 * Minimal i18n runtime for the worker console / dashboard (issue #8).
 *
 * - Strings live in per-locale message catalogs (./i18n/*.js), keyed by id.
 * - Static markup opts in with `data-i18n="key"` (textContent),
 *   `data-i18n-attr="placeholder:key,aria-label:key"` (attributes).
 * - Plurals go through Intl.PluralRules, so Arabic's six plural categories
 *   (zero/one/two/few/many/other) are handled rather than an English
 *   "n === 1" shortcut.
 * - USDC amounts, counts and durations are formatted with Intl so digits,
 *   separators and unit placement follow the locale (e.g. "١٢٫٥٠ USDC").
 * - Switching locale sets <html lang dir>; all layout uses CSS logical
 *   properties (margin-inline-start etc.) so RTL is a real mirror, not a
 *   `direction: rtl` overlay on physical left/right rules.
 */
import en from './i18n/en.js';
import ar from './i18n/ar.js';

const CATALOGS = { en, ar };
const RTL = new Set(['ar', 'he', 'fa', 'ur']);
const STORAGE_KEY = 'arbiter_locale';

function detectLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && CATALOGS[saved]) return saved;
  } catch {}
  const nav = (navigator.language || 'en').slice(0, 2);
  return CATALOGS[nav] ? nav : 'en';
}

let locale = detectLocale();

export const getLocale = () => locale;
export const isRtl = (l = locale) => RTL.has(l);
export const availableLocales = () => Object.keys(CATALOGS);

/** t('key', {n: 3}) — `{name}` placeholders are interpolated; if the
 * message is an object keyed by plural category, `n` selects the form. */
export function t(key, vars = {}) {
  let msg = CATALOGS[locale][key] ?? en[key] ?? key;
  if (msg && typeof msg === 'object') {
    const cat = new Intl.PluralRules(locale).select(vars.n ?? 0);
    msg = msg[cat] ?? msg.other;
  }
  return String(msg).replace(/\{(\w+)\}/g, (_, k) =>
    k === 'n' && typeof vars.n === 'number' ? formatNumber(vars.n) : vars[k] ?? ''
  );
}

export function formatNumber(n, opts) {
  return new Intl.NumberFormat(locale, opts).format(n);
}

/** USDC isn't an ISO-4217 code, so Intl's currency style can't be used;
 * format the amount with 2–7 fraction digits (Stellar's precision) and
 * place the code per the catalog's `usdc` pattern. */
export function formatUsdc(amount) {
  const value = formatNumber(Number(amount) || 0, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
  return t('usdc', { amount: value });
}

/** "45s" style durations, localized (e.g. "٤٥ ث"). */
export function formatSeconds(s) {
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'narrow' }).format(s);
}

export function applyTranslations(root = document) {
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':');
      node.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

const listeners = new Set();
export const onLocaleChange = (fn) => listeners.add(fn);

export function setLocale(next) {
  if (!CATALOGS[next]) return;
  locale = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  applyTranslations();
  listeners.forEach((fn) => fn(next));
}

/** Wires any `<select class="lang-switch">` on the page and applies the
 * detected locale. Call once at startup. */
export function initI18n() {
  for (const select of document.querySelectorAll('select.lang-switch')) {
    select.value = locale;
    select.addEventListener('change', () => setLocale(select.value));
  }
  applyTranslations();
}
