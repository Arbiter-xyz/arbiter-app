// Activity log for the worker console (#133, #465). Every entry goes to the
// on-page log, which is in memory only. Entries are also mirrored into the
// header notification center, which persists to localStorage, so anything
// sensitive (paid question text, the worker's answer) must not reach it:
// such calls pass a separate, content-free `notification` text.

/**
 * @param {{ write: (line: string) => void, notify: (text: string) => void, now?: () => string }} deps
 * @returns {(message: string, options?: { notification?: string | null }) => void}
 */
export function createActivityLog({
  write,
  notify,
  now = () => new Date().toLocaleTimeString(),
}) {
  return function log(message, { notification = message } = {}) {
    write(`[${now()}] ${message}`);
    if (notification) notify(notification);
  };
}
