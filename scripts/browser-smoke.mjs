/**
 * Browser smoke test for the player.
 *
 * "The page returns 200" is not evidence the player works. This drives a real
 * Chromium: opens the watch page, clicks play, and asserts the player wiring -
 * one playback session per view, the geo-capped manifest, and either real
 * playback or an explicit failure message.
 *
 * Playwright's stock Chromium is built without proprietary codecs and cannot
 * decode the H.264/AAC the ladder produces, even though every real browser can.
 * The test probes for decode support and asserts accordingly. For
 * codec-independent proof that delivery works, see scripts/hls-check.mjs.
 *
 * Usage: node scripts/browser-smoke.mjs <slug> [baseUrl]
 */
import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";

const slug = process.argv[2];
const base = process.argv[3] ?? "http://127.0.0.1:3000";
if (!slug) {
  console.error("usage: node scripts/browser-smoke.mjs <slug> [baseUrl]");
  process.exit(1);
}

/**
 * CI images often ship a pinned Chromium under PLAYWRIGHT_BROWSERS_PATH whose
 * build number does not match the installed package, so prefer an explicit
 * CHROMIUM_PATH, then a discovered build, then Playwright's own resolution.
 */
function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith("chromium-")) continue;
    const candidate = `${root}/${dir}/chrome-linux/chrome`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const log = (...a) => console.log("·", ...a);
const requests = { playback: 0, master: null, segments: 0, heartbeats: 0, impressions: 0 };
const consoleErrors = [];
const failures = [];

const executablePath = findChromium();
if (executablePath) log(`chromium: ${executablePath}`);

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox", "--mute-audio"],
});
const page = await browser.newPage();

page.on("request", (req) => {
  const url = req.url();
  if (url.includes("/api/playback/")) requests.playback++;
  else if (url.includes("master_")) requests.master = url.split("/").pop();
  else if (url.endsWith(".ts")) requests.segments++;
  else if (url.includes("/api/track/heartbeat")) requests.heartbeats++;
  else if (url.includes("/api/track/impression")) requests.impressions++;
});
page.on("pageerror", (err) => consoleErrors.push(err.message));

try {
  // Not networkidle: third-party ad tags routinely hang or never resolve, so
  // the network going quiet is not a state an ad-bearing page reliably reaches.
  await page.goto(`${base}/watch/${slug}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  log("watch page loaded");

  await page.waitForSelector('button[aria-label="Play"]', { timeout: 15000 });
  log("player mounted, play button present");

  const canDecode = await page.evaluate(() =>
    MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d401f,mp4a.40.2"'),
  );
  log(`browser H.264/AAC decode support: ${canDecode}`);

  await page.click('button[aria-label="Play"]');
  log("play clicked");

  if (canDecode) {
    // The pre-roll waterfall must exhaust (the seeded tags are placeholders
    // that cannot fill) and fall through to content. That fallthrough is part
    // of what is under test.
    await page.waitForFunction(
      () => {
        const v = document.querySelector("video");
        return v && v.currentTime > 1.0;
      },
      { timeout: 45000 },
    );

    const state = await page.evaluate(() => {
      const v = document.querySelector("video");
      return {
        currentTime: v?.currentTime ?? 0,
        duration: v?.duration ?? 0,
        videoHeight: v?.videoHeight ?? 0,
        paused: v?.paused ?? true,
      };
    });

    log(`playing: t=${state.currentTime.toFixed(2)}s of ${state.duration.toFixed(0)}s at ${state.videoHeight}p`);
    if (state.currentTime <= 1) failures.push("playback position did not advance");
    if (state.paused) failures.push("video is paused");
    if (requests.segments === 0) failures.push("no HLS segments were fetched");
    if (state.videoHeight > 480) failures.push(`decoded ${state.videoHeight}p above the 480p cap`);
  } else {
    // Without decode support the player must fail loudly. A silent hang is
    // precisely the failure mode this assertion exists to catch.
    await page.waitForFunction(
      () => (document.querySelector('[class*="Player_wrap"]')?.textContent ?? "").includes("cannot play"),
      { timeout: 30000 },
    );
    log("player surfaced an explicit unsupported-codec message (no silent hang)");
  }

  log(`manifest served: ${requests.master}`);
  log(`playback sessions: ${requests.playback}, impressions reported: ${requests.impressions}`);

  if (requests.playback === 0) failures.push("no playback session was opened");
  // One page view must open exactly one session; a second would double-count
  // views and burn the ad frequency caps twice over.
  if (requests.playback > 1) failures.push(`opened ${requests.playback} playback sessions for one page view`);
  if (requests.master !== "master_480.m3u8") {
    failures.push(`expected the geo-capped master_480.m3u8, got ${requests.master}`);
  }
  if (consoleErrors.length > 0) failures.push(`page errors: ${consoleErrors.join("; ")}`);
} catch (err) {
  failures.push(err.message);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error("\nFAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nPASS  player wiring, single session, and geo cap all verified");
