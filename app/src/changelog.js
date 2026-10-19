// Hand-authored per release, newest first. Bump the top entry's `version`
// (alongside package.json) to show the "what's new" modal once to returning users.
export const CHANGELOG = [
  {
    version: '0.2.0',
    date: '2026-09-01',
    items: [
      'Public leaderboard: see top workers at leaderboard.html.',
      'Bank withdrawal: cash out your balance to a bank account.',
      'Stake, withdraw and slashing flows are available from the worker console.',
    ],
  },
];

// Returns every changelog entry newer than `sinceVersion`, newest first.
// whatsNew.js uses this so a user who skipped several releases sees the
// aggregated "what you missed" items instead of only CHANGELOG[0].
// If `sinceVersion` is missing or unknown, all entries are returned.
export function getEntriesSince(sinceVersion) {
  if (!sinceVersion) return CHANGELOG;
  const index = CHANGELOG.findIndex((entry) => entry.version === sinceVersion);
  if (index === -1) return CHANGELOG;
  return CHANGELOG.slice(0, index);
}
