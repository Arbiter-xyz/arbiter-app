// Lightweight first-visit guided tour (issues #60, #61). Non-blocking: the
// page stays fully usable underneath, and "Skip tour" dismisses it at any
// step. Seen-state is a localStorage flag, same pattern as the local wallet.

function seen(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markSeen(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // storage blocked — the tour may show again, which is harmless
  }
}

/**
 * Show `steps` ({ target: Element|null, title, text }) once per browser.
 * Steps whose target is missing are shown centred on screen.
 */
export function startTour(key, steps) {
  if (seen(key) || !steps.length) return;
  markSeen(key);

  const box = document.createElement('div');
  box.className = 'tour-tip';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-live', 'polite');
  document.body.append(box);

  let i = 0;
  let highlighted = null;

  function close() {
    highlighted?.classList.remove('tour-highlight');
    box.remove();
  }

  function render() {
    const step = steps[i];
    highlighted?.classList.remove('tour-highlight');
    highlighted = step.target && !step.target.closest('.hidden') ? step.target : null;
    highlighted?.classList.add('tour-highlight');
    highlighted?.scrollIntoView({ block: 'center', behavior: 'smooth' });

    box.innerHTML = '';
    const h = document.createElement('strong');
    h.textContent = step.title;
    const p = document.createElement('p');
    p.textContent = step.text;
    const row = document.createElement('div');
    row.className = 'tour-actions';
    const skip = document.createElement('button');
    skip.className = 'secondary';
    skip.textContent = 'Skip tour';
    skip.onclick = close;
    const next = document.createElement('button');
    next.textContent = i === steps.length - 1 ? 'Got it' : `Next (${i + 1}/${steps.length})`;
    next.onclick = () => (++i < steps.length ? render() : close());
    row.append(skip, next);
    box.append(h, p, row);
  }

  render();
}
