// Issue #314: the per-category demand bars (rendered by
// renderCategoryDemand() in src/main.js from label[data-category] markup)
// had no isolated Storybook coverage. renderCategoryDemand() itself is not
// exported (it closes over module-level `el`/DOM refs wired at app start),
// so these stories pin the markup + class contract it paints onto
// (.category-demand-bar width, .demand-level text/data-level) for each
// scarcity tier, matching how dashboard.css styles them.
export default { title: 'Shared/DemandBar' };

const bar = (label, pct, level) => `
  <label data-category="${label}" style="display:block; width: 220px; margin-bottom: 8px;">
    <span>${label}</span>
    <span class="demand-level" data-level="${level}">${level}</span>
    <span class="category-demand-bar" style="display:block; height: 6px; background: currentColor; width: ${pct}%;"></span>
  </label>`;

export const Low = { render: () => bar('design', 10, 'low') };
export const Medium = { render: () => bar('writing', 45, 'medium') };
export const High = { render: () => bar('engineering', 90, 'high') };
