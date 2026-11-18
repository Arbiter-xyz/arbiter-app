/** Minimal, XSS-safe markdown for question text: escapes everything, then
 * re-enables only `code`, **bold**, *italic* and line breaks. */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderMarkdown(target, text) {
  // Code spans are extracted first and swapped for placeholders so the later
  // bold/italic passes cannot re-process their literal contents (e.g. `*a*`).
  const codeSpans = [];
  const escaped = escapeHtml(String(text ?? '')).replace(/`([^`]+)`/g, (_, inner) => {
    codeSpans.push(inner);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  const html = escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`);

  target.innerHTML = html;
}
