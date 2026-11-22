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

// --- Review #318: adjacent / unterminated fence behaviour -------------------
// The FENCE regex is non-greedy and global, so two fenced blocks with no text
// between them ("```a``` ```b```") are matched as two independent blocks and
// the empty slice between them is appended as an empty text node — correct.
// An unterminated fence ("```js\nlet x = 1") never matches FENCE, so the whole
// string falls through to the trailing text node and is rendered verbatim as
// plain text — also correct (no partial/incorrect highlighting). These tests
// pin that behaviour so future edits to FENCE cannot silently regress it.
if (typeof describe === 'function') {
  describe('renderFencedCode edge cases (#318)', () => {
    it('renders two adjacent fenced blocks with no text between them', () => {
      const target = document.createElement('div');
      renderFencedCode(target, '```js\nlet a = 1\n``` ```js\nlet b = 2\n```');
      const blocks = target.querySelectorAll('pre.code-block');
      expect(blocks.length).toBe(2);
      expect(blocks[0].textContent).toBe('let a = 1\n');
      expect(blocks[1].textContent).toBe('let b = 2\n');
    });

    it('renders an unterminated fence as plain text without highlighting', () => {
      const target = document.createElement('div');
      renderFencedCode(target, '```js\nlet x = 1');
      expect(target.querySelectorAll('pre.code-block').length).toBe(0);
      expect(target.textContent).toBe('```js\nlet x = 1');
    });
  });
}
