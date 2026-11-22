import { createStarButton } from '../starredQuestions.js';

// Issue #314: the starred-question toggle (createStarButton) had no
// isolated Storybook coverage. Uses the real exported function so its
// aria-pressed/aria-label/title wiring is exercised directly.
export default { title: 'Shared/StarToggle' };

export const Unstarred = {
  render: () => createStarButton('storybook-addr-1', 'q-unstarred', () => {}),
};

export const Starred = {
  render: () => {
    const address = 'storybook-addr-2';
    const questionId = 'q-starred';
    try {
      localStorage.setItem(
        `arbiter_starred_questions:${address}`,
        JSON.stringify([questionId]),
      );
    } catch {
      // ignore — story still renders, just not pre-starred
    }
    return createStarButton(address, questionId, () => {});
  },
};
