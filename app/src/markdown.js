// Question text is untrusted. Keep the dashboard renderer deliberately plain
// until a sanitised rich-text renderer is introduced: this restores the module
// contract used by dashboard.js without interpreting user-controlled HTML.
export function renderMarkdown(target, value) {
  target.textContent = String(value || '');
}
