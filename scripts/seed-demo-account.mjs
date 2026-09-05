/**
 * Creates a demo uploader with real videos and real earnings.
 *
 * Everything goes through the live HTTP surface - multipart upload, the encode
 * queue, and the heartbeat tracker - so the dashboard shows numbers the system
 * actually produced rather than fixtures. Useful for reviewing the product, and
 * for showing an ad network a working site when applying.
 *
 * Usage: node scripts/seed-demo-account.mjs [viewersPerVideo]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);
const API = process.env.API_PUBLIC_URL ?? "http://127.0.0.1:4000";
const VIEWERS = Number(process.argv[2] ?? 25);

const EMAIL = "demo@dropreel.local";
const PASSWORD = "demo-account-password";
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const CLIPS = [
  { title: "Warehouse Set 2am", bg: "0x141c2e", fg: "0x7fb2ff" },
  { title: "Cheap Gear Teardown", bg: "0x1d1426", fg: "0xd79aff" },
  { title: "Coast Road Run", bg: "0x122019", fg: "0x7fe0a8" },
];

const log = (...a) => console.log("·", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`non-JSON ${res.status}: ${text.slice(0, 200)}`); }
}

async function authenticate() {
  let res = await fetch(`${API}/api/auth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, displayName: "Demo Uploader" }),
  });
  if (res.ok) {
    log(`registered ${EMAIL}`);
    return (await json(res)).accessToken;
  }
  // Re-runnable: fall back to signing in if the account already exists.
  res = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`could not authenticate: ${JSON.stringify(await json(res))}`);
  log(`signed in as ${EMAIL}`);
  return (await json(res)).accessToken;
}

async function makeClip(dir, clip) {
  const out = path.join(dir, `${clip.title}.mp4`);
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=${clip.bg}:size=1280x720:rate=25`,
    "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000",
    "-t", "14",
    "-vf", `drawtext=fontfile=${FONT}:text='${clip.title}':fontcolor=${clip.fg}:fontsize=52:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
    out,
  ]);
  return out;
}

async function upload(token, filePath, title) {
  const buf = await readFile(filePath);
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  let res = await fetch(`${API}/api/uploads/create`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ filename: path.basename(filePath), sizeBytes: buf.length, mimeType: "video/mp4", title }),
  });
  const created = await json(res);
  if (!res.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);

  const parts = [];
  for (let i = 0; i < created.partCount; i++) {
    const n = i + 1;
    const signed = await json(await fetch(
      `${API}/api/uploads/${created.videoId}/part/${n}?uploadId=${encodeURIComponent(created.uploadId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    ));
    const chunk = buf.subarray(i * created.partSize, Math.min((i + 1) * created.partSize, buf.length));
    const put = await fetch(signed.url, { method: "PUT", body: chunk });
    if (!put.ok) throw new Error(`part ${n} failed`);
    parts.push({ partNumber: n, etag: put.headers.get("etag") });
  }

  res = await fetch(`${API}/api/uploads/${created.videoId}/complete`, {
    method: "POST", headers: auth, body: JSON.stringify({ uploadId: created.uploadId, parts }),
  });
  if (!res.ok) throw new Error(`complete failed: ${JSON.stringify(await json(res))}`);

  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const body = await json(await fetch(`${API}/api/videos/mine?limit=50`, {
      headers: { authorization: `Bearer ${token}` },
    }));
    const mine = body.videos?.find((v) => v.id === created.videoId);
    if (mine?.status === "READY") return { slug: created.slug, title };
    if (mine?.status === "FAILED") throw new Error(`encode failed: ${mine.transcodeError}`);
  }
  throw new Error("timed out waiting for encode");
}

/**
 * Simulates distinct viewers. Each gets its own user agent so the per-visitor
 * dedupe treats them separately, and each sends a properly-spaced heartbeat
 * pair - the server judges cadence against real elapsed time, so these have to
 * actually wait.
 */
async function driveViews(slug, count) {
  const watchers = Array.from({ length: count }, async (_, i) => {
    const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.${1000 + i}.84 Safari/537.36`;
    const open = await fetch(`${API}/api/playback/${slug}`, {
      method: "POST", headers: { "content-type": "application/json", "user-agent": ua }, body: "{}",
    });
    if (!open.ok) return false;
    const token = (await json(open)).session.token;

    const beat = (position, watched) => fetch(`${API}/api/track/heartbeat`, {
      method: "POST", headers: { "content-type": "application/json", "user-agent": ua },
      body: JSON.stringify({ token, position, watched }),
    });

    await beat(0, 0);
    await sleep(10_500);
    const final = await beat(10, 10);
    return final.ok ? (await json(final)).counted === true : false;
  });

  const results = await Promise.all(watchers);
  return results.filter(Boolean).length;
}

async function main() {
  const token = await authenticate();
  const dir = await mkdtemp(path.join(tmpdir(), "dropreel-demo-"));
  try {
    const videos = [];
    for (const clip of CLIPS) {
      const file = await makeClip(dir, clip);
      const uploaded = await upload(token, file, clip.title);
      log(`uploaded and encoded: ${uploaded.title} (${uploaded.slug})`);
      videos.push(uploaded);
    }

    let counted = 0;
    for (const v of videos) {
      const n = await driveViews(v.slug, VIEWERS);
      counted += n;
      log(`${v.title}: ${n}/${VIEWERS} views counted`);
    }

    console.log(`\ndemo account ready - ${EMAIL} / ${PASSWORD}`);
    console.log(`${videos.length} videos, ${counted} paid views recorded.`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error("failed:", err.message); process.exitCode = 1; });
