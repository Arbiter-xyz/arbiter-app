import { describe, it, expect, beforeAll } from 'vitest';
import { renderMarkdown } from './markdown.js';

// renderMarkdown builds DOM nodes; vitest runs in `node`, so serialize a tiny
// fake DOM the way innerHTML would (text escaped, elements as tags).
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const serialize = (n) => (n.tag === '#text' ? esc(n.textContent) : n.tag === 'br' ? '<br>' : `<${n.tag}>${esc(n.textContent)}</${n.tag}>`);

beforeAll(() => {
  globalThis.document = {
    createElement: (tag) => ({ tag, textContent: '' }),
    createTextNode: (textContent) => ({ tag: '#text', textContent }),
  };
});

function render(text) {
  const children = [];
  const target = { replaceChildren: () => children.splice(0), append: (n) => children.push(n) };
  renderMarkdown(target, text);
  return children.map(serialize).join('');
}

describe('renderMarkdown', () => {
  it('renders plain text unchanged', () => {
    expect(render('hello world')).toBe('hello world');
  });

  it('never turns input into markup', () => {
    expect(render('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders bold, italic and code', () => {
    expect(render('**bold**')).toBe('<strong>bold</strong>');
    expect(render('*italic*')).toBe('<em>italic</em>');
    expect(render('`code`')).toBe('<code>code</code>');
  });

  it('keeps markdown-special characters literal inside a code span', () => {
    expect(render('`*foo*`')).toBe('<code>*foo*</code>');
    expect(render('`**foo**`')).toBe('<code>**foo**</code>');
  });

  it('does not re-process code contents with later passes', () => {
    const out = render('`*a*` and *b*');
    expect(out).toBe('<code>*a*</code> and <em>b</em>');
    expect(out).not.toContain('<code><em>');
  });

  it('renders line breaks', () => {
    expect(render('a\nb')).toBe('a<br>b');
  });
});
