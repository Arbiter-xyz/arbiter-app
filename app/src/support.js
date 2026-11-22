// Live support chat (issue #62): a third-party Crisp embed, loaded only when
// VITE_CRISP_WEBSITE_ID is configured. The app has no accounts, so the only
// durable identifier attached to a chat session is the connected wallet's
// PUBLIC address — never the local quick-start wallet's secret.

const CRISP_WEBSITE_ID = import.meta.env.VITE_CRISP_WEBSITE_ID;

export function initSupportChat(page) {
  if (!CRISP_WEBSITE_ID || window.$crisp) return;
  window.$crisp = [];
  window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;
  window.$crisp.push(['set', 'session:segments', [[page]]]);
  const s = document.createElement('script');
  s.src = 'https://client.crisp.chat/l.js';
  s.async = true;
  document.head.append(s);
}

/** Tag the chat session with the connected public address so support can
 *  correlate a complaint with on-chain activity. */
export function setSupportWallet(address) {
  if (!window.$crisp || !address) return;
  window.$crisp.push(['set', 'session:data', [[['wallet_address', address]]]]);
}
