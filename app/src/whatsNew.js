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

/**
 * Returns the changelog entries the user has not seen yet, newest first.
 * When the last-seen version is unknown (first run or cleared storage) only
 * the latest entry is returned so we don't dump the entire history at once.
 * When the user has skipped several releases, every entry newer than the
 * last-seen version is returned so nothing is silently missed.
 */
export function getUnseenEntries() {
  const lastSeen = getLastSeen();
  if (!lastSeen) return CHANGELOG.slice(0, 1);

  const seenIndex = CHANGELOG.findIndex((entry) => entry.version === lastSeen);
  if (seenIndex === -1) return CHANGELOG.slice(0, 1);

  return CHANGELOG.slice(0, seenIndex);
}

/** Shows the changelog modal once per version bump. */
export function showWhatsNewIfNeeded() {
  const unseen = getUnseenEntries();
  const latest = unseen[0];
  if (!latest) return;

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

  box.append(h, date, list);

  // Aggregate entries from any releases the user skipped so nothing is lost.
  for (const entry of unseen.slice(1)) {
    const sub = document.createElement('h3');
    sub.textContent = `${entry.version} (${entry.date})`;
    const subList = document.createElement('ul');
    for (const text of entry.items) {
      const li = document.createElement('li');
      li.textContent = text;
      subList.appendChild(li);
    }
    box.append(sub, subList);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Got it';
  close.addEventListener('click', () => {
    setLastSeen(latest.version);
    overlay.remove();
  });

  box.appendChild(close);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  close.focus();
}

showWhatsNewIfNeeded();
