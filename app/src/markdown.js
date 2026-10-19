// Minimal sanitizing markdown renderer. Builds DOM nodes only — raw user
// content never reaches innerHTML. Supports **bold**, *italic*, `code`, and
// line breaks; everything else renders as plain text.
const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

export function renderMarkdown(target, text) {
  target.replaceChildren();
  String(text ?? '').split('\n').forEach((line, i) => {
    if (i > 0) target.append(document.createElement('br'));
    for (const part of line.split(TOKEN)) {
      if (!part) continue;
      let node;
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        node = document.createElement('strong');
        node.textContent = part.slice(2, -2);
      } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        node = document.createElement('code');
        node.textContent = part.slice(1, -1);
      } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        node = document.createElement('em');
        node.textContent = part.slice(1, -1);
      } else {
        node = document.createTextNode(part);
      }
      target.append(node);
    }
  });
}
