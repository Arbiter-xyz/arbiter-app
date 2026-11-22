// Issue #314: the cancel-controls question countdown (#timer-bar, driven by
// startCountdown()/stopCountdown() in src/main.js) had no isolated
// Storybook coverage. startCountdown() is not exported (it closes over
// module-level `el`/`state`), so these stories pin the #timer-bar markup
// contract at a few points along its countdown for visual review.
export default { title: 'Shared/CancelCountdown' };

const timerBar = (remainingPct) => `
  <div class="question" style="width: 220px;">
    <div id="timer-bar" style="height: 6px; background: currentColor; width: ${remainingPct}%;"></div>
  </div>`;

export const Fresh = { render: () => timerBar(100) };
export const HalfElapsed = { render: () => timerBar(50) };
export const Expiring = { render: () => timerBar(5) };
