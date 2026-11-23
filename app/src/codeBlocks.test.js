// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderFencedCode } from './codeBlocks.js';

// --- Review #318: adjacent / unterminated fence behaviour -------------------
// The FENCE regex is non-greedy and global, so two fenced blocks with no text
// between them ("```a``` ```b```") are matched as two independent blocks and
// the empty slice between them is appended as an empty text node — correct.
// An unterminated fence ("```js\nlet x = 1") never matches FENCE, so the whole
// string falls through to the trailing text node and is rendered verbatim as
// plain text — also correct (no partial/incorrect highlighting). These tests
// pin that behaviour so future edits to FENCE cannot silently regress it.
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
