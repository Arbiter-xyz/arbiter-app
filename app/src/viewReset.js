// Restore admin views to their pre-login markup on logout (#453), so no
// table from the previous session (KYC, payouts, workers, treasury, …)
// stays readable in the DOM.

/**
 * Snapshots the children of every element matching `selector` now, and
 * returns a function that puts those original children back.
 */
export function snapshotViews(root, selector) {
  const saved = [...root.querySelectorAll(selector)].map((el) => [
    el,
    [...el.childNodes].map((n) => n.cloneNode(true)),
  ]);
  return function restoreViews() {
    for (const [el, children] of saved)
      el.replaceChildren(...children.map((n) => n.cloneNode(true)));
  };
}
