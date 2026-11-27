// Safe, dependency-free fenced-code renderer. Plain text is always inserted
// with textContent; only this module creates the isolated syntax-token spans.
// It deliberately recognises a small technical vocabulary rather than trying
// to parse untrusted content as HTML.
// The language tag only counts when a newline follows it (#464); otherwise
// "```npm install foo```" would lose "npm" to the language slot.
const FENCE = /```(?:([a-z0-9+-]+)\n)?([\s\S]*?)```/gi;
const TOKEN = /(\b(?:fn|pub|let|mut|struct|impl|contract|return|const|async|await|function|class|if|else|true|false|null)\b|\b(?:resolve|refund|transfer|mint)\b|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/[^\n]*)/g;

function appendHighlightedCode(code, language) {
  const pre = document.createElement('pre');
  pre.className = 'code-block';
  const element = document.createElement('code');
  if (language) element.dataset.language = language;

  let cursor = 0;
  for (const match of code.matchAll(TOKEN)) {
    element.append(document.createTextNode(code.slice(cursor, match.index)));
    const token = document.createElement('span');
    token.className = match[0].startsWith('//')
      ? 'code-comment'
      : match[0].startsWith('"') || match[0].startsWith("'")
        ? 'code-string'
        : 'code-keyword';
    token.textContent = match[0];
    element.append(token);
    cursor = match.index + match[0].length;
  }
  element.append(document.createTextNode(code.slice(cursor)));
  pre.append(element);
  return pre;
}

/**
 * Split text into plain-text and fenced-code segments, in order. A code
 * segment's `language` is '' when the fence has no tag line.
 */
export function parseFences(value) {
  const text = String(value || '');
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(FENCE)) {
    segments.push({ type: 'text', text: text.slice(cursor, match.index) });
    segments.push({ type: 'code', code: match[2], language: (match[1] || '').toLowerCase() });
    cursor = match.index + match[0].length;
  }
  segments.push({ type: 'text', text: text.slice(cursor) });
  return segments;
}
