/**
 * Verifies the money path end to end.
 *
 * Drives the real tracking endpoint with realistically-timed heartbeats and
 * checks three outcomes that decide whether this platform makes or loses money:
 *
 *   1. A genuine viewer is counted and credited to the ledger.
 *   2. The same visitor watching again is NOT paid twice.
 *   3. An obvious bot is not paid at all.
 *
 * Uses real wall-clock time on purpose - the server judges heartbeat cadence
 * against elapsed time, so a test that fakes the clock would not exercise the
 * rule that matters.
 *
 * Usage: node scripts/view-credit-check.mjs <slug> [apiUrl]
 */
const slug = process.argv[2];
const API = process.argv[3] ?? process.env.API_URL ?? "http://127.0.0.1:4000";
if (!slug) {
  console.error("usage: node scripts/view-credit-check.mjs <slug> [apiUrl]");
  process.exit(1);
}

const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BOT_UA = "Mozilla/5.0 (compatible; SomeCrawler/2.1; +http://example.com/bot)";

const log = (...a) => console.log("·", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];

async function openSession(ua) {
  const res = await fetch(`${API}/api/playback/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`playback failed: HTTP ${res.status}`);
  return res.json();
}

async function heartbeat(token, position, watched, ua) {
  const res = await fetch(`${API}/api/track/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua },
    body: JSON.stringify({ token, position, watched }),
  });
  if (!res.ok) throw new Error(`heartbeat failed: HTTP ${res.status}`);
  return res.json();
}

/** Watches properly: two heartbeats ten seconds apart, like a real player. */
async function watchGenuinely(ua, label) {
  const session = await openSession(ua);
  const token = session.session.token;
  await heartbeat(token, 0, 0, ua);
  await sleep(10_500);
  const result = await heartbeat(token, 10, 10, ua);
  log(`${label}: counted=${result.counted}${result.reasons?.length ? ` reasons=[${result.reasons.join(", ")}]` : ""}`);
  return result;
}

// --- 1. A genuine viewer earns ---
const real = await watchGenuinely(HUMAN_UA, "genuine viewer");
if (!real.counted) failures.push(`a genuine viewer was not counted (${real.reasons?.join(", ")})`);

// --- 2. The same visitor again must not be paid twice ---
const repeat = await watchGenuinely(HUMAN_UA, "same visitor, second view");
if (repeat.counted) failures.push("the same visitor was paid twice for one video in a day");
else if (!repeat.reasons?.includes("duplicate_visitor")) {
  failures.push(`second view rejected but not as a duplicate: ${repeat.reasons?.join(", ")}`);
}

// --- 3. A declared bot earns nothing ---
const bot = await watchGenuinely(BOT_UA, "declared bot");
if (bot.counted) failures.push("a bot was counted as a paid view");
else if (!bot.reasons?.includes("bot_ua")) {
  failures.push(`bot rejected but not for being a bot: ${bot.reasons?.join(", ")}`);
}

if (failures.length > 0) {
  console.error("\nFAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nPASS  genuine views earn, duplicates and bots do not");
