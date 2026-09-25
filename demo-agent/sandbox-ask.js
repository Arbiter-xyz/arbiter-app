// Sandbox-only chat bot front-end for asking Arbiter questions from a
// Slack/Discord workspace.
//
// This mirrors the zero-setup pattern of demo-agent/sandbox-ask.js: it proxies
// /oracle/sandbox calls with NO payer secret and NO wallet connect. There is no
// payment identity to answer here, and no real payment is possible from the bot
// until a custody model is explicitly chosen and documented (see issue #90).
//
// Usage:
//   node sandbox-ask.js "What is the capital of France?"
//   node sandbox-ask.js --user U123 "What is the capital of France?"
//
// The --user flag stands in for the Slack/Discord user id so that rate limiting
// is applied per chat user, not per bot process.

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

// Per-user rate limiting. Keyed by chat user id so one user cannot exhaust a
// shared sandbox quota for everyone else in the workspace.
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 5);
const userHits = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const hits = (userHits.get(userId) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (hits.length >= RATE_LIMIT_MAX) {
    const retryMs = RATE_LIMIT_WINDOW_MS - (now - hits[0]);
    return { allowed: false, retryMs };
  }
  hits.push(now);
  userHits.set(userId, hits);
  return { allowed: true };
}

async function askSandbox(question) {
  const res = await fetch(`${BACKEND_URL}/oracle/sandbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sandbox request failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Formats the real /oracle/sandbox result for posting back in-channel.
function formatReply(result) {
  const answer =
    result && (result.answer ?? result.result ?? result.response ?? result);
  return typeof answer === "string" ? answer : JSON.stringify(answer);
}

async function handleAsk(userId, question) {
  const limit = checkRateLimit(userId);
  if (!limit.allowed) {
    const secs = Math.ceil(limit.retryMs / 1000);
    return `Rate limit reached. Try again in ${secs}s.`;
  }
  try {
    const result = await askSandbox(question);
    return formatReply(result);
  } catch (err) {
    return `Sorry, I couldn't reach the oracle: ${err.message}`;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let userId = "anonymous";
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--user" && args[i + 1]) {
      userId = args[++i];
    } else {
      rest.push(args[i]);
    }
  }
  const question = rest.join(" ").trim();
  if (!question) {
    console.error('Usage: node sandbox-ask.js [--user USER_ID] "<question>"');
    process.exit(1);
  }
  const reply = await handleAsk(userId, question);
  console.log(reply);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { handleAsk, checkRateLimit, askSandbox, formatReply };
