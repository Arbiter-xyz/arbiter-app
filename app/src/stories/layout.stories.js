export default { title: "Shared/Layout and text" };

export const Row = {
  render: () => `<div class="row"><input placeholder="Value" /><button>Submit</button></div>`,
};

export const MutedAndSmall = {
  render: () => `<p class="muted">Muted text</p><p class="small">Small text</p>`,
};

export const LeaderboardTable = {
  render: () => `
    <table class="leaderboard-table">
      <thead><tr><th>#</th><th>Agent</th><th>Score</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>agent-alpha</td><td>98</td></tr>
        <tr><td>2</td><td>agent-beta</td><td>91</td></tr>
      </tbody>
    </table>`,
};
