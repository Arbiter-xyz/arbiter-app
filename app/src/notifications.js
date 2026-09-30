/** In-app notification center (issue #133): a header bell with an unread
 * badge and a dismissible dropdown, fed by the same messages as the page's
 * activity log plus push payloads relayed from the service worker. Items
 * and read state persist in localStorage (per page, via storageKey). */
const MAX_ITEMS = 50;

export function createNotificationCenter({ mount, storageKey }) {
  let items = [];
  try {
    items = JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch {
    items = [];
  }

  const wrap = document.createElement('div');
  wrap.className = 'notif';
  wrap.innerHTML = `
    <button type="button" class="notif-bell secondary" aria-label="Notifications" aria-expanded="false">🔔<span class="notif-badge hidden"></span></button>
    <div class="notif-panel hidden" role="dialog" aria-label="Notifications">
      <div class="row"><strong>Notifications</strong><button type="button" class="notif-clear secondary small">Clear</button></div>
      <ul class="notif-list"></ul>
    </div>`;
  mount.append(wrap);
  const bell = wrap.querySelector('.notif-bell');
  const badge = wrap.querySelector('.notif-badge');
  const panel = wrap.querySelector('.notif-panel');
  const list = wrap.querySelector('.notif-list');

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // storage full/blocked — the in-memory list still works for this tab
    }
  }

  function render() {
    const unread = items.filter((i) => !i.read).length;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
    list.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'muted small';
      li.textContent = 'Nothing yet.';
      list.append(li);
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.classList.toggle('unread', !item.read);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'notif-dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.textContent = '×';
      dismiss.addEventListener('click', (evt) => {
        evt.stopPropagation();
        items = items.filter((i) => i.id !== item.id);
        save();
        render();
      });
      const text = document.createElement('span');
      text.textContent = `[${new Date(item.at).toLocaleTimeString()}] ${item.message}`;
      li.append(text, dismiss);
      list.append(li);
    }
  }

  function setOpen(open) {
    panel.classList.toggle('hidden', !open);
    bell.setAttribute('aria-expanded', String(open));
    if (open && items.some((i) => !i.read)) {
      items.forEach((i) => (i.read = true));
      save();
    }
    render();
  }

  bell.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
  wrap.querySelector('.notif-clear').addEventListener('click', () => {
    items = [];
    save();
    render();
  });
  document.addEventListener('click', (evt) => {
    if (!wrap.contains(evt.target)) setOpen(false);
  });

  // Push payloads the service worker relays to open tabs (see sw.js).
  navigator.serviceWorker?.addEventListener('message', (evt) => {
    if (evt.data?.type === 'arbiter:notify') push(evt.data.message);
  });

  function push(message) {
    items.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now(), message, read: !panel.classList.contains('hidden') });
    items = items.slice(0, MAX_ITEMS);
    save();
    render();
  }

  render();
  return push;
}
