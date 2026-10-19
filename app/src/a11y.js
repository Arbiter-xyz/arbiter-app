/**
 * Structural accessibility glue (issue #5), independent of which code path
 * shows a question or drives the countdown:
 *
 * - When the question panel appears, focus moves to its heading so screen-
 *   reader and keyboard users land on the new question instead of wherever
 *   they were; when it hides, focus returns to the element that had it.
 * - The countdown bar is exposed as a progressbar whose aria-valuenow
 *   tracks the bar's width, announced in coarse steps (not every tick).
 * - Status text for async job progress (awaiting_workers → reconciling →
 *   settled) goes through polite live regions declared in the markup.
 */
export function initA11y() {
  const panel = document.getElementById('panel-question');
  const heading = document.getElementById('question-heading');
  const track = document.getElementById('timer-track');
  const bar = document.getElementById('timer-bar');
  let returnFocus = null;

  if (panel && heading) {
    new MutationObserver(() => {
      const visible = !panel.classList.contains('hidden');
      if (visible && !panel.contains(document.activeElement)) {
        returnFocus = document.activeElement;
        heading.focus();
      } else if (!visible && returnFocus && document.body.contains(returnFocus)) {
        returnFocus.focus();
        returnFocus = null;
      }
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  if (track && bar) {
    new MutationObserver(() => {
      const pct = Math.max(0, Math.min(100, Math.round(parseFloat(bar.style.width) || 0)));
      // 10% steps keep screen readers from being flooded by 100ms ticks.
      const stepped = Math.round(pct / 10) * 10;
      if (track.getAttribute('aria-valuenow') !== String(stepped)) {
        track.setAttribute('aria-valuenow', String(stepped));
      }
    }).observe(bar, { attributes: true, attributeFilter: ['style'] });
  }
}
