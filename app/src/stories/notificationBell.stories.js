import { createNotificationCenter } from '../notifications.js';

// Issue #314: the notification bell (createNotificationCenter) had no
// isolated Storybook coverage. Exercise it via its real exported API so a
// regression in render()/setOpen()/push() shows up here in isolation.
export default { title: 'Shared/NotificationBell' };

let seq = 0;
function mountCenter(container, { seed = [] } = {}) {
  const storageKey = `storybook-notif-${seq++}`;
  try {
    localStorage.setItem(storageKey, JSON.stringify(seed));
  } catch {
    // ignore — story still renders with an empty list
  }
  createNotificationCenter({ mount: container, storageKey });
}

export const Empty = {
  render: () => {
    const container = document.createElement('div');
    mountCenter(container);
    return container;
  },
};

export const Unread = {
  render: () => {
    const container = document.createElement('div');
    mountCenter(container, {
      seed: [
        { id: '1', at: Date.now(), message: 'Question answered', read: false },
        { id: '2', at: Date.now() - 60_000, message: 'Payout sent', read: true },
      ],
    });
    return container;
  },
};
