/** Minimal, XSS-safe markdown for question text: escapes everything, then
 * re-enables only `code`, **bold**, *italic* and line breaks.
 * Code spans are tokenized into placeholders before bold/italic passes run
 * so markdown-special characters inside backticks (e.g. `*foo*`) stay literal (#220). */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderMarkdown(target, text) {
  const codeSpans = [];
  const escaped = escapeHtml(String(text ?? '')).replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeSpans.push(`<code>${code}</code>`) - 1;
    return `\u0000CODE_${idx}\u0000`;
  });

  const html = escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
    .replace(/\u0000CODE_(\d+)\u0000/g, (_, idx) => codeSpans[Number(idx)]);

  if (target) {
    target.innerHTML = html;
  }
  return html;
}
