import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders plain text unchanged', () => {
    expect(renderMarkdown('hello world')).toBe('hello world');
  });

  it('escapes HTML before applying markdown', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('renders bold text', () => {
    expect(renderMarkdown('**bold**')).toBe('<strong>bold</strong>');
  });

  it('renders italic text', () => {
    expect(renderMarkdown('*italic*')).toBe('<em>italic</em>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('`code`')).toBe('<code>code</code>');
  });

  it('keeps markdown-special characters literal inside a code span', () => {
    expect(renderMarkdown('`*foo*`')).toBe('<code>*foo*</code>');
  });

  it('keeps bold markers literal inside a code span', () => {
    expect(renderMarkdown('`**foo**`')).toBe('<code>**foo**</code>');
  });

  it('does not re-process inserted code markup with later passes', () => {
    const out = renderMarkdown('`*a*` and *b*');
    expect(out).toBe('<code>*a*</code> and <em>b</em>');
    expect(out).not.toContain('<code><em>');
  });
});
