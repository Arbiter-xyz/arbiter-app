// Image attachments for questions (issue #94).
//
// Upload path is separate from POST /oracle's JSON body:
//   POST /attachments (multipart, field "image") -> { attachmentId, url }
// The payer then passes `attachmentId` alongside {question, tier, category}.
// Questions without an attachment are unchanged (backward compatible).

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function validateAttachment(file) {
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
    throw new Error(`unsupported image type ${file.type || 'unknown'} (png, jpeg, webp, gif only)`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`image too large (${file.size} bytes, max ${MAX_ATTACHMENT_BYTES})`);
  }
}

export async function uploadAttachment(file, headers = {}) {
  validateAttachment(file);
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`${BACKEND_URL}/attachments`, { method: 'POST', body: form, headers });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}

// Resolve the backend origin once. If VITE_BACKEND_URL is unset or relative,
// `new URL(BACKEND_URL)` throws (no base) — in that case fall back to the
// current document origin so the trust check still compares against the host
// actually serving the app instead of silently trusting everything.
function backendOrigin() {
  try {
    return new URL(BACKEND_URL, window.location.href).origin;
  } catch {
    return null;
  }
}

// Only render images served from our own backend — the URL comes from a
// payer-supplied question, so never load arbitrary third-party hosts.
function isTrustedAttachmentUrl(url) {
  const origin = backendOrigin();
  if (!origin) return false;
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

// Renders (or clears) the question's image in the worker's answer panel.
export function renderQuestionAttachment(question) {
  const img = document.getElementById('question-image');
  if (!img) return;
  const url = question && question.attachmentUrl;
  if (!url || !isTrustedAttachmentUrl(url)) {
    img.removeAttribute('src');
    img.classList.add('hidden');
    return;
  }
  img.src = new URL(url, backendOrigin()).href;
  img.alt = 'Image attached to this question';
  img.classList.remove('hidden');
}

// The console dispatches `arbiter:question` with the incoming question.
window.addEventListener('arbiter:question', (e) => renderQuestionAttachment(e.detail));
