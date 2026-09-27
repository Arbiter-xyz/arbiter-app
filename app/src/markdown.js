// Minimal, sanitizing rich-text renderer for question/answer text (issue
// #93's `renderMarkdown` — referenced by the payer view merged in by issue
// #34, but never actually added to the repo; see this PR's description).
// Deliberately does not use innerHTML: every node is built with
// createElement/createTextNode so arbitrary HTML embedded in a question or
// answer can never execute as markup, matching the security posture the
// rest of this app (main.js, admin.js) already documents for
// caller-controlled strings.
//
// Supports just enough formatting to be worth calling "rich text":
// **bold**, *italic*, `code`, and [text](url) links (http(s)/mailto only).
// Anything else — including literal HTML tags — is rendered as plain text.

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function isSafeUrl(url) {
  return /^(https?:|mailto:)/i.test(url.trim());
}

function appendInline(parent, text) {
  const parts = text.split(INLINE_PATTERN);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      parent.appendChild(strong);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      const em = document.createElement('em');
      em.textContent = part.slice(1, -1);
      parent.appendChild(em);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.appendChild(code);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (linkMatch && isSafeUrl(linkMatch[2])) {
        const a = document.createElement('a');
        a.textContent = linkMatch[1];
        a.href = linkMatch[2];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }
}

/** Renders `text` into `element` (cleared first) as safe DOM nodes — never
 * innerHTML — with a small set of inline formatting recognized. Line breaks
 * become <br>. */
export function renderMarkdown(element, text) {
  element.textContent = '';
  const source = text == null ? '' : String(text);
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    appendInline(element, line);
    if (i < lines.length - 1) element.appendChild(document.createElement('br'));
  });
}
