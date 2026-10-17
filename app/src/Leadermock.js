// Compatibility re-export for legacy/storybook/test callers (#219).
// Previously this file held a stale pre-#26/#86 copy of leaderboard.js with
// duplicated inline formatters and missing worker profile links. Re-exporting
// from the canonical leaderboard.js module eliminates code drift while
// keeping any legacy import path working.
export {
  mountLeaderboard,
  renderRow,
  renderActivityItem,
  workerProfileUrl,
} from './leaderboard.js';
