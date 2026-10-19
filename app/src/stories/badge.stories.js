export default { title: "Shared/Badge" };

export const Variants = {
  render: () => `
    <span class="badge badge-pending">pending</span>
    <span class="badge badge-resolved">resolved</span>
    <span class="badge badge-refunded">refunded</span>`,
};
