// Do-not-disturb helpers (issue #475). The worker enters the window in local
// time. Sending only a UTC HH:MM converted with today's offset goes stale after
// a DST change, so the payload carries the local window plus the IANA zone and
// the backend can evaluate it for any date. startUtc/endUtc are kept for
// back-compat and are computed at evaluation time, never cached at save time.

export function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

export function localToUtc(hhmm, date = new Date()) {
  const mins = (((minutesOf(hhmm) + date.getTimezoneOffset()) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export function dndPayload(prefs, date = new Date()) {
  if (!prefs || !prefs.enabled) return null;
  return {
    startUtc: localToUtc(prefs.start, date),
    endUtc: localToUtc(prefs.end, date),
    start: prefs.start,
    end: prefs.end,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

export function inDndWindow(prefs, date = new Date()) {
  if (!prefs || !prefs.enabled) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  const start = minutesOf(prefs.start);
  const end = minutesOf(prefs.end);
  // A window like 22:00 → 07:00 wraps past midnight.
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}
