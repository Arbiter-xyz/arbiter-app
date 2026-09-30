import { CHANGELOG } from './changelog.js';

const SEEN_KEY = 'arbiter.lastSeenVersion';

function getLastSeen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function setLastSeen(version) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // storage unavailable (e.g. private browsing): modal may show again
  }
}

/** Shows the changelog modal once per version bump. */
export function showWhatsNewIfNeeded() {
  const latest = CHANGELOG[0];
  if (!latest || getLastSeen() === latest.version) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', "What's new");

  const box = document.createElement('div');
  box.className = 'modal';
  const h = document.createElement('h2');
  h.textContent = `What's new in ${latest.version}`;
  const date = document.createElement('p');
  date.className = 'muted small';
  date.textContent = latest.date;
  const list = document.createElement('ul');
  for (const text of latest.items) {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Got it';
  close.addEventListener('click', () => {
    setLastSeen(latest.version);
    overlay.remove();
  });

  box.append(h, date, list, close);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  close.focus();
}

showWhatsNewIfNeeded();
