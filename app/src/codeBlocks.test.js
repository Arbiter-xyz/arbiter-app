import { beforeAll, describe, expect, it } from 'vitest';
import { renderFencedCode } from './codeBlocks.js';

class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.dataset = {};
    this.children = [];
    this._textContent = '';
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  get textContent() {
    return this.children.length
      ? this.children.map((child) => child.textContent).join('')
      : this._textContent;
  }

  set textContent(value) {
    this.children = [];
    this._textContent = String(value);
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (selector === 'pre.code-block' && node.tagName === 'pre' && node.className === 'code-block') {
        matches.push(node);
      }
      node.children?.forEach(visit);
    };
    visit(this);
    return matches;
  }
}

beforeAll(() => {
  globalThis.document = {
    createElement: (tagName) => new MockElement(tagName),
    createTextNode: (textContent) => ({ textContent }),
  };
});

describe('renderFencedCode edge cases (#318)', () => {
  it('renders two adjacent fenced blocks with no text between them', () => {
    const target = new MockElement('div');
    renderFencedCode(target, '```js\nlet a = 1\n``` ```js\nlet b = 2\n```');
    const blocks = target.querySelectorAll('pre.code-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toBe('let a = 1\n');
    expect(blocks[1].textContent).toBe('let b = 2\n');
  });

  it('renders an unterminated fence as plain text without highlighting', () => {
    const target = new MockElement('div');
    renderFencedCode(target, '```js\nlet x = 1');
    expect(target.querySelectorAll('pre.code-block')).toHaveLength(0);
    expect(target.textContent).toBe('```js\nlet x = 1');
  });
});
