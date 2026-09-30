export default { title: "Shared/Panel" };

export const Default = {
  render: () => `<section class="panel"><h2>Panel</h2><p class="sub">Default container used on every page.</p></section>`,
};

export const Warning = {
  render: () => `<section class="panel warning"><h2>Warning panel</h2><p class="small">Use <code>.panel.warning</code> for cautionary content.</p></section>`,
};
