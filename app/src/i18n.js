// Lightweight vanilla-JS i18n (issue #58) and RTL handling (issue #59).
//
// Strings live in one JSON resource file per locale under ./locales. Static
// HTML copy is tagged with data-i18n (textContent), data-i18n-html (trusted
// markup from our own resource files only), data-i18n-placeholder and
// data-i18n-title attributes; dynamic strings go through t(). Pluralization
// uses Intl.PluralRules: a message may be an object keyed by plural category
// ({ one, other, ... }) and is selected by the `count` variable.
import en from './locales/en.json';
import es from './locales/es.json';
import ar from './locales/ar.json';

const LOCALES = { en, es, ar };
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);
const STORAGE_KEY = 'arbiter.locale';

let current = detectLocale();

function detectLocale() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked — fall through to navigator language
  }
  const candidates = [saved, ...(navigator.languages || [navigator.language])];
  for (const c of candidates) {
    const base = (c || '').toLowerCase().split('-')[0];
    if (LOCALES[base]) return base;
  }
  return 'en';
}

export function getLocale() {
  return current;
}

export function t(key, vars = {}) {
  let msg = LOCALES[current][key] ?? en[key] ?? key;
  if (typeof msg === 'object') {
    const cat = new Intl.PluralRules(current).select(Number(vars.count) || 0);
    msg = msg[cat] ?? msg.other;
  }
  return msg.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-html]')) node.innerHTML = t(node.dataset.i18nHtml);
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of root.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  const titleKey = document.documentElement.dataset.i18nDocTitle;
  if (titleKey) document.title = t(titleKey);
}

export function setLocale(locale) {
  if (!LOCALES[locale]) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // non-persistent — still applies for this page view
  }
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
  applyTranslations();
  document.dispatchEvent(new CustomEvent('localechange', { detail: { locale } }));
}

// Wires the <select id="locale-picker"> present on translated pages and
// applies the detected locale on load.
export function initI18n() {
  const picker = document.getElementById('locale-picker');
  if (picker) {
    picker.value = current;
    picker.addEventListener('change', () => setLocale(picker.value));
  }
  setLocale(current);
}
