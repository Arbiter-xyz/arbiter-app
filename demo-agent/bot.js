// CLI entry point for the demo-agent chat bot script (`npm run bot`) (#231, #236).
// Delegates to the sandbox-only chat bot implementation in sandbox-ask.js.
import { main, handleAsk, checkRateLimit, askSandbox, formatReply } from "./sandbox-ask.js";

export { handleAsk, checkRateLimit, askSandbox, formatReply, main };

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
