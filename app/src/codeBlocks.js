// Safe, dependency-free fenced-code renderer. Plain text is always inserted
// with textContent; only this module creates the isolated syntax-token spans.
// It deliberately recognises a small technical vocabulary rather than trying
// to parse untrusted content as HTML.
const FENCE = /```([a-z0-9+-]*)\n?([\s\S]*?)```/gi;
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

/** Render text plus ```fenced``` code without ever assigning untrusted HTML. */
export function renderFencedCode(target, value) {
  target.replaceChildren();
  const text = String(value || '');
  let cursor = 0;
  for (const match of text.matchAll(FENCE)) {
    target.append(document.createTextNode(text.slice(cursor, match.index)));
    target.append(appendHighlightedCode(match[2], match[1].toLowerCase()));
    cursor = match.index + match[0].length;
  }
  target.append(document.createTextNode(text.slice(cursor)));
}
